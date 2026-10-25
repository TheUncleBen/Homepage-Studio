import { useEffect, useRef, useState } from "react";

import StudioIcon from "./icons";

// The Studio pages served by the controller (Dashboards, account and
// administration) draw the same bar from server/auth/ui/app.js. Keep the two
// in step: same items, same order, same sizes.
export const DASHBOARDS_PAGE = "/studio/dashboards";
const ACCOUNT_PAGE = "/studio/account";
const ADMIN_PAGE = "/studio/admin";
const OVERVIEW = "/studio/api/overview";
export const STUDIO_LOGO = "/studio/brand/logo.svg";
// Studio pages, not pages of this Next.js app, so they load in full.
const SIGNED_OUT_PAGE = "/studio/auth/sign-in?signedOut=1";

async function signOut() {
  let next = SIGNED_OUT_PAGE;
  try {
    const response = await fetch("/studio/auth/sign-out", {
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

// Closes a popover on an outside press or Escape, returning focus to its button.
function useDismiss(open, setOpen, holder) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!holder.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        holder.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open, setOpen, holder]);
}

// The name at the top left opens a list of the dashboards this person can
// open, with "All dashboards" (the Dashboards page) first.
function DashboardSwitcher({ name, currentId }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const holder = useRef(null);
  useDismiss(open, setOpen, holder);
  useEffect(() => {
    if (!open || list) return;
    fetch(OVERVIEW, { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((view) => setList(view.dashboards.filter((entry) => !entry.archived && entry.path)))
      .catch(() => setFailed(true));
  }, [open, list]);
  return (
    <div className="studio-switcher" ref={holder}>
      <button
        type="button"
        className="studio-switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}. Switch dashboard`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="studio-switcher-name">{name}</span>
        <StudioIcon name="down" size={16} />
      </button>
      {open && (
        <div className="studio-switcher-popover" role="menu">
          <a role="menuitem" href={DASHBOARDS_PAGE}>
            All dashboards
          </a>
          <hr />
          {!list && !failed && <p className="studio-switcher-note">Loading…</p>}
          {failed && <p className="studio-switcher-note">The list could not load. Use All dashboards.</p>}
          {list?.map((entry) => (
            <a
              key={entry.id}
              role="menuitem"
              href={entry.path}
              aria-current={entry.id === currentId ? "page" : undefined}
            >
              {entry.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudioTopBar({ title, dashboardId, logo, access, onSearch, searchDisabled = false }) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  useDismiss(open, setOpen, menu);
  const user = access?.authEnabled ? access.user : null;
  const isAdmin = !access?.authEnabled || user?.role === "admin";
  const name = user ? user.displayName || user.username : "";
  return (
    <header className="studio-topbar">
      <a className="studio-brand" href={DASHBOARDS_PAGE} aria-label="All dashboards">
        <img className="studio-brand-logo" src={logo || STUDIO_LOGO} alt="" width={30} height={30} />
      </a>
      <DashboardSwitcher name={title} currentId={dashboardId} />
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
