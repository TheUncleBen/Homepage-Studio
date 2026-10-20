import { useEffect, useLayoutEffect, useRef } from "react";

import StudioIcon from "./icons";

export default function StudioDialog({
  title,
  eyebrow = "Homepage Studio",
  children,
  onClose,
  wide = false,
}) {
  const ref = useRef(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
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
      className={`studio-dialog${wide ? " studio-dialog-wide" : ""}`}
      aria-labelledby="studio-dialog-title"
    >
      <header className="studio-dialog-header">
        <div>
          <p className="studio-eyebrow">{eyebrow}</p>
          <h2 id="studio-dialog-title">{title}</h2>
        </div>
        <button
          className="studio-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <StudioIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function ErrorMessage({ error, onReload }) {
  if (!error) return null;
  return (
    <div className="studio-error" role="alert">
      <strong>
        {error.status === 409
          ? "Another change was saved"
          : "This change could not be saved"}
      </strong>
      <p>{error.message || String(error)}</p>
      {error.status === 409 && (
        <p>
          Your draft is still here. Copy any changes you need before reloading
          the current configuration.
          {onReload && (
            <>
              {" "}
              <button
                type="button"
                className="studio-text-button"
                onClick={onReload}
              >
                Reload current configuration
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
