import { useEffect, useLayoutEffect, useRef } from "react";

import StudioIcon from "./icons";

export default function StudioDialog({
  title,
  eyebrow = "Homepage Studio",
  children,
  onClose,
  wide = false,
  busy = false,
}) {
  const ref = useRef(null);
  const close = useRef(onClose);
  const pendingFocus = useRef(null);
  useLayoutEffect(() => {
    close.current = busy ? null : onClose;
  }, [onClose, busy]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (busy) {
      pendingFocus.current = dialog?.contains(document.activeElement) ? document.activeElement : null;
      // Disabled controls cannot retain focus. Keep it inside the modal even
      // when every form action is unavailable for the duration of a write.
      dialog?.focus();
    } else if (pendingFocus.current) {
      const previous = pendingFocus.current;
      pendingFocus.current = null;
      if (dialog?.contains(previous) && !previous.matches(":disabled,[inert]")) previous.focus();
    }
  }, [busy]);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    const cancel = (event) => {
      event.preventDefault();
      close.current?.();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close?.();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`studio-dialog${wide ? " studio-dialog-wide" : ""}`}
      aria-labelledby="studio-dialog-title"
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        if (busy && event.key === "Tab") {
          event.preventDefault();
          event.currentTarget.focus();
        }
      }}
    >
      <header className="studio-dialog-header">
        <div>
          <p className="studio-eyebrow">{eyebrow}</p>
          <h2 id="studio-dialog-title">{title}</h2>
        </div>
        <button className="studio-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
          <StudioIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function ErrorMessage({ error, onReload, heading }) {
  if (!error) return null;
  return (
    <div className="studio-error" role="alert">
      <strong>
        {heading || (error.status === 409 ? "Another change was saved" : "This change could not be saved")}
      </strong>
      <p>{error.message || String(error)}</p>
      {error.status === 409 && (
        <p>
          Your draft is still here. Copy any changes you need before reloading the current configuration.
          {onReload && (
            <>
              {" "}
              <button type="button" className="studio-text-button" onClick={onReload}>
                Reload current configuration
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
