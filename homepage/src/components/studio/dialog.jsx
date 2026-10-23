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

// Sign-in answers that need the person to act in the sign-in pages.
function signInAction(error) {
  const code = error?.details?.code;
  if (typeof window === "undefined" || (code !== "REAUTH_REQUIRED" && code !== "AUTH_REQUIRED")) return null;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  return code === "REAUTH_REQUIRED"
    ? { heading: "Confirm it’s you", href: `/__studio/auth/sign-in?reauth=1&next=${next}`, label: "Confirm it’s you" }
    : { heading: "Your session has ended", href: `/__studio/auth/sign-in?next=${next}`, label: "Sign in again" };
}

export function ErrorMessage({ error, onReload, heading, arrangement = false }) {
  if (!error) return null;
  const action = signInAction(error);
  if (action)
    return (
      <div className="studio-error" role="alert">
        <strong>{action.heading}</strong>
        <p>
          {error.message}{" "}
          <a className="studio-text-button" href={action.href}>
            {action.label}
          </a>
        </p>
      </div>
    );
  return (
    <div className="studio-error" role="alert">
      <strong>
        {heading || (error.status === 409 ? "Another change was saved" : "This change could not be saved")}
      </strong>
      <p>{error.message || String(error)}</p>
      {error.status === 409 && (
        <p>
          {arrangement
            ? "Your unsaved arrangement is still shown. Reloading the current configuration discards it; afterwards, repeat any moves you still want."
            : "Your draft is still here. Copy any changes you need before reloading the current configuration."}
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
