import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { PAGE_NAME_LIMIT, pageHash, pageNameProblem, unitsOnPage } from "./geometry.mjs";
import { IconChooser } from "./icon-chooser";
import StudioIcon from "./icons";
import Menu from "./menu";

import ResolvedIcon from "components/resolvedicon";

const MORE_WIDTH = 92;

function PageLabel({ page }) {
  return (
    <>
      {page.icon && (
        <span className="studio-page-icon" aria-hidden="true">
          <ResolvedIcon icon={page.icon} width={16} height={16} alt="" />
        </span>
      )}
      <span className="studio-page-name">{page.name}</span>
    </>
  );
}

// Viewing: links, one per page, so every page has an address and back and
// forward move between pages. Tabs that don't fit go into a "more" menu; the
// current page always stays visible.
function LiveTabs({ board, pages, currentId, onSelect, dropTarget }) {
  const holder = useRef(null);
  const measure = useRef(null);
  const [fit, setFit] = useState(pages.length);
  const [menu, setMenu] = useState(null);
  useLayoutEffect(() => {
    const update = () => {
      if (!holder.current || !measure.current) return;
      // The tabs sit inside the bar's padding.
      const style = getComputedStyle(holder.current);
      const available =
        holder.current.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const widths = [...measure.current.children].map((child) => child.getBoundingClientRect().width + 4);
      const total = widths.reduce((sum, value) => sum + value, 0);
      if (total <= available || !available) return setFit(pages.length);
      let used = MORE_WIDTH;
      let count = 0;
      for (const width of widths) {
        if (used + width > available) break;
        used += width;
        count += 1;
      }
      setFit(Math.max(1, count));
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [pages]);
  const currentIndex = pages.findIndex((page) => page.id === currentId);
  let shown = pages.slice(0, fit);
  if (currentIndex >= fit) shown = [...pages.slice(0, Math.max(0, fit - 1)), pages[currentIndex]];
  const hidden = pages.filter((page) => !shown.includes(page));
  const open = (event, page) => {
    // Let the browser handle new-tab clicks; an ordinary click switches here.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(page.id);
  };
  return (
    <nav className="studio-pages" aria-label="Pages" ref={holder}>
      <div className="studio-pages-measure" aria-hidden="true" ref={measure}>
        {pages.map((page) => (
          <span className="studio-page-tab" key={page.id}>
            <PageLabel page={page} />
          </span>
        ))}
      </div>
      {shown.map((page) => (
        <a
          key={page.id}
          href={pageHash(board, page.id)}
          className={`studio-page-tab${dropTarget === page.id ? " studio-page-drop" : ""}`}
          data-page-drop={page.id}
          aria-current={page.id === currentId ? "page" : undefined}
          onClick={(event) => open(event, page)}
        >
          <PageLabel page={page} />
        </a>
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          className="studio-page-tab studio-page-more"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ x: box.left, y: box.bottom + 4, from: event.currentTarget });
          }}
        >
          {hidden.length} more
          <StudioIcon name="down" size={13} />
        </button>
      )}
      {menu && (
        <Menu
          anchor={menu}
          label="More pages"
          returnFocus={menu.from}
          onClose={() => setMenu(null)}
          items={hidden.map((page) => ({ id: page.id, label: page.name, onSelect: () => onSelect(page.id) }))}
        />
      )}
    </nav>
  );
}

