import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useLongPress, useStackGestures } from "./gestures";
import StudioIcon from "./icons";
import { createStackPlayback } from "./playback.mjs";

export default function StackShell({
  stack,
  panels,
  rect,
  editing,
  selected = false,
  onSelect,
  busy = false,
  overlayOpen = false,
  reducedMotion,
  onActive,
  registerController,
  onEdit,
  onManipulate,
  onUnitKey,
  onLongPress,
  onStackDrag,
}) {
  const root = useRef(null);
  const lifecycle = useRef(0);
  const [controller] = useState(() =>
    createStackPlayback({
      ids: stack.panelIds,
      intervalMs: stack.playback.intervalMs,
      manualHoldMs: stack.playback.manualHoldMs,
      loop: stack.playback.loop,
    }),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [announcement, setAnnouncement] = useState("");
  const activePanel = panels.find((panel) => panel.id === snapshot.activeId);
  const gestures = useStackGestures({
    controller,
    disabled: editing || busy || overlayOpen,
    onDrag: onStackDrag,
    onManual: (next) =>
      setAnnouncement(
        `${panels.find((panel) => panel.id === next.activeId)?.title || "Widget"}, ${next.activeIndex + 1} of ${next.ids.length}`,
      ),
  });
  const press = useLongPress({
    disabled: busy || overlayOpen || !onLongPress,
    onLongPress: (pointer) => onLongPress?.(stack.id, pointer),
    accepts: (event) => !event.target.closest("button,input,.studio-select-target"),
  });

  useEffect(() => {
    const token = ++lifecycle.current;
    const disposeIfStillUnmounted = () => {
      if (lifecycle.current === token) controller.destroy();
    };
    registerController(stack.id, controller);
    return () => {
      registerController(stack.id, null);
      controller.pause();
      // React Strict Mode replays effects. Dispose only after a genuine unmount.
      queueMicrotask(disposeIfStillUnmounted);
    };
  }, [stack.id, controller, registerController, lifecycle]);
  useEffect(() => {
    controller.update({
      ids: stack.panelIds,
      intervalMs: stack.playback.intervalMs,
      manualHoldMs: stack.playback.manualHoldMs,
      loop: stack.playback.loop,
    });
  }, [controller, stack.panelIds, stack.playback.intervalMs, stack.playback.manualHoldMs, stack.playback.loop]);
  useLayoutEffect(() => {
    onActive(stack.id, snapshot.activeId);
  }, [onActive, stack.id, snapshot.activeId]);
  useEffect(() => {
    controller.setBlocked("editing", editing || busy);
  }, [controller, editing, busy]);
  useEffect(() => {
    controller.setBlocked("overlay", overlayOpen);
  }, [controller, overlayOpen]);
  useEffect(() => {
    // Respect reduced motion on initial automatic start. Explicit Play remains available.
    if (stack.playback.mode === "automatic" && !reducedMotion) controller.play();
    else controller.pause();
  }, [controller, stack.playback.mode, reducedMotion]);
  useEffect(() => {
    const visibility = () => controller.setBlocked("document-hidden", document.hidden);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    let observer;
    if (typeof IntersectionObserver !== "undefined" && root.current) {
      observer = new IntersectionObserver(([entry]) => controller.setBlocked("offscreen", !entry.isIntersecting), {
        threshold: 0.01,
      });
      observer.observe(root.current);
    }
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      observer?.disconnect();
    };
  }, [controller]);

  return (
    <section
      ref={root}
      className={`studio-stack-shell${editing ? " studio-stack-editing" : ""}${selected ? " studio-selected" : ""}`}
      data-stack-shell-id={stack.id}
      style={rect}
      tabIndex={0}
      aria-label={`${activePanel?.title || "Widget stack"}, ${snapshot.activeIndex + 1} of ${snapshot.ids.length}`}
      aria-roledescription="carousel"
      aria-describedby={`studio-stack-help-${stack.id}`}
      {...gestures}
      onPointerDown={(event) => {
        gestures.onPointerDown(event);
        press.onPointerDown(event);
      }}
      onPointerMove={(event) => {
        gestures.onPointerMove(event);
        press.onPointerMove(event);
      }}
      onPointerUp={(event) => {
        press.onPointerUp(event);
        gestures.onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        press.onPointerCancel(event);
        gestures.onPointerCancel(event);
      }}
      onContextMenu={(event) => {
        press.cancel();
        if (busy || !onLongPress || event.target.closest("button,input,.studio-select-target")) return;
        event.preventDefault();
        onLongPress?.(stack.id, { clientX: event.clientX, clientY: event.clientY });
      }}
    >
      {/* Board 4: the stack draws as the widget it is showing, with no bar of
          its own. While editing, it has the same select, move and edit
          controls as any widget, in the same places. */}
      {editing && onSelect && (
        <label className="studio-select-target studio-select-corner studio-stack-control">
          <input
            type="checkbox"
            className="studio-select-input"
            aria-label={`Select stack ${activePanel?.title || "Widgets"}`}
            checked={Boolean(selected)}
            disabled={busy}
            onChange={() => onSelect(stack.id)}
          />
          <span className="studio-select-box" aria-hidden="true">
            <StudioIcon name="check" size={13} />
          </span>
        </label>
      )}
      {editing && (
        <div className="studio-stack-tools studio-stack-control">
          <button
            className="studio-icon-button studio-move-handle"
            disabled={busy}
            aria-label="Move stack. Arrow keys move; Shift and arrows resize."
            onPointerDown={(event) => onManipulate(event, stack.id, "move")}
            onKeyDown={(event) => onUnitKey(event, stack.id)}
          >
            <StudioIcon name="grip" />
          </button>
          <button className="studio-icon-button" disabled={busy} aria-label="Edit stack" onClick={() => onEdit(stack)}>
            <StudioIcon name="edit" />
          </button>
        </div>
      )}
      {/* Page dots to jump to a widget, and Play/Pause, at the bottom edge. */}
      <footer className="studio-stack-footer">
        <span className="studio-stack-dots" role="group" aria-label="Widgets in this stack">
          {snapshot.ids.map((id, index) => {
            const title = panels.find((panel) => panel.id === id)?.title || "Widget";
            return (
              <button
                key={id}
                type="button"
                className={id === snapshot.activeId ? "studio-dot-active" : undefined}
                aria-label={`Show ${title}, ${index + 1} of ${snapshot.ids.length}`}
                aria-current={id === snapshot.activeId || undefined}
                disabled={busy || overlayOpen}
                onClick={() => {
                  controller.select(id, { manual: true });
                  setAnnouncement(`${title}, ${index + 1} of ${snapshot.ids.length}`);
                }}
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
        </span>
        {!editing && (
          <button
            type="button"
            className={`studio-stack-play${snapshot.playing ? " studio-playing" : ""}`}
            disabled={busy}
            aria-label={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            title={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            onClick={() => controller.toggle()}
          >
            <StudioIcon name={snapshot.playing ? "pause" : "play"} size={12} />
          </button>
        )}
      </footer>
      {editing && (
        <button
          className="studio-resize-handle"
          disabled={busy}
          aria-label="Resize stack. Use arrow keys."
          onPointerDown={(event) => onManipulate(event, stack.id, "resize")}
          onKeyDown={(event) => onUnitKey(event, stack.id, "resize")}
        >
          <StudioIcon name="resize" size={16} />
        </button>
      )}
      <span id={`studio-stack-help-${stack.id}`} className="studio-sr-only">
        Swipe across the widget, drag horizontally, use a horizontal trackpad gesture, or focus this stack and press the
        left and right arrow keys. Manual switching while playing holds this widget for{" "}
        {Math.max(snapshot.intervalMs, snapshot.manualHoldMs) / 1000} seconds. The Play button starts or pauses
        rotation. The page dots choose a widget directly.
      </span>
      <span className="studio-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}
