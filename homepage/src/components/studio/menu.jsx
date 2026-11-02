import { useEffect, useLayoutEffect, useRef, useState } from "react";

import StudioIcon from "./icons";

// One menu for Studio: the page menu, the widget right-click menu and the
// bulk bar's overflow use it. Opened at a point or under a control, kept on
// screen, and driven by the keyboard like a native menu.
export default function Menu({ anchor, items, label, onClose, returnFocus }) {
  const holder = useRef(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y, visibility: "hidden" });
  useLayoutEffect(() => {
    const box = holder.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(anchor.x, window.innerWidth - box.width - margin));
    const below = anchor.y;
    const top =
      below + box.height + margin > window.innerHeight
        ? Math.max(margin, (anchor.above ?? anchor.y) - box.height)
        : below;
    setPosition({ left, top });
  }, [anchor.x, anchor.y, anchor.above]);
  useEffect(() => {
    holder.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    const close = (restore = true) => {
      onClose();
      if (restore) returnFocus?.focus?.();
    };
    const outside = (event) => {
      if (!holder.current?.contains(event.target)) close(false);
    };
    const scroll = () => close(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", scroll);
    };
  }, [onClose, returnFocus]);
  const keyDown = (event) => {
    const entries = [...holder.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const index = entries.indexOf(document.activeElement);
    const go = (next) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(entries.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      returnFocus?.focus?.();
    } else if (event.key === "Tab") onClose();
  };
  return (
    <div
      ref={holder}
      className="studio-menu"
      role="menu"
      aria-label={label}
      style={{ position: "fixed", ...position }}
      onKeyDown={keyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.filter(Boolean).map((item, index) =>
        item === "-" ? (
          <hr key={`separator-${index}`} />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.danger ? "studio-menu-danger" : undefined}
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose();
              if (!item.keepFocus) returnFocus?.focus?.();
              item.onSelect();
            }}
          >
            {item.icon ? <StudioIcon name={item.icon} size={15} /> : <span className="studio-menu-gap" />}
            <span className="studio-menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
