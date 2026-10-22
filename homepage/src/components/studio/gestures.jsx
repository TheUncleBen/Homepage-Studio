import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// A short press has no pointer capture yet. Its release may happen outside the
// original element, so observe that pointer for only the lifetime of the press.
function watchPointer(pointerId, { move, end, cancel, captureTarget }) {
  const matches = (event) => event.pointerId === pointerId;
  const onMove = (event) => {
    if (matches(event)) move?.(event);
  };
  const onEnd = (event) => {
    if (matches(event)) end(event);
  };
  const onCancel = (event) => {
    if (matches(event)) cancel();
  };
  const onLostCapture = (event) => {
    // Touch first captures the pressed child implicitly. Its normal transfer
    // to the gesture owner emits child loss while that owner already holds it.
    if (matches(event) && !captureTarget?.hasPointerCapture?.(pointerId)) cancel();
  };
  const onOtherPointer = (event) => {
    if (!matches(event)) cancel();
  };
  const onVisibility = () => {
    if (document.hidden) cancel();
  };
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onEnd, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("lostpointercapture", onLostCapture, true);
  window.addEventListener("pointerdown", onOtherPointer, true);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("lostpointercapture", onLostCapture, true);
    window.removeEventListener("pointerdown", onOtherPointer, true);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function useLongPress({ disabled, onLongPress, accepts = () => true }) {
  const press = useRef(null);
  const cancel = useCallback(() => {
    const current = press.current;
    press.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.cleanup?.();
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  const move = (event) => {
    const current = press.current;
    if (
      current &&
      event.pointerId === current.pointer.pointerId &&
      Math.hypot(event.clientX - current.pointer.clientX, event.clientY - current.pointer.clientY) > 10
    )
      cancel();
  };
  return {
    onPointerDown(event) {
      cancel();
      if (disabled || event.button !== 0 || event.isPrimary === false || !accepts(event)) return;
      const pointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        currentTarget: event.currentTarget,
      };
      const current = { pointer };
      press.current = current;
      current.cleanup = watchPointer(event.pointerId, { move, end: cancel, cancel });
      current.timer = setTimeout(() => {
        cancel();
        onLongPress(pointer);
      }, 420);
    },
    onPointerMove: move,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    cancel,
  };
}

const INTERACTIVE =
  "a,button,input,textarea,select,iframe,canvas,svg,[contenteditable=true],[role=button],[role=slider],[data-studio-interactive]";
export function interactiveTarget(target, root) {
  // The quiet title is an intentional picker trigger and still belongs to the
  // swipe surface. Its own click gate rejects movement and held pointers.
  if (target instanceof Element && root?.contains(target) && target.closest("[data-studio-stack-title]")) return false;
  return target instanceof Element && target !== root && Boolean(target.closest(INTERACTIVE));
}

export function useStackGestures({ controller, disabled, onManual, onDrag }) {
  const drag = useRef(null);
  const wheel = useRef({ amount: 0, last: 0, cooldown: 0 });
  const suppressedClick = useRef(0);
  const liveController = useRef(controller);
  const cancelActive = useRef(null);
  useLayoutEffect(() => {
    liveController.current = controller;
  }, [controller]);
  const blockGesture = (value) => {
    const playback = typeof liveController.current === "function" ? liveController.current() : liveController.current;
    playback?.setBlocked("gesture", value);
  };
  useEffect(() => () => cancelActive.current?.(), []);
  useEffect(() => {
    if (disabled) cancelActive.current?.();
  }, [disabled]);
  const navigate = (direction) => {
    const playback = typeof controller === "function" ? controller() : controller;
    if (!playback || disabled) return;
    const before = playback.getSnapshot().activeId;
    if (direction > 0) playback.next({ manual: true });
    else playback.previous({ manual: true });
    if (before !== playback.getSnapshot().activeId) onManual?.(playback.getSnapshot());
  };
  const finish = (event, cancelled = false) => {
    const start = drag.current;
    if (!start || (event?.pointerId !== undefined && start.id !== event.pointerId)) return;
    drag.current = null;
    cancelActive.current = null;
    start.cleanup?.();
    if (start.captured && start.target.hasPointerCapture?.(start.id)) start.target.releasePointerCapture(start.id);
    blockGesture(false);
    if (start.captured && !cancelled) {
      const dx = event.clientX - start.x;
      if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.3) {
        suppressedClick.current = Date.now() + 400;
        navigate(dx < 0 ? 1 : -1);
      }
    }
    onDrag?.(0);
  };
  const move = (event) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.id) return;
    if (disabled) {
      finish(event, true);
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.captured && Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
      finish(event, true);
      return;
    }
    if (!start.captured && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      start.target.setPointerCapture?.(event.pointerId);
      start.captured = true;
    }
    if (start.captured) {
      event.preventDefault();
      const playback = typeof controller === "function" ? controller() : controller;
      const state = playback?.getSnapshot();
      const atEnd =
        state &&
        !state.loop &&
        ((dx > 0 && state.activeIndex === 0) || (dx < 0 && state.activeIndex === state.ids.length - 1));
      onDrag?.(Math.max(-start.width * 0.95, Math.min(start.width * 0.95, atEnd ? dx * 0.18 : dx)));
    }
  };
  return {
    onPointerDown(event) {
      cancelActive.current?.();
      if (
        disabled ||
        event.button !== 0 ||
        event.isPrimary === false ||
        interactiveTarget(event.target, event.currentTarget)
      )
        return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.currentTarget,
        width: event.currentTarget.getBoundingClientRect().width || 400,
        captured: false,
      };
      cancelActive.current = () => finish(undefined, true);
      drag.current.cleanup = watchPointer(event.pointerId, {
        captureTarget: event.currentTarget,
        move: (pointerEvent) => {
          if (!drag.current?.target.contains(pointerEvent.target)) move(pointerEvent);
        },
        end: finish,
        cancel: cancelActive.current,
      });
      blockGesture(true);
    },
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: (event) => finish(event, true),
    onClickCapture(event) {
      if (event.detail !== 0 && event.currentTarget.contains(event.target) && Date.now() < suppressedClick.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onWheel(event) {
      if (
        disabled ||
        interactiveTarget(event.target, event.currentTarget) ||
        Math.abs(event.deltaX) < Math.abs(event.deltaY)
      )
        return;
      const time = Date.now();
      if (time < wheel.current.cooldown) return;
      if (time - wheel.current.last > 180) wheel.current.amount = 0;
      wheel.current.last = time;
      wheel.current.amount += event.deltaX * (event.deltaMode === 1 ? 16 : 1);
      if (Math.abs(wheel.current.amount) > 60) {
        navigate(wheel.current.amount > 0 ? 1 : -1);
        wheel.current = { amount: 0, last: time, cooldown: time + 420 };
      }
    },
    onKeyDown(event) {
      if (disabled || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(event.key === "ArrowRight" ? 1 : -1);
      }
    },
  };
}
