import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

function PickerMenu({ anchor, id, panels, activeId, onSelect, onClose }) {
  const menu = useRef(null);
  useLayoutEffect(() => {
    const trigger = anchor.current;
    const position = () => {
      const bounds = trigger?.getBoundingClientRect();
      const element = menu.current;
      if (!bounds || !element) return;
      const width = Math.min(320, window.innerWidth - 24);
      element.style.width = `${width}px`;
      element.style.maxHeight = `${Math.max(80, window.innerHeight - 24)}px`;
      element.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
      const height = element.getBoundingClientRect().height;
      const below = bounds.bottom + 8;
      element.style.top = `${Math.max(12, Math.min(below + height > window.innerHeight - 12 ? bounds.top - height - 8 : below, window.innerHeight - height - 12))}px`;
    };
    position();
    // Position before focusing: a hidden/measurement-only element must never
    // swallow the first keyboard action in a real browser.
    const element = menu.current;
    (element?.querySelector('[aria-checked="true"]') || element?.querySelector("button"))?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (element?.contains(document.activeElement) && !trigger?.disabled) trigger?.focus();
    };
  }, [anchor]);
  useEffect(() => {
    const outside = (event) => {
      if (!menu.current?.contains(event.target) && !anchor.current?.contains(event.target)) onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className="studio-stack-picker"
      role="menu"
      aria-label="Choose widget in this stack"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          onClose(true);
          return;
        }
        const buttons = [...menu.current.querySelectorAll('[role="menuitemradio"]')];
        const index = buttons.indexOf(document.activeElement);
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (index + buttons.length - 1) % buttons.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : null;
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          buttons[next]?.focus();
        }
      }}
    >
      <p className="studio-stack-picker-heading">Choose widget</p>
      {panels.map((panel, index) => (
        <button
          key={panel.id}
          type="button"
          role="menuitemradio"
          aria-label={`${panel.title || "Widget"} ${index + 1} of ${panels.length}`}
          aria-checked={panel.id === activeId}
          tabIndex={panel.id === activeId ? 0 : -1}
          onClick={() => {
            onSelect(panel.id);
            onClose(true);
          }}
        >
          <span>{panel.title || "Widget"}</span>
          <small>
            {index + 1} of {panels.length}
          </small>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function StackTitlePicker({ stackId, panels, activeId, open, disabled, onOpen, onClose, onSelect }) {
  const anchor = useRef(null);
  const pointer = useRef(null);
  useEffect(() => {
    const additionalPointer = (event) => {
      const start = pointer.current;
      if (start && !start.released && event.pointerId !== start.id) start.valid = false;
    };
    // A second finger can land outside this title or even outside this stack.
    // It still makes the original interaction a gesture, never a picker tap.
    document.addEventListener("pointerdown", additionalPointer, true);
    return () => document.removeEventListener("pointerdown", additionalPointer, true);
  }, []);
  const active = panels.find((panel) => panel.id === activeId);
  const id = `studio-stack-picker-${stackId}`;
  const close = (restore = true) => {
    onClose();
    if (restore) anchor.current?.focus();
  };
  const invalidate = () => {
    if (pointer.current) pointer.current.valid = false;
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="studio-panel-title studio-stack-title"
        data-studio-stack-title
        aria-label={`Choose widget in stack: ${active?.title || "Widgets"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onPointerDown={(event) => {
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            time: Date.now(),
            valid: event.button === 0 && event.isPrimary !== false,
            released: false,
          };
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (
            start &&
            (event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
          )
            invalidate();
        }}
        onPointerUp={(event) => {
          const start = pointer.current;
          if (!start) return;
          start.released = true;
          if (
            event.pointerId !== start.id ||
            Date.now() - start.time > 350 ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
          )
            invalidate();
        }}
        onPointerCancel={invalidate}
        onContextMenu={invalidate}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) pointer.current = null;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) onOpen();
          }
        }}
        onClick={(event) => {
          event.stopPropagation();
          const start = pointer.current;
          pointer.current = null;
          if (
            disabled ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (event.detail !== 0 && (!start?.valid || !start.released))
          )
            return;
          if (open) close();
          else onOpen();
        }}
      >
        <small>Widget stack</small>
        <strong>{active?.title || "Widgets"}</strong>
      </button>
      {open && !disabled && (
        <PickerMenu anchor={anchor} id={id} panels={panels} activeId={activeId} onSelect={onSelect} onClose={close} />
      )}
    </>
  );
}