function RenameField({ board, page, onDone, onCancel, onEscape = onCancel }) {
  const [value, setValue] = useState(page.name);
  const input = useRef(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const problem = pageNameProblem(board, value, page.id);
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    if (problem || value.trim() === page.name) onCancel();
    else onDone(value.trim());
  };
  return (
    <span className="studio-page-tab studio-page-renaming">
      <input
        ref={input}
        aria-label="Page name"
        aria-invalid={Boolean(problem) || undefined}
        aria-describedby={problem ? `page-name-problem-${page.id}` : undefined}
        maxLength={PAGE_NAME_LIMIT}
        value={value}
        size={Math.max(6, value.length + 1)}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!problem) commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finished.current = true;
            onEscape();
          }
        }}
      />
      {problem && value.trim() !== page.name && (
        <span className="studio-page-problem" id={`page-name-problem-${page.id}`} role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

// Editing: the same tabs plus a grip to reorder, a menu on the current page,
// rename in place and Add page.
function EditTabs({
  board,
  pages,
  currentId,
  onSelect,
  disabled,
  dropTarget,
  actions,
  renaming,
  setRenaming,
  onCancelRename,
}) {
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);
  const tabs = useRef(new Map());
  const order = drag ? drag.order : pages;
  const startDrag = (event, page) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const centres = pages.map((item) => {
      const box = tabs.current.get(item.id)?.getBoundingClientRect();
      return box ? box.left + box.width / 2 : 0;
    });
    const from = pages.indexOf(page);
    const startX = event.clientX;
    let latest = pages;
    const move = (moveEvent) => {
      const x = centres[from] + moveEvent.clientX - startX;
      let index = centres.findIndex((centre) => x < centre);
      if (index < 0) index = pages.length - 1;
      else if (index > from) index -= 1;
      const next = pages.filter((item) => item !== page);
      next.splice(index, 0, page);
      latest = next;
      setDrag({ id: page.id, order: next });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      const index = latest.indexOf(page);
      if (index !== from) actions.move(page.id, index);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  const index = pages.findIndex((page) => page.id === currentId);
  const current = pages[index];
  const scroller = useRef(null);
  // The page being edited is always in view.
  useEffect(() => {
    tabs.current.get(currentId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentId]);
  const openMenu = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom + 4, from: event.currentTarget });
  };
  return (
    <nav className="studio-pages studio-pages-editing" aria-label="Pages">
      {/* The tabs scroll; Add page stays in view after them. */}
      <div className="studio-pages-scroll" ref={scroller}>
        {order.map((page) =>
          renaming === page.id ? (
            <RenameField
              key={page.id}
              board={board}
              page={page}
              onDone={(name) => {
                setRenaming(null);
                actions.rename(page.id, name);
              }}
              onCancel={() => setRenaming(null)}
              onEscape={() => onCancelRename(page.id)}
            />
          ) : (
            <span
              key={page.id}
              ref={(node) => (node ? tabs.current.set(page.id, node) : tabs.current.delete(page.id))}
              className={`studio-page-tab${dropTarget === page.id ? " studio-page-drop" : ""}${drag?.id === page.id ? " studio-page-dragging" : ""}`}
              data-page-drop={page.id}
              aria-current={page.id === currentId ? "page" : undefined}
            >
              {pages.length > 1 && (
                <span
                  className="studio-page-grip"
                  aria-hidden="true"
                  title="Drag to reorder"
                  onPointerDown={(event) => startDrag(event, page)}
                >
                  <StudioIcon name="grip" size={12} />
                </span>
              )}
              <button
                type="button"
                className="studio-page-select"
                disabled={disabled}
                aria-pressed={page.id === currentId}
                title={page.id === currentId ? "Double-click or press F2 to rename" : undefined}
                onClick={() => onSelect(page.id)}
                onDoubleClick={() => !disabled && setRenaming(page.id)}
                onKeyDown={(event) => {
                  if (event.key === "F2" && !disabled) {
                    event.preventDefault();
                    setRenaming(page.id);
                  }
                }}
              >
                <PageLabel page={page} />
              </button>
              {page.id === currentId && (
                <button
                  type="button"
                  className="studio-page-menu-button"
                  aria-label={`${page.name} page options`}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(menu)}
                  disabled={disabled}
                  onClick={openMenu}
                >
                  <StudioIcon name="more" size={15} />
                </button>
              )}
            </span>
          ),
        )}
      </div>
      {actions.canAdd && (
        <button
          type="button"
          className="studio-page-add"
          disabled={disabled}
          aria-label="Add page"
          onClick={actions.add}
        >
          <StudioIcon name="plus" size={14} />
          <span className="studio-page-add-label">Add page</span>
        </button>
      )}
      {menu && current && (
        <Menu
          anchor={menu}
          label={`${current.name} page`}
          returnFocus={menu.from}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "rename",
              label: "Rename",
              icon: "edit",
              shortcut: "F2",
              onSelect: () => setRenaming(current.id),
              keepFocus: true,
            },
            {
              id: "icon",
              label: current.icon ? "Change icon…" : "Icon…",
              icon: "tag",
              onSelect: () => actions.icon(current),
            },
            actions.background && {
              id: "background",
              label: "Page background…",
              icon: "image",
              onSelect: () => actions.background(current),
            },
            actions.duplicate && {
              id: "duplicate",
              label: "Duplicate page",
              icon: "copy",
              disabled: !actions.canAdd,
              onSelect: () => actions.duplicate(current),
            },
            index > 0 && {
              id: "left",
              label: "Move left",
              icon: "arrowLeft",
              onSelect: () => actions.move(current.id, index - 1),
            },
            index < pages.length - 1 && {
              id: "right",
              label: "Move right",
              icon: "arrowRight",
              onSelect: () => actions.move(current.id, index + 1),
            },
            // With two pages before it, Move left already does this.
            index > 1 && {
              id: "first",
              label: "Make first page",
              icon: "home",
              onSelect: () => actions.move(current.id, 0),
            },
            { id: "link", label: "Copy link to page", icon: "link", onSelect: () => actions.copyLink(current) },
            pages.length > 1 && "-",
            pages.length > 1 && {
              id: "delete",
              label: "Delete page…",
              icon: "trash",
              danger: true,
              onSelect: () => actions.remove(current),
            },
          ]}
        />
      )}
    </nav>
  );
}

