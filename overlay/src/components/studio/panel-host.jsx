import { useEffect, useRef } from "react";

import { useStackGestures } from "./gestures";
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
  const press = useRef(null);
  const nativeContent = useRef(null);
  const playback = controller?.();
  useEffect(() => () => clearTimeout(press.current?.timer), []);
  useEffect(() => {
    if (!playback || !active) return undefined;
    const reason = `embedded-focus:${panel.id}`;
    let listening = true;
    const update = () => {
      if (!listening) return;
      const focused = document.activeElement;
      playback.setBlocked(
        reason,
        focused?.tagName === "IFRAME" && nativeContent.current?.contains(focused),
      );
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
    disabled: editing || !stack,
    onDrag: onStackDrag,
    onManual,
  });
  const duration =
    reducedMotion || stack?.playback.transition === "none"
      ? 0
      : (stack?.playback.transitionDurationMs ?? 250);
  const style = { ...rect, "--studio-slide-duration": `${duration}ms` };
  const memberIndex = stack?.panelIds.indexOf(panel.id) ?? 0;
  const snapshot = playback?.getSnapshot();
  const activeIndex = snapshot?.activeIndex ?? 0;
  const direction = memberIndex < activeIndex ? -1 : 1;
  const translation =
    stack?.playback.transition === "vertical"
      ? `translateY(${direction * 100}%)`
      : `translateX(${direction * 100}%)`;
  let translate =
    !active && stack && !["none", "fade"].includes(stack.playback.transition)
      ? translation
      : "none";
  const nextIndex = stack ? (activeIndex + 1) % stack.panelIds.length : 0;
  const previousIndex = stack
    ? (activeIndex - 1 + stack.panelIds.length) % stack.panelIds.length
    : 0;
  const neighbor =
    stack &&
    dragOffset &&
    ((dragOffset < 0 &&
      memberIndex === nextIndex &&
      (snapshot?.loop || activeIndex < stack.panelIds.length - 1)) ||
      (dragOffset > 0 &&
        memberIndex === previousIndex &&
        (snapshot?.loop || activeIndex > 0)));
  const presented = active || Boolean(neighbor);
  if (stack && dragOffset)
    translate = `translateX(${dragOffset + (active ? 0 : dragOffset < 0 ? rect.width : -rect.width)}px)`;
  const cancelPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };
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
    >
      <div
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
            onPointerDown={(event) => {
              if (editing || event.target.closest("button,input")) return;
              const pointer = {
                clientX: event.clientX,
                clientY: event.clientY,
                pointerId: event.pointerId,
                currentTarget: event.currentTarget,
              };
              press.current = {
                x: event.clientX,
                y: event.clientY,
                timer: setTimeout(() => {
                  onLongPress?.(panel.id, pointer);
                  press.current = null;
                }, 420),
              };
            }}
            onPointerMove={(event) => {
              if (
                press.current &&
                Math.hypot(
                  event.clientX - press.current.x,
                  event.clientY - press.current.y,
                ) > 10
              )
                cancelPress();
            }}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onContextMenu={(event) => {
              event.preventDefault();
              onLongPress?.(panel.id);
            }}
          >
            {editing && (
              <input
                type="checkbox"
                aria-label={`Select ${panel.title}`}
                checked={Boolean(selected)}
                onChange={() => onSelect(panel.id)}
              />
            )}
            <span className="studio-panel-title">
              <small>
                {panel.group ||
                  (panel.kind === "informationWidget"
                    ? "Information"
                    : "Dashboard")}
              </small>
              <strong>{panel.title}</strong>
            </span>
            {editing && (
              <>
                <button
                  className="studio-icon-button studio-move-handle"
                  aria-label={`Move ${panel.title}. Use arrow keys; Shift and arrow keys resize.`}
                  title="Drag to move · arrows to move · Shift + arrows to resize"
                  onPointerDown={(event) =>
                    onManipulate(event, panel.id, "move")
                  }
                  onKeyDown={(event) => onUnitKey(event, panel.id)}
                >
                  <StudioIcon name="grip" />
                </button>
                <button
                  className="studio-icon-button"
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
          onFocusCapture={() =>
            controller?.()?.setBlocked("content-focus", true)
          }
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              controller?.()?.setBlocked("content-focus", false);
          }}
        >
          <RenderNative panel={panel} data={data} />
        </div>
        {editing && !stack && (
          <button
            className="studio-resize-handle"
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
