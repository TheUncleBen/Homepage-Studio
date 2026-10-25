import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { useLongPress, useStackGestures } from "./gestures";
import StudioIcon from "./icons";
import { createStackPlayback } from "./playback.mjs";
import StackTitlePicker from "./stack-title-picker";

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
  const membership = stack.panelIds.join("|");
  const [pickerMembers, setPickerMembers] = useState(null);
  const pickerOpen = pickerMembers !== null;
  // The restriction is reflected in this same render, so ending an edit/save
  // can never reopen a picker that was open before it began.
  if (pickerOpen && (editing || busy || overlayOpen || pickerMembers !== membership)) setPickerMembers(null);
  const activePanel = panels.find((panel) => panel.id === snapshot.activeId);
  const gestures = useStackGestures({
    controller,
    disabled: editing || busy || pickerOpen || overlayOpen,
    onDrag: onStackDrag,
    onManual: (next) =>
      setAnnouncement(
        `${panels.find((panel) => panel.id === next.activeId)?.title || "Widget"}, ${next.activeIndex + 1} of ${next.ids.length}`,
      ),
  });
  const press = useLongPress({
    disabled: editing || busy || pickerOpen || overlayOpen || !onLongPress,
    onLongPress: (pointer) => onLongPress?.(stack.id, pointer),
    accepts: (event) =>
      !event.target.closest("button,input,.studio-select-target") ||
      Boolean(event.target.closest("[data-studio-stack-title]")),
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
    controller.setBlocked("picker", pickerOpen && !editing && !busy);
    return () => controller.setBlocked("picker", false);
  }, [controller, pickerOpen, editing, busy]);
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
        if (
          busy ||
          !onLongPress ||
          (event.target.closest("button,input,.studio-select-target") &&
            !event.target.closest("[data-studio-stack-title]"))
        )
          return;
        event.preventDefault();
        onLongPress?.(stack.id);
      }}
    >
      <header className="studio-stack-header">
        {editing && onSelect && (
          // The same enlarged selection target as a panel header's checkbox.
          <label className="studio-select-target">
            <input
              type="checkbox"
              aria-label={`Select stack ${activePanel?.title || "Widgets"}`}
              checked={Boolean(selected)}
              disabled={busy}
              onChange={() => onSelect(stack.id)}
            />
          </label>
        )}
        <span className="studio-stack-symbol">
          <StudioIcon name="stack" size={16} />
        </span>
        <StackTitlePicker
          stackId={stack.id}
          panels={stack.panelIds.map((id) => panels.find((panel) => panel.id === id)).filter(Boolean)}
          activeId={snapshot.activeId}
          open={pickerOpen}
          disabled={editing || busy || overlayOpen}
          onOpen={() => setPickerMembers(membership)}
          onClose={() => setPickerMembers(null)}
          onSelect={(id) => {
            controller.select(id, { manual: true });
            const next = controller.getSnapshot();
            setAnnouncement(
              `${panels.find((panel) => panel.id === id)?.title || "Widget"}, ${next.activeIndex + 1} of ${next.ids.length}`,
            );
          }}
        />
        {editing ? (
          <>
            <button
              className="studio-icon-button studio-move-handle"
              disabled={busy}
              aria-label="Move stack. Arrow keys move; Shift and arrows resize."
              onPointerDown={(event) => onManipulate(event, stack.id, "move")}
              onKeyDown={(event) => onUnitKey(event, stack.id)}
            >
              <StudioIcon name="grip" />
            </button>
            <button
              className="studio-icon-button"
              disabled={busy}
              aria-label="Edit stack"
              onClick={() => onEdit(stack)}
            >
              <StudioIcon name="edit" />
            </button>
          </>
        ) : (
          <button
            className={`studio-icon-button studio-play-button${snapshot.playing ? " studio-playing" : ""}`}
            disabled={busy}
            aria-label={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            title={snapshot.playing ? "Pause slideshow" : "Play slideshow"}
            onClick={() => controller.toggle()}
          >
            <StudioIcon name={snapshot.playing ? "pause" : "play"} size={16} />
          </button>
        )}
      </header>
      <footer className="studio-stack-footer" aria-hidden="true">
        <span className="studio-stack-dots">
          {snapshot.ids.map((id) => (
            <span key={id} className={id === snapshot.activeId ? "studio-dot-active" : ""} />
          ))}
        </span>
        {snapshot.playing && (
          <span className="studio-playback-status">
            {snapshot.holding ? "Holding" : snapshot.blockedReasons.length ? "Waiting" : "Playing"}
          </span>
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
        Swipe across the stack header or widget, drag horizontally, use a horizontal trackpad gesture, or focus this stack and
        press the left and right arrow keys. Manual switching while playing holds this widget for{" "}
        {Math.max(snapshot.intervalMs, snapshot.manualHoldMs) / 1000} seconds. The Play button starts or pauses
        rotation. Activate the widget title to choose a widget directly.
      </span>
      <span className="studio-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}
