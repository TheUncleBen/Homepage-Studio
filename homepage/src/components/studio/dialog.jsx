import { useEffect, useLayoutEffect, useRef } from "react";

import StudioIcon from "./icons";

// docked: a widget's editor on a wide screen, a panel down the right with
// the board visible beside it (owner T26, 6 Nov 2026).
export default function StudioDialog({
  title,
  eyebrow,
  children,
  onClose,
  onBack,
  wide = false,
  docked = false,
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
  // Docked, the dialog is not modal, so the board beside it still takes
  // input (resize the card, open another one); otherwise it is.
  const mode = useRef(null);
  const previousFocus = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const want = docked ? "docked" : "modal";
    if (mode.current === want) return;
    if (mode.current === null) previousFocus.current = document.activeElement;
    if (!dialog.showModal) dialog.setAttribute("open", "");
    else {
      if (dialog.open) dialog.close();
      if (docked) dialog.show();
      else dialog.showModal();
    }
    mode.current = want;
  }, [docked]);
  useEffect(() => {
    const previous = previousFocus.current;
    const dialog = ref.current;
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
      className={`studio-dialog${wide ? " studio-dialog-wide" : ""}${docked ? " studio-dialog-docked" : ""}`}
      aria-labelledby="studio-dialog-title"
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        // A modal dialog hears Esc as its cancel event; a docked one here.
        if (docked && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close.current?.();
          return;
        }
        if (busy && event.key === "Tab") {
          event.preventDefault();
          event.currentTarget.focus();
        }
      }}
    >
      <header className={`studio-dialog-header${onBack ? " studio-dialog-header-back" : ""}`}>
        {onBack && (
          <button className="studio-icon-button" aria-label="Back" disabled={busy} onClick={onBack}>
            <StudioIcon name="chevron" className="studio-back-chevron" />
          </button>
        )}
        <div>
          {eyebrow && <p className="studio-eyebrow">{eyebrow}</p>}
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
  // Both open in a new tab so unsaved work on this page survives. After
  // confirming, the person comes back and saves again.
  return code === "REAUTH_REQUIRED"
    ? {
        heading: "Confirm it’s you",
        href: `/studio/auth/sign-in?reauth=1&next=${encodeURIComponent("/studio/account?confirmed=1")}`,
        label: "Confirm in a new tab",
        after: "Your changes stay here. Once you have confirmed, try again.",
      }
    : {
        heading: "Your session has ended",
        href: `/studio/auth/sign-in?next=${encodeURIComponent("/studio/account?confirmed=1")}`,
        label: "Sign in again in a new tab",
        after: "Your changes stay here. Once you have signed in, try again.",
      };
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
          <a className="studio-text-button" href={action.href} target="_blank" rel="noopener noreferrer">
            {action.label}
          </a>
        </p>
        <p>{action.after}</p>
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
