import { useEffect, useLayoutEffect, useRef } from "react";

import { touchesNativeContent, useLongPress, useStackGestures } from "./gestures";
import StudioIcon from "./icons";
import NativePanel from "./native-panel";

export default function PanelHost({
  panel,
  data,
  rect,
  stack,
  active = true,
  selected,
  editing,
  busy = false,
  overlayOpen = false,
  stale = false,
  saved = false,
  moving,
  reducedMotion,
  controller,
  dragOffset = 0,
  onStackDrag,
  onManual,
  onEdit,
  onSelect,
  onManipulate,
  onUnitKey,
  onLongPress,
  renderNative: RenderNative = NativePanel,
}) {
  const nativeContent = useRef(null);
  const slide = useRef(null);
  const previousPresentation = useRef(null);
  const slideAnimation = useRef(null);
  const playback = controller?.();
  const press = useLongPress({
    disabled: editing || busy || overlayOpen || Boolean(stack),
    accepts: (event) => !event.target.closest("button,input"),
    onLongPress: (pointer) => onLongPress?.(panel.id, pointer),
  });
  useEffect(() => {
    if (!playback || !active) return undefined;
    const reason = `embedded-focus:${panel.id}`;
    let listening = true;
    const update = () => {
      if (!listening) return;
      const focused = document.activeElement;
      playback.setBlocked(reason, focused?.tagName === "IFRAME" && nativeContent.current?.contains(focused));
    };
    // Focus events inside another document do not bubble through the iframe.
    // Its parent element is still observable without reading cross-origin data.
    const afterFocus = () => queueMicrotask(update);
    window.addEventListener("blur", afterFocus);
    window.addEventListener("focus", afterFocus);
    document.addEventListener("focusin", afterFocus);
    update();
    return () => {
      listening = false;
      window.removeEventListener("blur", afterFocus);
      window.removeEventListener("focus", afterFocus);
      document.removeEventListener("focusin", afterFocus);
      playback.setBlocked(reason, false);
    };
  }, [playback, active, panel.id]);
  const gestures = useStackGestures({
    controller,
    disabled: editing || busy || overlayOpen || !stack,
    onDrag: onStackDrag,
    onManual,
  });
  // Touch hold on the panel body selects like the header does (IN-01), unless
  // the touch starts on interactive or horizontally scrolling native content.
  // Mouse keeps header-only holds; the header handles its own presses.
  const bodyHeld = useRef(0);
  const bodyPress = useLongPress({
    disabled: editing || busy || overlayOpen,
    accepts: (event) =>
      event.pointerType === "touch" &&
      !event.target.closest(".studio-panel-header,.studio-resize-handle") &&
      !touchesNativeContent(event),
    onLongPress: (pointer) => {
      bodyHeld.current = Date.now();
      onLongPress?.(stack ? stack.id : panel.id, pointer);
    },
  });
  useLayoutEffect(() => {
    // touch-action is fixed when a touch starts. Body content that overflows
    // horizontally keeps native panning; otherwise the body allows only
    // vertical panning so horizontal swipes and holds reach the panel.
    // Only a body that really scrolls vertically contains its overscroll;
    // otherwise a vertical swipe on the body must scroll the page.
    const element = nativeContent.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      if (element.scrollWidth > element.clientWidth + 1) element.dataset.studioScrollX = "";
      else delete element.dataset.studioScrollX;
      if (element.scrollHeight > element.clientHeight + 1) element.dataset.studioScrollY = "";
      else delete element.dataset.studioScrollY;
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    [...element.children].forEach((child) => observer.observe(child));
    // Native content can replace its children after mount; observe those too.
    const children =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            [...element.children].forEach((child) => observer.observe(child));
            update();
          });
    children?.observe(element, { childList: true });
    update();
    return () => {
      observer.disconnect();
      children?.disconnect();
    };
  }, []);
  const duration =
    reducedMotion || stack?.playback.transition === "none" ? 0 : (stack?.playback.transitionDurationMs ?? 250);
  const style = { ...rect, "--studio-slide-duration": `${duration}ms` };
  const memberIndex = stack?.panelIds.indexOf(panel.id) ?? 0;
  const snapshot = playback?.getSnapshot();
  const activeIndex = snapshot?.activeIndex ?? 0;
  const direction =
    snapshot?.previousId === panel.id && snapshot.direction ? -snapshot.direction : memberIndex < activeIndex ? -1 : 1;
  const translation =
    stack?.playback.transition === "vertical" ? `translateY(${direction * 100}%)` : `translateX(${direction * 100}%)`;
  let translate = !active && stack && !["none", "fade"].includes(stack.playback.transition) ? translation : "none";
  const nextIndex = stack ? (activeIndex + 1) % stack.panelIds.length : 0;
  const previousIndex = stack ? (activeIndex - 1 + stack.panelIds.length) % stack.panelIds.length : 0;
  const neighbor =
    stack &&
    dragOffset &&
    ((dragOffset < 0 && memberIndex === nextIndex && (snapshot?.loop || activeIndex < stack.panelIds.length - 1)) ||
      (dragOffset > 0 && memberIndex === previousIndex && (snapshot?.loop || activeIndex > 0)));
  const presented = active || Boolean(neighbor);
  if (stack && dragOffset)
    translate = `translateX(${dragOffset + (active ? 0 : dragOffset < 0 ? rect.width : -rect.width)}px)`;
  useLayoutEffect(() => {
    const previous = previousPresentation.current;
    const interrupted =
      slideAnimation.current?.playState === "running" ? getComputedStyle(slide.current).transform : null;
    if (previous?.active !== active || previous?.stackId !== stack?.id || dragOffset || !duration) {
      slideAnimation.current?.cancel();
      slideAnimation.current = null;
    }
    if (
      previous &&
      active !== previous.active &&
      previous?.stackId === stack?.id &&
      snapshot?.direction &&
      duration &&
      ["horizontal", "vertical"].includes(stack?.playback.transition)
    ) {
      const from =
        interrupted ||
        (previous.dragOffset
          ? `translateX(${previous.dragOffset + (active ? (previous.dragOffset < 0 ? rect.width : -rect.width) : 0)}px)`
          : active
            ? `${stack.playback.transition === "vertical" ? "translateY" : "translateX"}(${snapshot.direction * 100}%)`
            : "none");
      // Explicit direction is necessary at a loop boundary, where numeric member
      // order would place the entering slide on the opposite side. Animate this
      // existing host, starting at its finger-following offset after a swipe.
      slideAnimation.current = slide.current?.animate?.(
        [{ transform: from }, { transform: active ? "none" : translation }],
        {
          duration,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
    }
    previousPresentation.current = { active, dragOffset, stackId: stack?.id };
  }, [
    active,
    dragOffset,
    duration,
    rect.width,
    snapshot?.direction,
    stack?.id,
    stack?.playback.transition,
    translation,
  ]);
  useEffect(() => () => slideAnimation.current?.cancel(), []);
  return (
    <section
      className={`studio-panel${stack ? " studio-stacked-panel" : ""}${selected ? " studio-selected" : ""}${moving ? " studio-moving" : ""}${!presented ? " studio-inactive" : ""}${!active ? " studio-noninteractive" : ""}`}
      data-panel-id={panel.id}
      data-panel-kind={panel.kind}
      data-stack-id={stack?.id}
      aria-label={panel.title}
      aria-hidden={!active || undefined}
      inert={!active}
      style={style}
      {...gestures}
      onPointerDown={(event) => {
        gestures.onPointerDown(event);
        bodyPress.onPointerDown(event);
      }}
      onPointerMove={(event) => {
        gestures.onPointerMove(event);
        bodyPress.onPointerMove(event);
      }}
      onPointerUp={(event) => {
        bodyPress.onPointerUp(event);
        gestures.onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        bodyPress.onPointerCancel(event);
        gestures.onPointerCancel(event);
      }}
      onContextMenu={(event) => {
        // A recognized touch hold must not also open the native context menu.
        if (Date.now() - bodyHeld.current < 1500) event.preventDefault();
      }}
    >
      <div
        ref={slide}
        className="studio-panel-slide"
        style={{
          opacity: presented ? 1 : 0,
          transform: translate,
          transition: dragOffset ? "none" : undefined,
        }}
      >
        {!stack && (
          <header
            className="studio-panel-header"
            onPointerDown={press.onPointerDown}
            onPointerMove={press.onPointerMove}
            onPointerUp={press.onPointerUp}
            onPointerCancel={press.onPointerCancel}
            onContextMenu={(event) => {
              press.cancel();
              if (busy) return;
              event.preventDefault();
              onLongPress?.(panel.id);
            }}
          >
            {editing && (
              // The label enlarges the touch target around the native checkbox.
              <label className="studio-select-target">
                <input
                  type="checkbox"
                  aria-label={`Select ${panel.title}`}
                  checked={Boolean(selected)}
                  disabled={busy}
                  onChange={() => onSelect(panel.id)}
                />
              </label>
            )}
            <span className="studio-panel-title">
              <small>{panel.group || (panel.kind === "informationWidget" ? "Information" : "Dashboard")}</small>
              <strong>{panel.title}</strong>
            </span>
            {editing && (
              <>
                <button
                  className="studio-icon-button studio-move-handle"
                  disabled={busy}
                  aria-label={`Move ${panel.title}. Use arrow keys; Shift and arrow keys resize.`}
                  title="Drag to move · arrows to move · Shift + arrows to resize"
                  onPointerDown={(event) => onManipulate(event, panel.id, "move")}
                  onKeyDown={(event) => onUnitKey(event, panel.id)}
                >
                  <StudioIcon name="grip" />
                </button>
                <button
                  className="studio-icon-button"
                  disabled={busy}
                  aria-label={`Edit ${panel.title}`}
                  onClick={() => onEdit(panel)}
                >
                  <StudioIcon name="edit" />
                </button>
              </>
            )}
          </header>
        )}
        <div
          ref={nativeContent}
          className="studio-native-content"
          inert={stale}
          aria-hidden={stale || undefined}
          style={{ visibility: stale ? "hidden" : undefined }}
          onFocusCapture={() => controller?.()?.setBlocked("content-focus", true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) controller?.()?.setBlocked("content-focus", false);
          }}
        >
          <RenderNative panel={panel} data={data} />
        </div>
        {stale && (
          <div
            className="studio-panel-placeholder studio-panel-refresh"
            style={{
              position: "absolute",
              inset: stack ? "59px 15px 32px" : "56px 15px 16px",
              minHeight: 0,
            }}
          >
            <strong>{saved ? "Changes saved" : "Updating content"}</strong>
            <p>Waiting for refreshed widget data.</p>
          </div>
        )}
        {editing && !stack && (
          <button
            className="studio-resize-handle"
            disabled={busy}
            aria-label={`Resize ${panel.title}. Use arrow keys.`}
            title="Drag to resize · arrow keys"
            onPointerDown={(event) => onManipulate(event, panel.id, "resize")}
            onKeyDown={(event) => onUnitKey(event, panel.id, "resize")}
          >
            <StudioIcon name="resize" size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
