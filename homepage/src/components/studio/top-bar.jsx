import { useEffect, useRef, useState } from "react";

import StudioIcon from "./icons";

// The Studio pages served by the controller (Dashboards, account and
// administration) draw the same bar from server/auth/ui/app.js. Keep the two
// in step: same items, same order, same sizes.
export const DASHBOARDS_PAGE = "/__studio/dashboards";
const ACCOUNT_PAGE = "/__studio/account";
const ADMIN_PAGE = "/__studio/admin";
// Studio pages, not pages of this Next.js app, so they load in full.
const SIGNED_OUT_PAGE = "/__studio/auth/sign-in?signedOut=1";

async function signOut() {
  let next = SIGNED_OUT_PAGE;
  try {
    const response = await fetch("/__studio/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-studio-request": "1" },
      body: "{}",
    });
    const result = await response.json().catch(() => ({}));
    // An identity provider sign-out page ends that session too.
    if (result.logoutUrl) next = result.logoutUrl;
  } catch {
    // Signed out locally or not, the sign-in page shows where things stand.
  }
  window.location.assign(next);
}

export default function StudioTopBar({ title, access, onSearch, searchDisabled = false }) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  const user = access?.authEnabled ? access.user : null;
  const isAdmin = !access?.authEnabled || user?.role === "admin";
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!menu.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        menu.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const name = user ? user.displayName || user.username : "";
  return (
    <header className="studio-topbar">
      <a className="studio-brand" href={DASHBOARDS_PAGE} aria-label="Dashboards">
        <span className="studio-brand-mark">
          <StudioIcon name="layout" size={16} />
        </span>
      </a>
      <span className="studio-topbar-title">{title}</span>
      <nav className="studio-top-actions" aria-label="Studio">
        {onSearch && (
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Quick Launch"
            aria-keyshortcuts="Control+K Meta+K"
            title="Quick Launch (Ctrl / ⌘ K)"
            disabled={searchDisabled}
            onClick={onSearch}
          >
            <StudioIcon name="search" size={17} />
          </button>
        )}
        <a className={`studio-top-link${user ? " studio-wide-only" : ""}`} href={DASHBOARDS_PAGE}>
          Dashboards
        </a>
        {user && isAdmin && (
          <a className="studio-top-link studio-wide-only" href={ADMIN_PAGE}>
            Administration
          </a>
        )}
        {user && (
          <div className="studio-account-menu" ref={menu}>
            <button
              type="button"
              className="studio-icon-button studio-account-button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Account: ${name}`}
              title={name}
              onClick={() => setOpen((value) => !value)}
            >
              <StudioIcon name="user" size={17} />
            </button>
            {open && (
              <div className="studio-account-popover" role="menu">
                <p className="studio-account-name">{name}</p>
                <a role="menuitem" className="studio-menu-narrow" href={DASHBOARDS_PAGE}>
                  Dashboards
                </a>
                {isAdmin && (
                  <a role="menuitem" className="studio-menu-narrow" href={ADMIN_PAGE}>
                    Administration
                  </a>
                )}
                <a role="menuitem" href={ACCOUNT_PAGE}>
                  My account
                </a>
                <button type="button" role="menuitem" onClick={signOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}
