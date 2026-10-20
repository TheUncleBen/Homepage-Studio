import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import ContentEditor, { ContentPicker } from "./content-editor";
import StudioDialog, { ErrorMessage } from "./dialog";
import DiscoveryEditor from "./discovery-editor";
import {
  COLUMNS,
  GAP,
  ROW_HEIGHT,
  clampRect,
  moveUnit,
  panelMinimum,
  pixelRect,
  projectBoard,
  stackBoard,
  unitsForBoard,
  unitMinimum,
} from "./geometry.mjs";
import StudioIcon from "./icons";
import PanelHost from "./panel-host";
import SettingsEditor, { FilesEditor, SnapshotEditor } from "./settings-editor";
import StackEditor, { PositionEditor } from "./stack-editor";
import StackShell from "./stack-shell";

const EMPTY = { version: 2, columns: 12, panels: [], stacks: [] };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `stack-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

// One stable React parent owns every native host for its entire board lifetime.
// Stack shells are siblings; a membership change never reparents native content.
export function PanelLayer({
  board,
  data,
  geometry,
  visibleIds,
  active,
  controllers,
  selection,
  editing,
  moving,
  reducedMotion,
  stackDrags = {},
  onStackDrag,
  onManualNavigation,
  onEdit,
  onSelect,
  onManipulate,
  onUnitKey,
  onLongPress,
  renderNative,
}) {
  const stackByPanel = new Map(
    board.stacks.flatMap((stack) => stack.panelIds.map((id) => [id, stack])),
  );
  // Keep DOM sibling order independent of geometry. Moving an existing iframe
  // with insertBefore can reload its document even when its React key survives.
  const panels = board.panels;
  return (
    <div className="studio-panel-layer">
      {panels.map((panel) => {
        const stack = stackByPanel.get(panel.id);
        const unitId = stack?.id || panel.id;
        const selectedId = stack
          ? active[stack.id] || stack.panelIds[0]
          : panel.id;
        const isVisible =
          (!visibleIds || visibleIds.has(unitId)) && selectedId === panel.id;
        return (
          <PanelHost
            key={panel.id}
            panel={panel}
            data={data}
            rect={geometry.get(unitId) || { display: "none" }}
            stack={stack}
            active={isVisible}
            selected={selection.includes(panel.id)}
            editing={editing}
            moving={moving === unitId}
            reducedMotion={reducedMotion}
            controller={
              stack ? () => controllers.current.get(stack.id) : undefined
            }
            dragOffset={stack ? stackDrags[stack.id] || 0 : 0}
            onStackDrag={
              stack ? (offset) => onStackDrag?.(stack.id, offset) : undefined
            }
            onManual={onManualNavigation}
            onEdit={onEdit}
            onSelect={onSelect}
            onManipulate={onManipulate}
            onUnitKey={onUnitKey}
            onLongPress={onLongPress}
            renderNative={renderNative}
          />
        );
      })}
    </div>
  );
}

export default function StudioBoard({
  nativeData,
  settings,
  onNativeChange,
  onSearch,
}) {
  const {
    data: envelope,
    error: loadError,
    mutate,
  } = useSWR("/__studio/api/board", studioRequest, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  const [draft, setDraft] = useState(null);
  const [draftRevision, setDraftRevision] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [editorData, setEditorData] = useState(null);
  const [editorError, setEditorError] = useState(null);
  const [active, setActive] = useState({});
  const [width, setWidth] = useState(1200);
  const [moving, setMoving] = useState(null);
  const [stackTarget, setStackTarget] = useState(null);
  const [stackDrags, setStackDrags] = useState({});
  const canvas = useRef(null);
  const boardRef = useRef(null);
  const operation = useRef(null);
  const emptyPress = useRef(null);
  const generation = useRef(0);
  const controllers = useRef(new Map());
  const reducedMotion = useReducedMotion();
  const board = draft || envelope?.board || EMPTY;
  const dirty = Boolean(draft && !equal(draft, envelope?.board));
  useLayoutEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    const element = canvas.current;
    // Register before a touch begins so the browser waits for this decision.
    // Ordinary swipes still scroll; only an active held drag/resize owns motion.
    const preserveManipulation = (event) => {
      if (operation.current && event.touches.length === 1 && event.cancelable)
        event.preventDefault();
    };
    element.addEventListener("touchmove", preserveManipulation, {
      passive: false,
    });
    return () => element.removeEventListener("touchmove", preserveManipulation);
  }, []);
  const projection = useMemo(() => projectBoard(board, width), [board, width]);
  const geometry = useMemo(
    () =>
      new Map(
        projection.units.map((unit) => [
          unit.id,
          pixelRect(unit.rect, width, projection.columns),
        ]),
      ),
    [projection, width],
  );
  const groups = [
    ...new Set(board.panels.map((panel) => panel.group).filter(Boolean)),
  ];
  const visibleIds = useMemo(
    () =>
      new Set(
        projection.units
          .filter(
            (unit) =>
              filter === "all" ||
              (unit.kind === "panel"
                ? board.panels.find((panel) => panel.id === unit.id)?.group ===
                  filter
                : board.stacks
                    .find((stack) => stack.id === unit.id)
                    ?.panelIds.some(
                      (id) =>
                        board.panels.find((panel) => panel.id === id)?.group ===
                        filter,
                    )),
          )
          .map((unit) => unit.id),
      ),
    [board, projection, filter],
  );

  useEffect(() => {
    const measure = () => {
      if (canvas.current) setWidth(canvas.current.clientWidth || 1200);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const unload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const registerController = useCallback((id, controller) => {
    if (controller) controllers.current.set(id, controller);
    else controllers.current.delete(id);
  }, []);
  const onActive = useCallback((id, activeId) => {
    setActive((current) =>
      current[id] === activeId ? current : { ...current, [id]: activeId },
    );
  }, []);
  const onStackDrag = useCallback((id, offset) => {
    setStackDrags((current) =>
      current[id] === offset ? current : { ...current, [id]: offset },
    );
  }, []);
  const changeBoard = useCallback(
    (next) => {
      setDraftRevision((current) => current || envelope?.revision);
      setDraft(next);
      setError(null);
      setNotice("");
    },
    [envelope?.revision],
  );
  const beginEditing = () => {
    setEditing(true);
    setFilter("all");
    setNotice("");
  };
  const select = (id) =>
    setSelection((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const closeModal = () => {
    generation.current += 1;
    setModal(null);
    setEditorData(null);
    setEditorError(null);
  };

  const saveArrangement = async (finish = false) => {
    if (!dirty) {
      if (finish) {
        setEditing(false);
        setSelection([]);
      }
      return true;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await studioRequest("/__studio/api/board", {
        revision: draftRevision,
        board,
      });
      await mutate(saved, { revalidate: false });
      setDraft(null);
      setDraftRevision(null);
      setNotice("Arrangement saved");
      if (finish) {
        setEditing(false);
        setSelection([]);
      }
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openEditor = async (type, detail = {}) => {
    if (dirty) {
      setError(
        new Error(
          "Save or cancel the current arrangement before editing native configuration.",
        ),
      );
      return;
    }
    const token = ++generation.current;
    setModal({ type, ...detail });
    setEditorError(null);
    setEditorData(null);
    try {
      const [state, catalog, backups] = await Promise.all([
        studioRequest("/__studio/api/state"),
        studioRequest("/__studio/catalog.json"),
        type === "backups"
          ? studioRequest("/__studio/api/backups")
          : Promise.resolve([]),
      ]);
      if (token === generation.current)
        setEditorData({ state, catalog, backups });
    } catch (err) {
      if (token === generation.current) setEditorError(err);
    }
  };
  const savedContent = async (state, details = {}) => {
    // The writer returns the canonical identity/board snapshot for this exact commit.
    // Refresh native render data first; ordinary healthy hosts keep their React keys.
    await onNativeChange();
    if (state?.board && state?.revision)
      await mutate(
        {
          revision: state.revision,
          board: state.board,
          discoveredSources: state.discoveredSources || [],
          hiddenDiscoveredIds: state.hiddenDiscoveredIds || [],
        },
        { revalidate: false },
      );
    else await mutate();
    closeModal();
    setSelection([]);
    setNotice(
      details.customJsChanged
        ? "Changes saved. Reload once to apply custom JavaScript."
        : "Changes saved",
    );
    if (details.customJsChanged) setReloadRequired(true);
  };
  const reloadEditor = () => {
    if (modal)
      openEditor(modal.type, { panel: modal.panel, entry: modal.entry });
  };
  const editPanel = (panel) => {
    if (panel.nativeLocator?.discovered) {
      if (dirty) {
        setError(
          new Error(
            "Save or cancel the current arrangement before changing discovered panel visibility.",
          ),
        );
        return;
      }
      setModal({ type: "discovery", panel });
      setEditorData(null);
    } else openEditor("content", { panel });
  };
  const editStack = (stack) => {
    setModal({ type: "stack", stack });
    setEditorData(null);
  };
  const position = (id) => {
    const unit = unitsForBoard(board).find((item) => item.id === id);
    if (unit)
      setModal({
        type: "position",
        unit: { ...unit, minimum: unitMinimum(board, id) },
      });
  };
  const createStack = () => {
    const next = stackBoard(board, selection, uuid());
    if (next !== board) {
      const stack = next.stacks.at(-1);
      const members = board.panels.filter((panel) =>
        stack.panelIds.includes(panel.id),
      );
      if (
        members.some(
          (panel) =>
            panel.rect.w !== stack.rect.w || panel.rect.h !== stack.rect.h,
        )
      ) {
        setModal({ type: "stack", stack, previewBoard: next });
        return;
      }
      changeBoard(next);
      setSelection([]);
      setNotice("Stack created. Save the arrangement when ready.");
    }
  };

  const manipulate = (event, id, mode) => {
    if (saving || !envelope) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const initial = boardRef.current;
    const unit = unitsForBoard(initial).find((item) => item.id === id);
    if (!unit) return;
    const element = event.currentTarget;
    element?.setPointerCapture?.(event.pointerId);
    const initialProjection = projectBoard(initial, width);
    const column = (width + GAP) / initialProjection.columns;
    const start = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    let latest = initial;
    let target = null;
    let targetTime = 0;
    let stackReady = false;
    let dwell;
    setMoving(id);
    setSelection([id]);
    const cancelDwell = () => {
      clearTimeout(dwell);
      dwell = null;
    };
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      const dx = Math.round(
        (((moveEvent.clientX - start.x) / column) * COLUMNS) /
          initialProjection.columns,
      );
      const dy = Math.round((moveEvent.clientY - start.y) / (ROW_HEIGHT + GAP));
      const rect = clampRect(
        mode === "resize"
          ? { ...unit.rect, w: unit.rect.w + dx, h: unit.rect.h + dy }
          : { ...unit.rect, x: unit.rect.x + dx, y: unit.rect.y + dy },
      );
      latest = moveUnit(initial, id, rect);
      changeBoard(latest);
      if (mode !== "move" || unit.kind !== "panel") return;
      const bounds = canvas.current.getBoundingClientRect();
      const point = {
        x: moveEvent.clientX - bounds.left,
        y: moveEvent.clientY - bounds.top,
      };
      const candidate = initialProjection.units.find((other) => {
        if (
          other.id === id ||
          other.rect.w !==
            initialProjection.units.find((item) => item.id === id).rect.w ||
          other.rect.h !== unit.rect.h
        )
          return false;
        const canonical = unitsForBoard(initial).find(
          (item) => item.id === other.id,
        );
        if (
          canonical.rect.w !== unit.rect.w ||
          canonical.rect.h !== unit.rect.h
        )
          return false;
        const movingMinimum = panelMinimum(
          initial.panels.find((panel) => panel.id === id),
        );
        const targetMinimum = unitMinimum(initial, other.id);
        const requiredHeight = Math.max(
          movingMinimum.h + 1,
          targetMinimum.h + (other.kind === "stack" ? 0 : 1),
          3,
        );
        if (
          unit.rect.h < requiredHeight ||
          unit.rect.w < Math.max(movingMinimum.w, targetMinimum.w)
        )
          return false;
        const pixels = pixelRect(other.rect, width, initialProjection.columns);
        return (
          point.x > pixels.left + pixels.width * 0.2 &&
          point.x < pixels.left + pixels.width * 0.8 &&
          point.y > pixels.top + 20 &&
          point.y < pixels.top + pixels.height - 20
        );
      });
      if (candidate?.id !== target?.id) {
        cancelDwell();
        target = candidate || null;
        targetTime = performance.now();
        stackReady = false;
        setStackTarget(null);
        if (target)
          dwell = setTimeout(() => {
            stackReady = true;
            setStackTarget(target.id);
          }, 500);
      }
    };
    const finish = (upEvent, cancel = false) => {
      if (
        upEvent.pointerId !== undefined &&
        upEvent.pointerId !== start.pointerId
      )
        return;
      cancelDwell();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onEscape);
      element?.releasePointerCapture?.(start.pointerId);
      if (cancel) changeBoard(initial);
      else if (target && stackReady && performance.now() - targetTime >= 500) {
        if (target.kind === "stack") {
          changeBoard({
            ...initial,
            stacks: initial.stacks.map((stack) =>
              stack.id === target.id
                ? { ...stack, panelIds: [...stack.panelIds, id] }
                : stack,
            ),
          });
        } else changeBoard(stackBoard(initial, [target.id, id], uuid()));
        setSelection([]);
      } else changeBoard(latest);
      operation.current = null;
      setMoving(null);
      setStackTarget(null);
    };
    const onUp = (upEvent) => finish(upEvent);
    const onCancel = (cancelEvent) => finish(cancelEvent, true);
    const onEscape = (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        finish({}, true);
      }
    };
    operation.current = () => finish({}, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEscape);
  };
  useEffect(
    () => () => {
      operation.current?.();
      clearTimeout(emptyPress.current?.timer);
    },
    [],
  );
  const unitKey = (event, id, mode = "move") => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const unit = unitsForBoard(board).find((item) => item.id === id);
    const key =
      event.key === "ArrowLeft" || event.key === "ArrowRight"
        ? event.shiftKey || mode === "resize"
          ? "w"
          : "x"
        : event.shiftKey || mode === "resize"
          ? "h"
          : "y";
    const amount =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    changeBoard(
      moveUnit(board, id, { ...unit.rect, [key]: unit.rect[key] + amount }),
    );
  };
  const longPress = (id, pointer) => {
    beginEditing();
    setSelection([id]);
    if (pointer) manipulate(pointer, id, "move");
  };
  const stackedIds = new Set(board.stacks.flatMap((stack) => stack.panelIds));
  const stackableSelection = selection.filter(
    (id) =>
      board.panels.some((panel) => panel.id === id) && !stackedIds.has(id),
  );
  const modalTitles = {
    picker: "Add to your dashboard",
    content: modal?.panel
      ? `Edit ${modal.panel.title}`
      : modal?.entry?.name || "Configure content",
    settings: "Dashboard settings",
    files: "Configuration files",
    backups: "Snapshots & restore",
    stack: "Edit widget stack",
    position: "Position & size",
    discovery: modal?.panel?.title || "Discovered content",
  };

  return (
    <main className={`studio-app${editing ? " studio-edit-mode" : ""}`}>
      <div className="studio-topbar">
        <Link
          className="studio-brand"
          href="/"
          aria-label="Homepage Studio home"
        >
          <span className="studio-brand-mark">
            <StudioIcon name="layout" size={20} />
          </span>
          <span>
            homepage<span className="studio-brand-sub"> studio</span>
          </span>
        </Link>
        <div className="studio-top-actions">
          <button className="studio-search-button" onClick={onSearch}>
            <StudioIcon name="search" size={16} />
            <span>Quick Launch</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="studio-icon-button"
            aria-label="Dashboard settings"
            onClick={() => openEditor("settings")}
          >
            <StudioIcon name="settings" />
          </button>
        </div>
      </div>
      <header className="studio-page-header">
        <div>
          <p className="studio-eyebrow">Your space, arranged your way</p>
          <h1>{settings?.title || "Your dashboard"}</h1>
          <p className="studio-subtitle">
            {editing
              ? "Move, resize and stack your native widgets."
              : settings?.description || "Everything you need, within reach."}
          </p>
        </div>
        <div className="studio-header-actions">
          {editing ? (
            <>
              <button
                className="studio-button studio-quiet"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setDraftRevision(null);
                  setEditing(false);
                  setSelection([]);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="studio-button studio-primary"
                disabled={saving}
                onClick={() => saveArrangement(true)}
              >
                <StudioIcon name="check" size={16} />
                {saving ? "Saving…" : "Done"}
              </button>
            </>
          ) : (
            <>
              <button
                className="studio-button studio-quiet"
                disabled={!envelope}
                onClick={beginEditing}
              >
                <StudioIcon name="edit" size={16} />
                Edit dashboard
              </button>
              <button
                className="studio-button studio-primary"
                disabled={!envelope}
                onClick={() => openEditor("picker")}
              >
                <StudioIcon name="plus" size={17} />
                Add widget
              </button>
            </>
          )}
        </div>
      </header>
      <ErrorMessage
        error={error || loadError}
        onReload={() => {
          setDraft(null);
          setDraftRevision(null);
          setError(null);
          mutate();
        }}
      />
      <div className="studio-board-toolbar">
        {editing ? (
          <>
            <button
              className="studio-button studio-quiet"
              onClick={() => openEditor("picker")}
            >
              <StudioIcon name="plus" size={16} />
              Widgets
            </button>
            <button
              className="studio-button studio-quiet"
              disabled={stackableSelection.length < 2}
              onClick={createStack}
            >
              <StudioIcon name="stack" size={16} />
              Create stack
              {stackableSelection.length > 0
                ? ` (${stackableSelection.length})`
                : ""}
            </button>
            <button
              className="studio-button studio-quiet"
              disabled={selection.length !== 1}
              onClick={() => position(selection[0])}
            >
              Position & size
            </button>
            <span className="studio-toolbar-spacer" />
            <span className="studio-muted">
              {dirty
                ? "Unsaved arrangement"
                : "Hold a panel · drag to move · resize from the corner"}
            </span>
            {dirty && (
              <button
                className="studio-button studio-primary"
                disabled={saving}
                onClick={() => saveArrangement(false)}
              >
                Save arrangement
              </button>
            )}
          </>
        ) : (
          <>
            <nav
              className="studio-group-filter"
              aria-label="Filter native groups"
            >
              <button
                className={filter === "all" ? "studio-filter-active" : ""}
                onClick={() => setFilter("all")}
              >
                All content
              </button>
              {groups.map((group) => (
                <button
                  className={filter === group ? "studio-filter-active" : ""}
                  key={group}
                  onClick={() => setFilter(group)}
                >
                  {group}
                </button>
              ))}
            </nav>
            <span className="studio-toolbar-spacer" />
            <small className="studio-muted">
              {board.panels.length} panel{board.panels.length === 1 ? "" : "s"}
              {board.stacks.length
                ? ` · ${board.stacks.length} stack${board.stacks.length === 1 ? "" : "s"}`
                : ""}
            </small>
          </>
        )}
      </div>
      <div className="studio-status-message" role="status">
        {notice}
        {reloadRequired && (
          <button
            className="studio-text-button"
            onClick={() => window.location.reload()}
          >
            Reload dashboard
          </button>
        )}
      </div>
      <div
        ref={canvas}
        className="studio-canvas"
        style={{
          height: board.panels.length
            ? projection.rows * (ROW_HEIGHT + GAP) + 32
            : 480,
          "--studio-grid-column": `${(width + GAP) / projection.columns}px`,
          "--studio-grid-row": `${ROW_HEIGHT + GAP}px`,
        }}
        onPointerDown={(event) => {
          if (event.target !== canvas.current) return;
          const x = event.clientX,
            y = event.clientY;
          emptyPress.current = { x, y, timer: setTimeout(beginEditing, 420) };
        }}
        onPointerMove={(event) => {
          if (
            emptyPress.current &&
            Math.hypot(
              event.clientX - emptyPress.current.x,
              event.clientY - emptyPress.current.y,
            ) > 10
          ) {
            clearTimeout(emptyPress.current.timer);
            emptyPress.current = null;
          }
        }}
        onPointerUp={() => {
          clearTimeout(emptyPress.current?.timer);
          emptyPress.current = null;
        }}
        onPointerCancel={() => {
          clearTimeout(emptyPress.current?.timer);
          emptyPress.current = null;
        }}
        onContextMenu={(event) => {
          if (event.target === canvas.current) {
            event.preventDefault();
            beginEditing();
          }
        }}
      >
        {!board.panels.length && (
          <div className="studio-empty">
            <span className="studio-empty-icon">
              <StudioIcon name="layout" size={32} />
            </span>
            <p className="studio-eyebrow">A clean slate</p>
            <h2>
              {envelope
                ? "Make room for what matters."
                : "Opening your dashboard…"}
            </h2>
            <p>
              Add a service, a clock, a bookmark, or a native integration.
              <br />
              Arrange each panel freely. Stack the ones that belong together.
            </p>
            <button
              className="studio-button studio-primary"
              disabled={!envelope}
              onClick={() => openEditor("picker")}
            >
              <StudioIcon name="plus" size={17} />
              Add your first widget
            </button>
            <small>No sample connections. Start with your own.</small>
          </div>
        )}
        <div className="studio-stack-backgrounds" aria-hidden="true">
          {board.stacks.map((stack) => (
            <div
              key={stack.id}
              className="studio-stack-backdrop"
              style={{
                ...geometry.get(stack.id),
                display: visibleIds.has(stack.id) ? undefined : "none",
              }}
            />
          ))}
        </div>
        <PanelLayer
          board={board}
          data={nativeData}
          geometry={geometry}
          visibleIds={visibleIds}
          active={active}
          controllers={controllers}
          selection={selection}
          editing={editing}
          moving={moving}
          reducedMotion={reducedMotion}
          stackDrags={stackDrags}
          onManualNavigation={(snapshot) =>
            setNotice(
              `${boardRef.current.panels.find((panel) => panel.id === snapshot.activeId)?.title || "Widget"}, ${snapshot.activeIndex + 1} of ${snapshot.ids.length}`,
            )
          }
          onStackDrag={onStackDrag}
          onEdit={editPanel}
          onSelect={select}
          onManipulate={manipulate}
          onUnitKey={unitKey}
          onLongPress={longPress}
        />
        <div className="studio-stack-layer">
          {board.stacks.map((stack) => (
            <StackShell
              key={stack.id}
              stack={stack}
              panels={board.panels}
              rect={{
                ...geometry.get(stack.id),
                display: visibleIds.has(stack.id) ? undefined : "none",
              }}
              editing={editing || Boolean(modal)}
              reducedMotion={reducedMotion}
              onActive={onActive}
              registerController={registerController}
              onEdit={editStack}
              onManipulate={manipulate}
              onUnitKey={unitKey}
              onLongPress={longPress}
              onStackDrag={(offset) => onStackDrag(stack.id, offset)}
            />
          ))}
        </div>
        {stackTarget && (
          <div className="studio-stack-drop" style={geometry.get(stackTarget)}>
            <StudioIcon name="stack" size={28} />
            <strong>Release to stack</strong>
            <span>Same size, shared space</span>
          </div>
        )}
      </div>
      <footer className="studio-page-footer">
        <span>
          Homepage Studio <span className="studio-footer-dot">·</span> Powered
          by Homepage
        </span>
        <span>
          {editing
            ? "Esc cancels a drag · arrow keys move · Shift + arrows resize"
            : "Hold a panel to make it yours"}
        </span>
      </footer>
      {modal && (
        <StudioDialog
          title={modalTitles[modal.type]}
          onClose={closeModal}
          wide={modal.type === "files" || modal.type === "picker"}
        >
          {modal.type === "discovery" ? (
            <DiscoveryEditor
              panel={modal.panel}
              revision={envelope.revision}
              onSaved={savedContent}
              onPosition={() => position(modal.panel.id)}
              onClose={closeModal}
            />
          ) : modal.type === "stack" ? (
            <StackEditor
              stack={modal.stack}
              board={modal.previewBoard || board}
              fitting={Boolean(modal.previewBoard)}
              onApply={(next) => {
                changeBoard(next);
                setSelection([]);
                closeModal();
              }}
              onClose={closeModal}
              onPanelEdit={(panel) => {
                closeModal();
                editPanel(panel);
              }}
            />
          ) : modal.type === "position" ? (
            <PositionEditor
              unit={modal.unit}
              onApply={(rect) => {
                changeBoard(moveUnit(board, modal.unit.id, rect));
                closeModal();
              }}
              onClose={closeModal}
            />
          ) : editorError ? (
            <div className="studio-dialog-body">
              <ErrorMessage error={editorError} onReload={reloadEditor} />
              <button className="studio-button" onClick={reloadEditor}>
                Try again
              </button>
            </div>
          ) : !editorData ? (
            <div className="studio-dialog-body studio-loading" role="status">
              Loading local configuration…
            </div>
          ) : modal.type === "picker" ? (
            <ContentPicker
              catalog={editorData.catalog}
              state={editorData.state}
              onRestore={async (id) => {
                try {
                  await savedContent(
                    await studioRequest("/__studio/api/discovery-visibility", {
                      revision: editorData.state.revision,
                      id,
                      hidden: false,
                    }),
                  );
                } catch (err) {
                  setEditorError(err);
                }
              }}
              onChoose={(entry) => setModal({ type: "content", entry })}
            />
          ) : modal.type === "content" ? (
            <ContentEditor
              key={
                modal.panel?.id || `${modal.entry?.kind}:${modal.entry?.type}`
              }
              {...editorData}
              panel={modal.panel}
              entry={modal.entry}
              onSaved={savedContent}
              onCancel={closeModal}
              onReload={reloadEditor}
              onDuplicate={(entry) => setModal({ type: "content", entry })}
              onParent={(parent) =>
                setModal({
                  type: "content",
                  panel: { id: parent.id, kind: "service", title: parent.name },
                })
              }
            />
          ) : modal.type === "settings" ? (
            <SettingsEditor
              {...editorData}
              onSaved={savedContent}
              onClose={closeModal}
              onOpenFiles={() => setModal({ type: "files" })}
              onOpenBackups={() => openEditor("backups")}
              onReload={reloadEditor}
            />
          ) : modal.type === "files" ? (
            <FilesEditor
              {...editorData}
              onSaved={savedContent}
              onClose={closeModal}
              onReload={reloadEditor}
            />
          ) : (
            <SnapshotEditor
              {...editorData}
              onSaved={savedContent}
              onClose={closeModal}
            />
          )}
        </StudioDialog>
      )}
    </main>
  );
}