export default function PageTabs({ editing, pages, ...props }) {
  const [renaming, setRenaming] = useState(null);
  // A page just added and the page before it, so Esc can take it back.
  const [added, setAdded] = useState(null);
  const { actions, currentId } = props;
  const add = useCallback(() => {
    const id = actions.add();
    if (id) {
      setRenaming(id);
      setAdded({ id, previous: currentId });
    }
  }, [actions, currentId]);
  if (editing)
    return (
      <EditTabs
        pages={pages}
        {...props}
        actions={{ ...actions, add }}
        renaming={renaming}
        setRenaming={(id) => {
          if (id === null) setAdded(null);
          setRenaming(id);
        }}
        onCancelRename={(id) => {
          setRenaming(null);
          if (added?.id === id) actions.cancelAdd?.(id, added.previous);
          setAdded(null);
        }}
      />
    );
  // One page: no tab bar at all, exactly like a dashboard without pages.
  if (pages.length < 2) return null;
  return <LiveTabs pages={pages} {...props} />;
}

// Deleting a page that has widgets: move them (an arrangement change, undoable)
// or, for administrators with no unsaved arrangement, delete them with the page.
export function DeletePageDialog({
  page,
  pages,
  count,
  canDeleteWidgets,
  deleteBlocked,
  onMove,
  onDeleteAll,
  onClose,
}) {
  const others = pages.filter((item) => item.id !== page.id);
  const [choice, setChoice] = useState("move");
  const [target, setTarget] = useState(others[0]?.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const describe = [
    count.widgets && `${count.widgets} widget${count.widgets === 1 ? "" : "s"}`,
    count.stacks && `${count.stacks} stack${count.stacks === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" and ");
  const submit = async () => {
    if (choice === "move") return onMove(target);
    setPending(true);
    setError(null);
    try {
      await onDeleteAll();
    } catch (err) {
      setError(err);
      setPending(false);
    }
    return undefined;
  };
  return (
    <>
      <div className="studio-dialog-body studio-delete-page">
        <p className="studio-note">This page has {describe}.</p>
        <fieldset className="studio-page-choices">
          <legend className="studio-sr-only">What happens to its widgets</legend>
          <label className={`studio-page-choice${choice === "move" ? " studio-page-choice-on" : ""}`}>
            <input type="radio" name="delete-page" checked={choice === "move"} onChange={() => setChoice("move")} />
            <span>
              <strong>Move its widgets to another page</strong>
              {choice === "move" && (
                <select
                  aria-label="Page to move them to"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  {others.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
          {canDeleteWidgets && (
            <label className={`studio-page-choice${choice === "delete" ? " studio-page-choice-on" : ""}`}>
              <input
                type="radio"
                name="delete-page"
                checked={choice === "delete"}
                disabled={deleteBlocked}
                onChange={() => setChoice("delete")}
              />
              <span>
                <strong>Delete the widgets too</strong>
                <small>
                  {deleteBlocked
                    ? "Save or cancel the current arrangement first."
                    : "Saved straight away. A snapshot is kept, so Snapshots & restore can bring them back."}
                </small>
              </span>
            </label>
          )}
        </fieldset>
        {error && (
          <p className="studio-field-error" role="alert">
            {error.message || "The page could not be deleted."}
          </p>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="studio-button studio-danger" onClick={submit} disabled={pending}>
          {pending ? "Deleting…" : "Delete page"}
        </button>
      </footer>
    </>
  );
}

// A page icon uses the same choices as widget icons.
export function PageIconEditor({ page, onApply, onClose }) {
  const [value, setValue] = useState(page.icon || "");
  return (
    <>
      <div className="studio-dialog-body">
        <p className="studio-page-icon-preview">
          <span className="studio-page-tab" aria-label="Preview">
            <PageLabel page={{ ...page, icon: value || undefined }} />
          </span>
          {value && (
            <button type="button" className="studio-button studio-quiet" onClick={() => setValue("")}>
              No icon
            </button>
          )}
        </p>
        <IconChooser value={value} onPick={setValue} />
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={value === (page.icon || "")}
          onClick={() => onApply(value || undefined)}
        >
          Apply to arrangement
        </button>
      </footer>
    </>
  );
}

// Picks widgets and stacks from other pages to bring onto this one.
export function MoveHereDialog({ board, pageId, onMove, onClose }) {
  const [chosen, setChosen] = useState([]);
  const others = (board.pages || []).filter((page) => page.id !== pageId);
  const title = (unit) =>
    unit.kind === "stack"
      ? `Stack: ${board.stacks
          .find((stack) => stack.id === unit.id)
          .panelIds.map((id) => board.panels.find((panel) => panel.id === id)?.title)
          .filter(Boolean)
          .join(", ")}`
      : board.panels.find((panel) => panel.id === unit.id)?.title || "Widget";
  return (
    <>
      <div className="studio-dialog-body studio-move-here">
        {others.map((page) => {
          const units = unitsOnPage(board, page.id).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
          if (!units.length) return null;
          return (
            <fieldset key={page.id}>
              <legend>{page.name}</legend>
              {units.map((unit) => (
                <label key={unit.id} className="studio-check-row">
                  <input
                    type="checkbox"
                    checked={chosen.includes(unit.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id),
                      )
                    }
                  />
                  <span>{title(unit)}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={!chosen.length}
          onClick={() => onMove(chosen)}
        >
          {chosen.length > 1 ? `Move ${chosen.length} here` : "Move here"}
        </button>
      </footer>
    </>
  );
}
