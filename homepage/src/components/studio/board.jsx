import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import AppearanceOnlyEditor from "./appearance-only-editor";
import ContentEditor, { ContentPicker } from "./content-editor";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioDialog, { ErrorMessage } from "./dialog";
import DiscoveryEditor from "./discovery-editor";
import { EditorDraftContext } from "./draft-guard";
import { useBoardFocusOrder } from "./focus-order";
import {
  COLUMNS,
  GAP,
  ROW_HEIGHT,
  clampRect,
  moveProjectedUnit,
  moveUnit,
  panelMinimum,
  pixelRect,
  projectBoard,
  stackBoard,
  unitMinimum,
  unitsForBoard,
} from "./geometry.mjs";
import StudioIcon from "./icons";
import PanelHost from "./panel-host";
import SettingsEditor, { FilesEditor, SnapshotEditor } from "./settings-editor";
import StackEditor, { PositionEditor } from "./stack-editor";
import StackShell from "./stack-shell";
import StudioTopBar, { DASHBOARDS_PAGE } from "./top-bar";

const EMPTY = { version: 2, columns: 12, panels: [], stacks: [] };
const EMPTY_NATIVE = {};
const isConfigurationRevision = (revision) => typeof revision === "string" && /^[a-f0-9]{64}$/.test(revision);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = () => globalThis.crypto?.randomUUID?.() || `stack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  busy = false,
  overlayOpen = false,
  stale = false,
  saved = false,
  moving,
  reducedMotion,
  stackDrags = {},
  onStackDrag,
  onManualNavigation,
  onEdit,
  canEdit,
  onSelect,
  onManipulate,
  onUnitKey,
  onLongPress,
  renderNative,
}) {
  const stackByPanel = new Map(board.stacks.flatMap((stack) => stack.panelIds.map((id) => [id, stack])));
  // Keep DOM sibling order independent of geometry. Moving an existing iframe
  // with insertBefore can reload its document even when its React key survives.
  // Keyboard order follows the layout through useBoardFocusOrder instead.
  const panels = board.panels;
  return (
    <div className="studio-panel-layer">
      {panels.map((panel) => {
        const stack = stackByPanel.get(panel.id);
        const unitId = stack?.id || panel.id;
        const selectedId = stack
          ? controllers.current.get(stack.id)?.getSnapshot().activeId || active[stack.id] || stack.panelIds[0]
          : panel.id;
        const isVisible = (!visibleIds || visibleIds.has(unitId)) && selectedId === panel.id;
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
            busy={busy}
            overlayOpen={overlayOpen}
            stale={stale}
            saved={saved}
            moving={moving === unitId}
            reducedMotion={reducedMotion}
            controller={stack ? () => controllers.current.get(stack.id) : undefined}
            dragOffset={stack ? stackDrags[stack.id] || 0 : 0}
            onStackDrag={stack ? (offset) => onStackDrag?.(stack.id, offset) : undefined}
            onManual={onManualNavigation}
            onEdit={onEdit}
            canEdit={canEdit ? canEdit(panel) : true}
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
  dashboard = { id: "default", basePath: "" },
  nativeData,
  settings,
  onNativeChange,
  onSearch,
  onInteractionBlocked,
  overlayOpen = false,
  // "live" shows the dashboard only. "edit" is the editor page opened from the
  // Dashboards page; "settings" opens this dashboard's settings over it. Both
  // return to the Dashboards page when finished.
  mode = "live",
  onLeave = () => window.location.assign(DASHBOARDS_PAGE),
}) {
  const editorPage = mode === "edit";
  const settingsPage = mode === "settings";
  const {
    data: envelope,
    error: loadError,
    mutate,
  } = useSWR("/studio/api/board", studioRequest, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  // Studio sign-in decides what this person may change here. The controller
  // enforces the same levels; this only hides controls that would be refused.
  const {
    data: access,
    error: accessError,
    mutate: mutateAccess,
  } = useSWR("/studio/api/access", studioRequest, {
    revalidateOnFocus: true,
  });
  // Until the answer arrives every control stays disabled. A server without
  // sign-in levels (or one that predates them) means full access.
  const accessLoading = !access && !accessError;
  const level = ["view", "arrange", "admin"].includes(access?.level)
    ? access.level
    : accessError && accessError.status !== 404
      ? "view"
      : "admin";
  const isAdmin = level === "admin";
  const canArrange = isAdmin || level === "arrange";
  const [draft, setDraft] = useState(null);
  const [draftSource, setDraftSource] = useState(null);
  // The editor page is always in editing; it is left by navigating away.
  const editing = editorPage && canArrange;
  const [selection, setSelection] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [editorData, setEditorData] = useState(null);
  // The native catalog is large and fixed for a deployed build. Fetch it only
  // for the editors that use it and reuse it for the rest of the page session;
  // a failed request is forgotten so "Try again" fetches it afresh.
  const catalogRequest = useRef(null);
  const [editorError, setEditorError] = useState(null);
  const [editorGuard, setEditorGuard] = useState({
    dirty: false,
    pending: false,
  });
  const [discardAction, setDiscardAction] = useState(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nativeSnapshot, setNativeSnapshot] = useState(null);
  const [lastMatchedNative, setLastMatchedNative] = useState(null);
  const [active, setActive] = useState({});
  const [width, setWidth] = useState(1200);
  const [moving, setMoving] = useState(null);
  const [stackTarget, setStackTarget] = useState(null);
  const [stackDrags, setStackDrags] = useState({});
  const canvas = useRef(null);
  const boardRef = useRef(null);
  // Set once the person has finished on the editor or settings page, so the
  // unsaved-changes guard doesn't stop the way back to the Dashboards page.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    // One way back: a second navigation would abort the first.
    if (leaving.current) return;
    leaving.current = true;
    onLeave();
  }, [onLeave]);
  const opened = useRef(false);
  const operation = useRef(null);
  const generation = useRef(0);
  const controllers = useRef(new Map());
  const saveInFlight = useRef(false);
  const nativeRefreshLock = useRef(true);
  const editorGuardRef = useRef(editorGuard);
  const discardFocus = useRef(null);
  const keepEditing = useRef(null);
  const keepArrangement = useRef(null);
  const reducedMotion = useReducedMotion();
  const sourceBoard = draft || envelope?.board || EMPTY;
  const sourceRevision = draft ? draftSource?.configurationRevision : envelope?.configurationRevision;
  const nativePairMatches =
    isConfigurationRevision(sourceRevision) && nativeData?.configurationRevision === sourceRevision;
  const draftSourceChanged = Boolean(
    draft &&
    isConfigurationRevision(envelope?.configurationRevision) &&
    draftSource?.configurationRevision !== envelope.configurationRevision,
  );
  const nativeContentStale = Boolean(nativeSnapshot || (envelope && (!nativePairMatches || draftSourceChanged)));
  // This pair is render state, not a mutable ref: React may start and abandon
  // renders, and only a coherent pair may become the next visible snapshot.
  if (nativePairMatches && !nativeSnapshot && !draftSourceChanged) {
    if (
      lastMatchedNative?.board !== sourceBoard ||
      lastMatchedNative?.data !== nativeData ||
      lastMatchedNative?.configurationRevision !== sourceRevision
    )
      setLastMatchedNative({
        board: sourceBoard,
        data: nativeData,
        configurationRevision: sourceRevision,
      });
    if (refreshWarning) setRefreshWarning(false);
  }
  // Independently polled native data and board locators may describe different
  // file revisions. Preserve the last matched pair; a draft also keeps the
  // native source it started with instead of adopting the latest envelope.
  const renderSnapshot =
    nativeSnapshot ||
    (nativeContentStale
      ? draft
        ? { board: draft, data: draftSource?.data || EMPTY_NATIVE }
        : lastMatchedNative
      : null);
  const board = renderSnapshot?.board || sourceBoard;
  const renderedNativeData = renderSnapshot ? renderSnapshot.data : nativePairMatches ? nativeData : EMPTY_NATIVE;
  const nativeUnavailable = !envelope || nativeContentStale;
  const controlsDisabled = saving || nativeUnavailable || accessLoading;
  const interactionBlocked = Boolean(modal) || controlsDisabled;
  const sourceConflict = draftSourceChanged
    ? {
        status: 409,
        message:
          "Native configuration changed while you were arranging this dashboard. Your arrangement draft is still here; reload the current configuration before saving it.",
      }
    : null;
  const dirty = Boolean(draft && !equal(draft, envelope?.board));
  useLayoutEffect(() => {
    boardRef.current = board;
  }, [board]);
  useLayoutEffect(() => {
    nativeRefreshLock.current = nativeUnavailable;
  }, [nativeUnavailable]);
  useLayoutEffect(() => {
    onInteractionBlocked?.(interactionBlocked);
  }, [onInteractionBlocked, interactionBlocked]);
  useEffect(() => {
    const element = canvas.current;
    // Register before a touch begins so the browser waits for this decision.
    // Ordinary swipes still scroll; only an active held drag/resize owns motion.
    const preserveManipulation = (event) => {
      if (operation.current && event.touches.length === 1 && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", preserveManipulation, {
      passive: false,
    });
    return () => element.removeEventListener("touchmove", preserveManipulation);
  }, []);
  const projection = useMemo(() => projectBoard(board, width), [board, width]);
  const geometry = useMemo(
    () => new Map(projection.units.map((unit) => [unit.id, pixelRect(unit.rect, width, projection.columns)])),
    [projection, width],
  );
  // Tab follows the projected layout (row, then column) without reordering
  // native hosts in the DOM.
  const readingOrder = useMemo(
    () =>
      [...projection.units]
        .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
        .map((unit) => unit.id),
    [projection],
  );
  useBoardFocusOrder(canvas, readingOrder);
  const groups = [...new Set(board.panels.map((panel) => panel.group).filter(Boolean))];
  const visibleIds = useMemo(
    () =>
      new Set(
        projection.units
          .filter(
            (unit) =>
              filter === "all" ||
              (unit.kind === "panel"
                ? board.panels.find((panel) => panel.id === unit.id)?.group === filter
                : board.stacks
                    .find((stack) => stack.id === unit.id)
                    ?.panelIds.some((id) => board.panels.find((panel) => panel.id === id)?.group === filter)),
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
    if (!dirty && !editorGuard.dirty && !editorGuard.pending && !saving) return undefined;
    const unload = (event) => {
      if (leaving.current) return;
      if (!dirty && !editorGuardRef.current.dirty && !editorGuardRef.current.pending && !saveInFlight.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, editorGuard.dirty, editorGuard.pending, saving]);
  const reportEditorDraft = useCallback((next) => {
    editorGuardRef.current = next;
    setEditorGuard((current) =>
      current.dirty === next.dirty &&
      current.pending === next.pending &&
      current.discard?.heading === next.discard?.heading &&
      current.discard?.description === next.discard?.description
        ? current
        : next,
    );
  }, []);
  useEffect(() => {
    // The dialog's showModal focuses its first control (Close); move focus to
    // the safe choice once the dialog is open, like the editor-draft prompt.
    if (modal?.type === "discardArrangement") keepArrangement.current?.focus();
  }, [modal?.type]);
  useEffect(() => {
    if (discardAction) keepEditing.current?.focus();
    else {
      discardFocus.current?.focus?.();
      discardFocus.current = null;
    }
  }, [discardAction]);
  const registerController = useCallback((id, controller) => {
    if (controller) controllers.current.set(id, controller);
    else controllers.current.delete(id);
  }, []);
  const onActive = useCallback((id, activeId) => {
    setActive((current) => (current[id] === activeId ? current : { ...current, [id]: activeId }));
  }, []);
  const onStackDrag = useCallback((id, offset) => {
    setStackDrags((current) => (current[id] === offset ? current : { ...current, [id]: offset }));
  }, []);
  const changeBoard = useCallback(
    (next, source) => {
      if (saveInFlight.current || nativeRefreshLock.current) return false;
      if (next === boardRef.current) return true;
      // Pointer cancellation may arrive before React commits the queued draft.
      // Keep the next gesture event aligned with the last submitted board.
      boardRef.current = next;
      setDraftSource(
        (current) =>
          current ||
          source || {
            revision: envelope?.revision,
            configurationRevision: envelope?.configurationRevision,
            data: nativeData,
          },
      );
      setDraft(next);
      setError(null);
      setNotice("");
      return true;
    },
    [envelope?.revision, envelope?.configurationRevision, nativeData],
  );
  const cancelEditing = () => {
    setDraft(null);
    setDraftSource(null);
    setSelection([]);
    setError(null);
  };

  const select = (id) => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    setSelection((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };
  const dismissEditor = () => {
    generation.current += 1;
    setModal(null);
    setEditorData(null);
    setEditorError(null);
    setDiscardAction(null);
    reportEditorDraft({ dirty: false, pending: false });
  };
  const requestEditorAction = (action) => {
    if (editorGuardRef.current.pending || saveInFlight.current) return;
    if (editorGuardRef.current.dirty) {
      discardFocus.current = document.activeElement;
      setDiscardAction(() => action);
    } else action();
  };
  const closeModal = () => {
    if (discardAction) setDiscardAction(null);
    else requestEditorAction(dismissEditor);
  };

  const saveArrangement = async (finish = false) => {
    if (saveInFlight.current || nativeRefreshLock.current) return false;
    if (!dirty) {
      if (finish) setSelection([]);
      return true;
    }
    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await studioRequest("/studio/api/board", {
        revision: draftSource?.revision,
        board,
      });
      await mutate(saved, { revalidate: false });
      setDraft(null);
      setDraftSource(null);
      setNotice("Arrangement saved");
      if (finish) setSelection([]);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const loadEditorData = async (type) => {
    if ((type === "picker" || type === "content") && !catalogRequest.current) {
      const request = studioRequest("/studio/catalog.json");
      catalogRequest.current = request;
      request.catch(() => {
        if (catalogRequest.current === request) catalogRequest.current = null;
      });
    }
    if (type === "appearance") return { appearance: await studioRequest("/studio/api/appearance") };
    const [state, catalog, backups, appearance] = await Promise.all([
      studioRequest("/studio/api/state"),
      type === "picker" || type === "content" ? catalogRequest.current : Promise.resolve(null),
      type === "backups" ? studioRequest("/studio/api/backups") : Promise.resolve([]),
      // The platform defaults, for each "use platform default" in settings.
      type === "settings" ? studioRequest("/studio/api/appearance").catch(() => null) : Promise.resolve(null),
    ]);
    return { state, catalog, backups, platform: appearance?.platform ?? null };
  };
  const openEditor = async (type, detail = {}, reload = false) => {
    if (saveInFlight.current || (!reload && nativeRefreshLock.current)) return;
    if (dirty) {
      setError(new Error("Save or cancel the current arrangement before editing native configuration."));
      return;
    }
    const token = ++generation.current;
    setModal({ type, ...detail });
    setEditorError(null);
    setEditorData(null);
    try {
      const loaded = await loadEditorData(type);
      if (token === generation.current) setEditorData(loaded);
    } catch (err) {
      if (token === generation.current) setEditorError(err);
    }
  };
  const refreshNativeContent = async () => {
    setRefreshing(true);
    try {
      const [updatedNative, updatedBoard] = await Promise.all([onNativeChange(), mutate()]);
      if (
        !isConfigurationRevision(updatedBoard?.configurationRevision) ||
        updatedNative?.configurationRevision !== updatedBoard.configurationRevision
      )
        throw new Error("Native configuration changed while refreshing.");
      setRefreshWarning(false);
      setNativeSnapshot(null);
      return true;
    } catch {
      setRefreshWarning(true);
      return false;
    } finally {
      setRefreshing(false);
    }
  };
  const savedContent = async (state, details = {}) => {
    nativeRefreshLock.current = true;
    setNativeSnapshot({
      board: boardRef.current,
      data: renderedNativeData,
      configurationRevision: sourceRevision,
    });
    // A 200 response already committed the writer transaction. Adopt its exact
    // revision before refreshing native data; a refresh outage must not present
    // the committed change as an unsaved draft or invite a duplicate write.
    try {
      if (state?.board && state?.revision)
        await mutate(
          {
            revision: state.revision,
            configurationRevision: state.configurationRevision,
            board: state.board,
            discoveredSources: state.discoveredSources || [],
            hiddenDiscoveredIds: state.hiddenDiscoveredIds || [],
          },
          { revalidate: false },
        );
      else await mutate();
    } catch {
      // The transaction is committed. The paired refresh below retries reads.
    }
    // Successful commits explicitly bypass the unsaved-draft dismissal guard.
    dismissEditor();
    setSelection([]);
    setNotice(details.customJsChanged ? "Changes saved. Reload once to apply custom JavaScript." : "Changes saved");
    if (details.customJsChanged) setReloadRequired(true);
    await refreshNativeContent();
  };
  const reloadEditor = () => {
    if (modal) openEditor(modal.type, { panel: modal.panel, entry: modal.entry }, true);
  };
  const editPanel = (panel) => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    if (panel.nativeLocator?.discovered) {
      if (dirty) {
        setError(new Error("Save or cancel the current arrangement before changing discovered panel visibility."));
        return;
      }
      setModal({ type: "discovery", panel });
      setEditorData(null);
    } else if (isAdmin) openEditor("content", { panel });
  };
  const editStack = (stack) => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    setModal({
      type: "stack",
      stack,
      board,
      source: draftSource || {
        revision: envelope?.revision,
        configurationRevision: envelope?.configurationRevision,
        data: renderedNativeData,
      },
    });
    setEditorData(null);
  };
  const position = (id) => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    const unit = unitsForBoard(board).find((item) => item.id === id);
    if (unit)
      setModal({
        type: "position",
        board,
        source: draftSource || {
          revision: envelope?.revision,
          configurationRevision: envelope?.configurationRevision,
          data: renderedNativeData,
        },
        unit: { ...unit, minimum: unitMinimum(board, id) },
      });
  };
  const createStack = () => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    const next = stackBoard(board, selection, uuid());
    if (next !== board) {
      const stack = next.stacks.at(-1);
      const members = board.panels.filter((panel) => stack.panelIds.includes(panel.id));
      if (members.some((panel) => panel.rect.w !== stack.rect.w || panel.rect.h !== stack.rect.h)) {
        setModal({
          type: "stack",
          stack,
          previewBoard: next,
          source: draftSource || {
            revision: envelope?.revision,
            configurationRevision: envelope?.configurationRevision,
            data: renderedNativeData,
          },
        });
        return;
      }
      changeBoard(next);
      setSelection([]);
      setNotice("Stack created. Save the arrangement when ready.");
    }
  };

  const manipulate = (event, id, mode) => {
    if (saveInFlight.current || nativeRefreshLock.current || !envelope) return;
    if ((event.button !== undefined && event.button !== 0) || event.isPrimary === false) return;
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
    let lastCell = null;
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
      const dx = Math.round((((moveEvent.clientX - start.x) / column) * COLUMNS) / initialProjection.columns);
      const dy = Math.round((moveEvent.clientY - start.y) / (ROW_HEIGHT + GAP));
      const rect = clampRect(
        mode === "resize"
          ? { ...unit.rect, w: unit.rect.w + dx, h: unit.rect.h + dy }
          : { ...unit.rect, x: unit.rect.x + dx, y: unit.rect.y + dy },
      );
      if (!lastCell || lastCell.dx !== dx || lastCell.dy !== dy) {
        latest =
          mode === "move"
            ? moveProjectedUnit(initial, id, { x: dx, y: dy }, initialProjection)
            : moveUnit(initial, id, rect);
        lastCell = { dx, dy };
        changeBoard(latest);
      }
      if (mode !== "move" || unit.kind !== "panel") return;
      const bounds = canvas.current.getBoundingClientRect();
      const point = {
        x: moveEvent.clientX - bounds.left,
        y: moveEvent.clientY - bounds.top,
      };
      const candidate = initialProjection.units.find((other) => {
        if (
          other.id === id ||
          other.rect.w !== initialProjection.units.find((item) => item.id === id).rect.w ||
          other.rect.h !== unit.rect.h
        )
          return false;
        const canonical = unitsForBoard(initial).find((item) => item.id === other.id);
        if (canonical.rect.w !== unit.rect.w || canonical.rect.h !== unit.rect.h) return false;
        const movingMinimum = panelMinimum(initial.panels.find((panel) => panel.id === id));
        const targetMinimum = unitMinimum(initial, other.id);
        const requiredHeight = Math.max(movingMinimum.h + 1, targetMinimum.h + (other.kind === "stack" ? 0 : 1), 3);
        if (unit.rect.h < requiredHeight || unit.rect.w < Math.max(movingMinimum.w, targetMinimum.w)) return false;
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
      if (upEvent.pointerId !== undefined && upEvent.pointerId !== start.pointerId) return;
      cancelDwell();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("lostpointercapture", onLostCapture, true);
      window.removeEventListener("pointerdown", onOtherPointer, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onEscape);
      if (element?.hasPointerCapture?.(start.pointerId)) element.releasePointerCapture(start.pointerId);
      if (cancel) changeBoard(initial);
      else if (target && stackReady && performance.now() - targetTime >= 500) {
        if (target.kind === "stack") {
          changeBoard({
            ...initial,
            stacks: initial.stacks.map((stack) =>
              stack.id === target.id ? { ...stack, panelIds: [...stack.panelIds, id] } : stack,
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
    const onLostCapture = (lostEvent) => {
      // A held child transfers implicit touch capture to this arrangement
      // owner. Cancel only if the owner no longer holds the active pointer.
      if (!element?.hasPointerCapture?.(start.pointerId)) onCancel(lostEvent);
    };
    const onOtherPointer = (pointerEvent) => {
      if (pointerEvent.pointerId !== start.pointerId) finish({}, true);
    };
    const onBlur = () => finish({}, true);
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
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
    window.addEventListener("lostpointercapture", onLostCapture, true);
    window.addEventListener("pointerdown", onOtherPointer, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onEscape);
  };
  useEffect(
    () => () => {
      operation.current?.();
    },
    [],
  );
  useEffect(() => {
    if (overlayOpen) operation.current?.();
  }, [overlayOpen]);
  const unitKey = (event, id, mode = "move") => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
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
    const amount = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    if (key === "y" && projection.columns < COLUMNS) {
      const projected = projection.units.find((item) => item.id === id);
      const neighbor = projection.units
        .filter(
          (item) =>
            item.id !== id &&
            Math.sign(item.rect.y - projected.rect.y) === amount &&
            item.rect.x < projected.rect.x + projected.rect.w &&
            item.rect.x + item.rect.w > projected.rect.x,
        )
        .sort((a, b) => Math.abs(a.rect.y - projected.rect.y) - Math.abs(b.rect.y - projected.rect.y))[0];
      const canonical = neighbor && unitsForBoard(board).find((item) => item.id === neighbor.id);
      if (neighbor && (projected.rect.y !== unit.rect.y || neighbor.rect.y !== canonical.rect.y)) {
        changeBoard(moveProjectedUnit(board, id, { x: 0, y: neighbor.rect.y - projected.rect.y }, projection));
        return;
      }
    }
    if (key === "x" && projection.columns < COLUMNS) {
      // A narrow layout shows units in reading order, so Left and Right move
      // one reading position, like a sideways drag, instead of shifting the
      // desktop column (which can wrap the unit somewhere unexpected).
      const ordered = [...projection.units].sort(
        (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
      );
      const index = ordered.findIndex((item) => item.id === id);
      const projected = ordered[index];
      const neighbor = ordered[index + amount];
      if (projected && neighbor) {
        changeBoard(
          moveProjectedUnit(
            board,
            id,
            {
              x: ((neighbor.rect.x - projected.rect.x) * COLUMNS) / projection.columns,
              y: neighbor.rect.y - projected.rect.y,
            },
            projection,
          ),
        );
      }
      if (projected) return;
    }
    changeBoard(moveUnit(board, id, { ...unit.rect, [key]: unit.rect[key] + amount }));
  };
  // People who can't arrange this dashboard are sent back from the editor and
  // settings pages. The settings page opens this dashboard's settings once
  // the access level and board are known.
  useEffect(() => {
    if (opened.current || accessLoading || (!editorPage && !settingsPage)) return;
    if (!canArrange) {
      opened.current = true;
      leave();
      return;
    }
    if (!settingsPage || nativeUnavailable) return;
    opened.current = true;
    const type = isAdmin ? "settings" : "appearance";
    const token = ++generation.current;
    loadEditorData(type).then(
      (loaded) => {
        if (token !== generation.current) return;
        setModal({ type });
        setEditorData(loaded);
      },
      (err) => {
        if (token !== generation.current) return;
        setModal({ type });
        setEditorError(err);
      },
    );
  });
  // Closing the settings dialog returns to Dashboards, but only once the
  // dialog has actually been shown: it loads asynchronously.
  const settingsShown = useRef(false);
  useEffect(() => {
    if (!settingsPage) return;
    if (modal) settingsShown.current = true;
    else if (settingsShown.current) leave();
  }, [settingsPage, modal, leave]);
  const finishEditing = async () => {
    if (await saveArrangement(true)) leave();
  };
  const stackedIds = new Set(board.stacks.flatMap((stack) => stack.panelIds));
  const stackableSelection = selection.filter(
    (id) => board.panels.some((panel) => panel.id === id) && !stackedIds.has(id),
  );
  const modalTitles = {
    picker: "Add to your dashboard",
    content: modal?.panel ? `Edit ${modal.panel.title}` : modal?.entry?.name || "Configure content",
    settings: "Dashboard settings",
    appearance: "Appearance",
    files: "Configuration files",
    backups: "Snapshots & restore",
    stack: "Edit widget stack",
    position: "Position & size",
    discovery: modal?.panel?.title || "Discovered content",
    discardArrangement: "Discard arrangement?",
  };

  return (
    <main className={`studio-app${editing ? " studio-edit-mode" : ""}`} aria-busy={saving || refreshing || undefined}>
      <StudioTopBar
        title={access?.dashboard?.name || settings?.title || "Dashboard"}
        dashboardId={access?.dashboard?.id}
        logo={access?.dashboard?.logo ? dashboardPath(`/studio/logo?v=${access.dashboard.logo.version}`) : undefined}
        access={access}
        onSearch={editing ? undefined : onSearch}
        searchDisabled={controlsDisabled}
      />
      {editorPage && (canArrange || accessLoading) && (
        <header className="studio-page-header studio-editor-header">
          <div>
            <p className="studio-eyebrow">Editing</p>
            <h1>{access?.dashboard?.name || settings?.title || "Dashboard"}</h1>
            <p className="studio-subtitle">Move, resize and stack widgets. Done saves and takes you back to Dashboards.</p>
          </div>
          <div className="studio-header-actions">
            <button
              className="studio-button studio-quiet"
              disabled={saving}
              onClick={() => {
                // An unsaved arrangement uses the same explicit discard
                // confirmation as editor drafts.
                if (dirty) setModal({ type: "discardArrangement" });
                else leave();
              }}
            >
              Cancel
            </button>
            <button className="studio-button studio-primary" disabled={controlsDisabled} onClick={finishEditing}>
              <StudioIcon name="check" size={16} />
              {saving ? "Saving…" : "Done"}
            </button>
          </div>
        </header>
      )}
      <ErrorMessage
        arrangement
        error={error || sourceConflict || loadError}
        heading={!error && !sourceConflict && loadError ? "The dashboard could not refresh" : undefined}
        onReload={
          saving
            ? undefined
            : () => {
                setDraft(null);
                setDraftSource(null);
                setError(null);
                refreshNativeContent();
              }
        }
      />
      <div className="studio-board-toolbar" hidden={!editing && groups.length < 2}>
        {editing ? (
          <>
            {isAdmin && (
              <button
                className="studio-button studio-quiet"
                disabled={controlsDisabled}
                onClick={() => openEditor("picker")}
              >
                <StudioIcon name="plus" size={16} />
                Widgets
              </button>
            )}
            <button
              className="studio-button studio-quiet"
              disabled={controlsDisabled || stackableSelection.length < 2}
              onClick={createStack}
            >
              <StudioIcon name="stack" size={16} />
              Create stack
              {stackableSelection.length > 0 ? ` (${stackableSelection.length})` : ""}
            </button>
            <button
              className="studio-button studio-quiet"
              disabled={controlsDisabled || selection.length !== 1}
              onClick={() => position(selection[0])}
            >
              Position & size
            </button>
            <span className="studio-toolbar-spacer" />
            <span className="studio-muted">
              {dirty ? "Unsaved arrangement" : "Drag a panel by its handle to move it · resize from the corner"}
            </span>
            {dirty && (
              <button
                className="studio-button studio-primary"
                disabled={controlsDisabled}
                onClick={() => saveArrangement(false)}
              >
                Save arrangement
              </button>
            )}
          </>
        ) : (
          <>
            <nav className="studio-group-filter" aria-label="Filter native groups">
              <button
                className={filter === "all" ? "studio-filter-active" : ""}
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All content
              </button>
              {groups.map((group) => (
                <button
                  className={filter === group ? "studio-filter-active" : ""}
                  aria-pressed={filter === group}
                  key={group}
                  onClick={() => setFilter(group)}
                >
                  {group}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
      <div className="studio-status-message" role="status">
        {notice}
        {(refreshWarning || (envelope && nativeContentStale && !draftSourceChanged)) && (
          <span>
            {" "}
            {nativeSnapshot
              ? refreshWarning
                ? "Your changes were saved, but widget data could not refresh."
                : "Changes saved. Refreshing widget data."
              : refreshWarning
                ? "Widget data could not refresh."
                : "Waiting for matching widget data."}{" "}
            <button className="studio-text-button" disabled={refreshing} onClick={refreshNativeContent}>
              {refreshing ? "Refreshing…" : "Refresh widgets"}
            </button>
          </span>
        )}
        {reloadRequired && (
          <button className="studio-text-button" onClick={() => window.location.reload()}>
            Reload dashboard
          </button>
        )}
      </div>
      <div
        ref={canvas}
        className="studio-canvas"
        style={{
          height: board.panels.length ? projection.rows * (ROW_HEIGHT + GAP) + 32 : 480,
          "--studio-grid-column": `${(width + GAP) / projection.columns}px`,
          "--studio-grid-row": `${ROW_HEIGHT + GAP}px`,
        }}
      >
        {!board.panels.length && (
          <div className="studio-empty">
            <span className="studio-empty-icon">
              <StudioIcon name="layout" size={32} />
            </span>
            <p className="studio-eyebrow">A clean slate</p>
            <h2>{envelope ? "Make room for what matters." : "Opening your dashboard…"}</h2>
            {editorPage && isAdmin ? (
              <>
                <p>
                  Add a service, a clock, a bookmark, or a native integration.
                  <br />
                  Arrange each panel freely. Stack the ones that belong together.
                </p>
                <button
                  className="studio-button studio-primary"
                  disabled={controlsDisabled}
                  onClick={() => openEditor("picker")}
                >
                  <StudioIcon name="plus" size={17} />
                  Add your first widget
                </button>
                <small>No sample connections. Start with your own.</small>
              </>
            ) : canArrange ? (
              <p>
                Nothing has been added yet. To add widgets, open{" "}
                <a className="studio-text-button" href={DASHBOARDS_PAGE}>
                  Dashboards
                </a>{" "}
                and choose Edit for this dashboard.
              </p>
            ) : (
              <p>An administrator hasn&apos;t added anything to this dashboard yet.</p>
            )}
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
          data={renderedNativeData}
          geometry={geometry}
          visibleIds={visibleIds}
          active={active}
          controllers={controllers}
          selection={selection}
          editing={editing}
          busy={controlsDisabled}
          stale={nativeContentStale}
          saved={Boolean(nativeSnapshot)}
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
          canEdit={(panel) => isAdmin || Boolean(panel.nativeLocator?.discovered)}
          onSelect={select}
          onManipulate={manipulate}
          onUnitKey={unitKey}
          overlayOpen={overlayOpen}
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
              selected={selection.includes(stack.id)}
              onSelect={select}
              busy={controlsDisabled}
              overlayOpen={overlayOpen}
              reducedMotion={reducedMotion}
              onActive={onActive}
              registerController={registerController}
              onEdit={editStack}
              onManipulate={manipulate}
              onUnitKey={unitKey}
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
          Homepage Studio <span className="studio-footer-dot">·</span> Powered by Homepage
        </span>
        {editing && <span>Esc cancels a drag · arrow keys move · Shift + arrows resize</span>}
      </footer>
      {modal && (
        <StudioDialog
          title={modalTitles[modal.type]}
          onClose={closeModal}
          wide={modal.type === "files" || modal.type === "picker"}
          busy={editorGuard.pending}
        >
          <EditorDraftContext.Provider value={reportEditorDraft}>
            {discardAction && (
              <div className="studio-dialog-body studio-discard-prompt">
                <h3>{editorGuard.discard?.heading || "Discard unsaved changes?"}</h3>
                <p className="studio-note">
                  {editorGuard.discard?.description ||
                    "This editor has changes that have not been applied. Keep editing to preserve them, or discard them to continue."}
                </p>
                <div className="studio-inline-actions">
                  <button
                    ref={keepEditing}
                    type="button"
                    className="studio-button studio-primary"
                    onClick={() => setDiscardAction(null)}
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    className="studio-button studio-quiet"
                    onClick={() => {
                      const action = discardAction;
                      discardFocus.current = null;
                      setDiscardAction(null);
                      reportEditorDraft({ dirty: false, pending: false });
                      action();
                    }}
                  >
                    Discard changes
                  </button>
                </div>
              </div>
            )}
            <div hidden={Boolean(discardAction)} inert={Boolean(discardAction)}>
              {modal.type === "discardArrangement" ? (
                <div className="studio-dialog-body">
                  <h3>Discard unsaved changes?</h3>
                  <p className="studio-note">
                    This arrangement has moves, sizes or stacks that have not been saved. Keep editing to preserve
                    them, or discard them to leave edit mode.
                  </p>
                  <div className="studio-inline-actions">
                    <button
                      ref={keepArrangement}
                      type="button"
                      className="studio-button studio-primary"
                      onClick={dismissEditor}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      className="studio-button studio-quiet"
                      onClick={() => {
                        dismissEditor();
                        cancelEditing();
                        if (editorPage) leave();
                      }}
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              ) : modal.type === "discovery" ? (
                <DiscoveryEditor
                  panel={modal.panel}
                  revision={envelope.revision}
                  onSaved={savedContent}
                  onPosition={() => requestEditorAction(() => position(modal.panel.id))}
                  onClose={closeModal}
                />
              ) : modal.type === "stack" ? (
                <StackEditor
                  stack={modal.stack}
                  board={modal.previewBoard || modal.board || board}
                  fitting={Boolean(modal.previewBoard)}
                  blocked={nativeContentStale}
                  onApply={(next) => {
                    if (changeBoard(next, modal.source)) {
                      setSelection([]);
                      dismissEditor();
                    }
                  }}
                  onClose={closeModal}
                  onPanelEdit={(panel) => {
                    requestEditorAction(() => {
                      dismissEditor();
                      editPanel(panel);
                    });
                  }}
                />
              ) : modal.type === "position" ? (
                <PositionEditor
                  unit={modal.unit}
                  blocked={nativeContentStale}
                  onApply={(rect) => {
                    if (changeBoard(moveUnit(modal.board, modal.unit.id, rect), modal.source)) dismissEditor();
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
                        await studioRequest("/studio/api/discovery-visibility", {
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
                  key={modal.panel?.id || `${modal.entry?.kind}:${modal.entry?.type}`}
                  {...editorData}
                  panel={modal.panel}
                  entry={modal.entry}
                  onSaved={savedContent}
                  onCancel={closeModal}
                  onReload={reloadEditor}
                  onDuplicate={(entry) => requestEditorAction(() => setModal({ type: "content", entry }))}
                  onParent={(parent) =>
                    requestEditorAction(() =>
                      setModal({
                        type: "content",
                        panel: {
                          id: parent.id,
                          kind: "service",
                          title: parent.name,
                        },
                      }),
                    )
                  }
                />
              ) : modal.type === "appearance" ? (
                <AppearanceOnlyEditor
                  {...editorData}
                  logo={access?.dashboard?.logo ?? null}
                  onLogoChange={() => mutateAccess()}
                  onSaved={savedContent}
                  onClose={closeModal}
                  onReload={reloadEditor}
                />
              ) : modal.type === "settings" ? (
                <SettingsEditor
                  {...editorData}
                  logo={access?.dashboard?.logo ?? null}
                  onLogoChange={() => mutateAccess()}
                  onSaved={savedContent}
                  onClose={closeModal}
                  onOpenFiles={() => requestEditorAction(() => setModal({ type: "files" }))}
                  onOpenBackups={() => requestEditorAction(() => openEditor("backups"))}
                  onReload={reloadEditor}
                />
              ) : modal.type === "files" ? (
                <FilesEditor {...editorData} onSaved={savedContent} onClose={closeModal} onReload={reloadEditor} />
              ) : (
                <SnapshotEditor {...editorData} onSaved={savedContent} onClose={closeModal} onReload={reloadEditor} />
              )}
            </div>
          </EditorDraftContext.Provider>
        </StudioDialog>
      )}
    </main>
  );
}
