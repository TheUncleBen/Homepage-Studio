import { useEffect, useLayoutEffect, useRef } from "react";

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
  useLayoutEffect(() => {
    liveController.current = controller;
  }, [controller]);
  const blockGesture = (value) => {
    const playback = typeof liveController.current === "function" ? liveController.current() : liveController.current;
    playback?.setBlocked("gesture", value);
  };
  useEffect(
    () => () => {
      const playback = typeof liveController.current === "function" ? liveController.current() : liveController.current;
      playback?.setBlocked("gesture", false);
    },
    [],
  );
  const navigate = (direction) => {
    const playback = typeof controller === "function" ? controller() : controller;
    if (!playback || disabled) return;
    const before = playback.getSnapshot().activeId;
    if (direction > 0) playback.next({ manual: true });
    else playback.previous({ manual: true });
    if (before !== playback.getSnapshot().activeId) onManual?.(playback.getSnapshot());
  };
  return {
    onPointerDown(event) {
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
      blockGesture(true);
    },
    onPointerMove(event) {
      const start = drag.current;
      if (!start || event.pointerId !== start.id) return;
      if (disabled) {
        drag.current = null;
        onDrag?.(0);
        blockGesture(false);
        return;
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.captured && Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        onDrag?.(0);
        blockGesture(false);
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
    },
    onPointerUp(event) {
      const start = drag.current;
      drag.current = null;
      blockGesture(false);
      if (!start || start.id !== event.pointerId) return;
      if (start.captured) {
        start.target.releasePointerCapture?.(event.pointerId);
        const dx = event.clientX - start.x;
        if (Math.abs(dx) >= 44 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.3) {
          suppressedClick.current = Date.now() + 400;
          navigate(dx < 0 ? 1 : -1);
        }
      }
      onDrag?.(0);
    },
    onPointerCancel() {
      drag.current = null;
      onDrag?.(0);
      blockGesture(false);
    },
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
