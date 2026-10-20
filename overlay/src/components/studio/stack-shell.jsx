import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useStackGestures } from "./gestures";
import StudioIcon from "./icons";
import { createStackPlayback } from "./playback.mjs";

export default function StackShell({
  stack,
  panels,
  rect,
  editing,
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
  const press = useRef(null);
  const [controller] = useState(() =>
    createStackPlayback({
      ids: stack.panelIds,
      intervalMs: stack.playback.intervalMs,
      manualHoldMs: stack.playback.manualHoldMs,
      loop: stack.playback.loop,
    }),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [announcement, setAnnouncement] = useState("");
  const activePanel = panels.find((panel) => panel.id === snapshot.activeId);
  const gestures = useStackGestures({
    controller,
    disabled: editing,
    onDrag: onStackDrag,
    onManual: (next) =>
      setAnnouncement(
        `${panels.find((panel) => panel.id === next.activeId)?.title || "Widget"}, ${next.activeIndex + 1} of ${next.ids.length}`,
      ),
  });
  const cancelPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };
  useEffect(() => () => clearTimeout(press.current?.timer), []);

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
  }, [
    controller,
    stack.panelIds,
    stack.playback.intervalMs,
    stack.playback.manualHoldMs,
    stack.playback.loop,
  ]);
  useLayoutEffect(() => {
    onActive(stack.id, snapshot.activeId);
  }, [onActive, stack.id, snapshot.activeId]);
  useEffect(() => {
    controller.setBlocked("editing", editing);
  }, [controller, editing]);
  useEffect(() => {
    // Respect reduced motion on initial automatic start. Explicit Play remains available.
    if (stack.playback.mode === "automatic" && !reducedMotion)
      controller.play();
    else controller.pause();
  }, [controller, stack.playback.mode, reducedMotion]);
  useEffect(() => {
    const visibility = () =>
      controller.setBlocked("document-hidden", document.hidden);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    let observer;
    if (typeof IntersectionObserver !== "undefined" && root.current) {
      observer = new IntersectionObserver(
        ([entry]) => controller.setBlocked("offscreen", !entry.isIntersecting),
        { threshold: 0.01 },
      );
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
      className={`studio-stack-shell${editing ? " studio-stack-editing" : ""}`}
      style={rect}
      tabIndex={0}
      aria-label={`${activePanel?.title || "Widget stack"}, ${snapshot.activeIndex + 1} of ${snapshot.ids.length}`}
      aria-roledescription="carousel"
      aria-describedby={`studio-stack-help-${stack.id}`}
      {...gestures}
      onPointerDown={(event) => {
        gestures.onPointerDown(event);
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
            onLongPress?.(stack.id, pointer);
            press.current = null;
          }, 420),
        };
      }}
      onPointerMove={(event) => {
        gestures.onPointerMove(event);
        if (
          press.current &&
          Math.hypot(
            event.clientX - press.current.x,
            event.clientY - press.current.y,
          ) > 10
        )
          cancelPress();
      }}
      onPointerUp={(event) => {
        cancelPress();
        gestures.onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        cancelPress();
        gestures.onPointerCancel(event);
      }}
      onContextMenu={(event) => {
        if (event.target.closest("button,input")) return;
        event.preventDefault();
        onLongPress?.(stack.id);
      }}
    >
      <header className="studio-stack-header">
        <span className="studio-stack-symbol">
          <StudioIcon name="stack" size={16} />
        </span>
        <span className="studio-panel-title">
          <small>Widget stack</small>
          <strong>{activePanel?.title || "Widgets"}</strong>
        </span>
        {editing ? (
          <>
            <button
              className="studio-icon-button studio-move-handle"
              aria-label="Move stack. Arrow keys move; Shift and arrows resize."
              onPointerDown={(event) => onManipulate(event, stack.id, "move")}
              onKeyDown={(event) => onUnitKey(event, stack.id)}
            >
              <StudioIcon name="grip" />
            </button>
            <button
              className="studio-icon-button"
              aria-label="Edit stack"
              onClick={() => onEdit(stack)}
            >
              <StudioIcon name="edit" />
            </button>
          </>
        ) : (
          <button
            className={`studio-icon-button studio-play-button${snapshot.playing ? " studio-playing" : ""}`}
            aria-label={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            title={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            aria-pressed={snapshot.playing}
            onClick={() => controller.toggle()}
          >
            <StudioIcon name={snapshot.playing ? "pause" : "play"} size={16} />
          </button>
        )}
      </header>
      <footer className="studio-stack-footer" aria-hidden="true">
        <span className="studio-stack-dots">
          {snapshot.ids.map((id) => (
            <span
              key={id}
              className={id === snapshot.activeId ? "studio-dot-active" : ""}
            />
          ))}
        </span>
        {snapshot.playing && (
          <span className="studio-playback-status">
            {snapshot.holding
              ? "Holding"
              : snapshot.blockedReasons.length
                ? "Waiting"
                : "Playing"}
          </span>
        )}
      </footer>
      {editing && (
        <button
          className="studio-resize-handle"
          aria-label="Resize stack. Use arrow keys."
          onPointerDown={(event) => onManipulate(event, stack.id, "resize")}
          onKeyDown={(event) => onUnitKey(event, stack.id, "resize")}
        >
          <StudioIcon name="resize" size={16} />
        </button>
      )}
      <span id={`studio-stack-help-${stack.id}`} className="studio-sr-only">
        Swipe across the stack header, drag horizontally, use a horizontal
        trackpad gesture, or focus this stack and press the left and right arrow
        keys. Manual switching while playing holds this widget for{" "}
        {Math.max(snapshot.intervalMs, snapshot.manualHoldMs) / 1000} seconds.
        The Play button starts or pauses rotation.
      </span>
      <span className="studio-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}
