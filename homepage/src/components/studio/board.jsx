import Head from "next/head";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";

import { endEditSession, newEditSession, studioRequest } from "./api.mjs";
import AppearanceOnlyEditor from "./appearance-only-editor";
import { PageBackgroundEditor } from "./background-picker";
import { applyChanges, BulkLookEditor, BulkSizeEditor, DeleteWidgetsConfirm, widgetCount } from "./bulk-bar";
import CardBackground from "./card-background";
import { ChartFullView, chartRanges } from "./card-chart";
import { canRefresh, refreshCards, resolvedBehaviour, resolvedLook, useCardTheme } from "./card-look";
import { ConnectionsEditor } from "./connections";
import ContentEditor, { ContentPicker, duplicateEntry } from "./content-editor";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioDialog, { ErrorMessage } from "./dialog";
import DiscoveryEditor from "./discovery-editor";
import { EditorDraftContext } from "./draft-guard";
import { useBoardFocusOrder } from "./focus-order";
import {
  addPage,
  clampRect,
  columnsOfPage,
  firstPageId,
  freePageName,
  gapOf,
  gridColumns,
  MAX_PAGES,
  movePage,
  moveToPage,
  moveUnit,
  pageBoard,
  pageFromHash,
  pageHash,
  panelMinimum,
  pixelRect,
  removePage,
  resizeUnit,
  ROW_HEIGHT,
  snapGuides,
  stackBoard,
  tidyBoard,
  unitMinimum,
  unitsForBoard,
  updatePage,
} from "./geometry.mjs";
import StudioIcon from "./icons";
import {
  centreInRow,
  followDesktop,
  followsDesktop,
  mergeSizeView,
  setPageGrid,
  SIZE_WIDTH,
  sizeForWidth,
  sizeProjection,
  sizeView,
} from "./layouts.mjs";
import { CHART_SHOWS, needsHistory, readLook, showsOn, statusColours } from "./look.mjs";
import Menu from "./menu";
import { resolveNativePanel } from "./native-adapter.mjs";
import PageTabs, { DeletePageDialog, MoveHereDialog, PageIconEditor } from "./pages";
import PanelHost, { CardPreview, useCardPresentation } from "./panel-host";
import { useReducedMotion } from "./preferences";
import { rebaseBoard } from "./rebase.mjs";
import StudioSearch from "./search";
import SettingsEditor, { FilesEditor, SnapshotEditor } from "./settings-editor";
import { SizePreview, SizeStatus, SizeSwitch } from "./size-switch";
import StackEditor, { PositionEditor } from "./stack-editor";
import StackShell from "./stack-shell";
import StudioTopBar, { DASHBOARDS_PAGE } from "./top-bar";
import { ImagesEditor } from "./uploaded-images";

const HOME_PAGES = [{ id: "home", name: "Home" }];
const EMPTY = { version: 3, columns: 24, pages: HOME_PAGES, panels: [], stacks: [] };
// A moment after the last change, so a burst of keys saves once.
const AUTOSAVE_DELAY = 400;
// The page on show lives in the address (#media). pushState doesn't fire an
// event, so changes made here notify the subscribers themselves.
const hashListeners = new Set();
const subscribeHash = (listener) => {
  hashListeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    hashListeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
};
const readHash = () => window.location.hash;
const noHash = () => "";
function writeHash(hash, replace) {
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState(window.history.state, "", url);
  hashListeners.forEach((listener) => listener());
}
const lastPageKey = (id) => `studio-last-page:${id}`;
function readLastPage(id) {
  try {
    return localStorage.getItem(lastPageKey(id));
  } catch {
    return null;
  }
}
// Typing in a field never changes page or undoes an arrangement.
// A copied look is plain colours and choices, never secrets, so it is kept in
// this browser and can be pasted on any dashboard.
const LOOK_CLIPBOARD = "studio-look-clipboard";
function readLookClipboard() {
  try {
    const stored = localStorage.getItem(LOOK_CLIPBOARD);
    return stored === null ? null : readLook(JSON.parse(stored));
  } catch {
    return null;
  }
}

const typing = (target) =>
  target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], dialog"));
const EMPTY_NATIVE = {};
const isConfigurationRevision = (revision) => typeof revision === "string" && /^[a-f0-9]{64}$/.test(revision);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = () => globalThis.crypto?.randomUUID?.() || `stack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
// One stable React parent owns every native host for its entire board lifetime.
// Stack shells are siblings; a membership change never reparents native content.
// Wide enough to dock the widget editor beside the board and still leave the
// board about 900px (480px panel + 20px gap); narrower screens keep the
// full-height sheet. Matches the media query in studio.css.
const DOCK_QUERY = "(min-width: 1400px)";
function useWideScreen() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(DOCK_QUERY) : null;
    if (!query) return undefined;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return wide;
}

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
  onFullView,
  canEdit,
  onSelect,
  onManipulate,
  onUnitKey,
  onLongPress,
  renderNative,
  toolsShown = null,
  offLayout = null,
  liveDraft = null,
}) {
  const stackByPanel = new Map(board.stacks.flatMap((stack) => stack.panelIds.map((id) => [id, stack])));
  // Keep DOM sibling order independent of geometry. Moving an existing iframe
  // with insertBefore can reload its document even when its React key survives.
  // Keyboard order follows the layout through useBoardFocusOrder instead.
  const panels = board.panels;
  return (
    <div className="studio-panel-layer">
      {panels.map((shown) => {
        // The widget being edited in the docked editor shows its draft.
        const live = liveDraft?.panel?.id === shown.id ? liveDraft : null;
        const panel = live
          ? { ...shown, look: live.panel.look, behaviour: live.panel.behaviour, title: live.panel.title }
          : shown;
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
            onFullView={onFullView}
            canEdit={canEdit ? canEdit(panel) : true}
            onSelect={onSelect}
            onManipulate={onManipulate}
            onUnitKey={onUnitKey}
            onLongPress={onLongPress}
            renderNative={renderNative}
            toolsShown={!stack && toolsShown === panel.id}
            offLayout={offLayout?.has(panel.id) || false}
            override={live?.override || null}
          />
        );
      })}
    </div>
  );
}

// A chart widget full size, with its own look (names, colours, format).
function FullViewHost({ panel, data, settings, onClose }) {
  const { card } = useCardPresentation(panel, data);
  return (
    <ChartFullView
      panel={panel}
      card={card}
      title={panel.title || "Chart"}
      ranges={chartRanges(settings, card.chartRange)}
      onClose={onClose}
    />
  );
}

// Only shortcuts that work where the sheet is opened.
function ShortcutsSheet({ editing, pages }) {
  const rows = [
    pages && ["1 – 9", "Go to that page"],
    pages && ["[  ]", "Previous or next page"],
    !editing && ["Ctrl / ⌘ K, or type", "Search"],
    editing && ["Ctrl / ⌘ Z", "Undo"],
    editing && ["Ctrl / ⌘ Shift Z", "Redo"],
    editing && ["Ctrl / ⌘ S", "Save and keep editing"],
    editing && ["Arrow keys", "Move the selected widget"],
    editing && ["Shift + arrow keys", "Resize the selected widget"],
    editing && ["Esc", "Cancel a drag, or clear the selection"],
    editing && ["F2", "Rename the current page"],
    editing && ["Right-click or hold", "Widget menu (or the menu key)"],
    editing && ["Shift-click, or drag a box", "Select several widgets"],
    editing && ["Ctrl / ⌘ A", "Select everything on this page"],
    editing && ["E", "Edit the selected widget"],
    editing && ["Ctrl / ⌘ D", "Duplicate the selected widget"],
    editing && ["Ctrl / ⌘ Alt C, then V", "Copy a widget's look, then paste it"],
    editing && ["Delete", "Delete the selected widget"],
    editing && ["R", "Refresh the selected widget now"],
    ["Shift R", "Refresh every widget on this page now"],
    ["?", "Show these shortcuts"],
  ].filter(Boolean);
  return (
    <div className="studio-dialog-body">
      <dl className="studio-shortcuts">
        {rows.map(([keys, action]) => (
          <div key={action}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Widgets a layout leaves out (behaviour "Show on"), dropped from the board
// before it is projected. A stack keeps its other members.
export function withoutHiddenOn(board, settings, size) {
  const hidden = new Set(
    board.panels.filter((panel) => !showsOn(resolvedBehaviour(settings, panel).showOn, size)).map((panel) => panel.id),
  );
  if (!hidden.size) return board;
  return {
    ...board,
    panels: board.panels.filter((panel) => !hidden.has(panel.id)),
    stacks: board.stacks
      .map((stack) => ({ ...stack, panelIds: stack.panelIds.filter((id) => !hidden.has(id)) }))
      .filter((stack) => stack.panelIds.length),
  };
}

// What the editing bar says about saving (board 21): quiet when saved.
function SaveStatus({ state, pending }) {
  const text =
    state === "retrying"
      ? "Not saved yet, retrying"
      : state === "failed"
        ? "Not saved"
        : state === "saving" || pending
          ? "Saving…"
          : "Saved";
  return (
    <span
      className={`studio-muted studio-edit-bar-note${state === "retrying" || state === "failed" ? " studio-save-problem" : ""}`}
      role="status"
      title={
        state === "retrying"
          ? "Studio couldn't be reached. Your changes stay in this tab and save when it can; Done waits for them."
          : undefined
      }
    >
      {text}
    </span>
  );
}

export default function StudioBoard({
  dashboard = { id: "default", basePath: "" },
  nativeData,
  settings,
  onNativeChange,
  onSearch,
  // Search over every page (search.jsx), owned by the dashboard page.
  search = null,
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
  // Until the answer arrives every control shows but stays disabled; a failed
  // or unexpected answer leaves only viewing. With sign-in off Studio answers admin.
  const accessLoading = !access && !accessError;
  const level = ["view", "arrange", "admin"].includes(access?.level) ? access.level : accessLoading ? "admin" : "view";
  const isAdmin = level === "admin";
  const canArrange = isAdmin || level === "arrange";
  const [draft, setDraft] = useState(null);
  const [draftSource, setDraftSource] = useState(null);
  // The editor page is always in editing; it is left by navigating away.
  const editing = editorPage && canArrange;
  const [selection, setSelection] = useState([]);
  // Phones (owner choice, 1 Nov): while editing, a widget's Move, Edit and
  // resize controls show only on the widget last tapped, so they never cover
  // what the other widgets show. A mouse shows them on hover instead.
  const [toolsShown, setToolsShown] = useState(null);
  const lastPointer = useRef("mouse");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  // Editing saves as you go (owner decision, 4 Nov 2026). Undo and Redo step
  // through this editing session on the server, content changes included.
  const [saveState, setSaveState] = useState("saved");
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const [toast, setToast] = useState(null);
  const [dropPage, setDropPage] = useState(null);
  const [pageMenu, setPageMenu] = useState(null);
  const [unitMenu, setUnitMenu] = useState(null);
  // Full view of a chart widget (board 15).
  const [fullView, setFullView] = useState(null);
  const [marquee, setMarquee] = useState(null);

  const [lookClipboard, setLookClipboard] = useState(readLookClipboard);
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
  // The editor's size switch (board 22): null shows the screen's own size.
  const [editSize, setEditSize] = useState(null);
  // Whether the screen is wide enough to show the switch (a desktop screen).
  // Measured after the first render, so the server's page and the browser's
  // first render agree (React hydration).
  const [screenWidth, setScreenWidth] = useState(1280);
  useEffect(() => {
    const measure = () => setScreenWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const sizeSwitchShown = sizeForWidth(screenWidth) === "desktop";
  const [moving, setMoving] = useState(null);
  const [stackTarget, setStackTarget] = useState(null);
  const [stackDrags, setStackDrags] = useState({});
  const canvas = useRef(null);
  const boardRef = useRef(null);
  const wholeRef = useRef(null);
  // Undo and redo cover every change of this editing session, kept by the
  // server. Here only whether each is available: the server answers that
  // after an undo or redo, and any other saved change makes undo available.
  const history = useRef({ past: [], future: [] });
  const setHistory = useCallback((next) => {
    history.current = next;
    setHistoryCounts({ past: next.past.length, future: next.future.length });
  }, []);
  const changeSaved = useCallback(() => setHistory({ past: [true], future: [] }), [setHistory]);
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
  // Set the moment an arrangement change is made, cleared once it is saved.
  const draftPending = useRef(false);
  const nativeRefreshLock = useRef(true);
  const editorGuardRef = useRef(editorGuard);
  const discardFocus = useRef(null);
  const keepEditing = useRef(null);
  const reducedMotion = useReducedMotion();
  // Read by saves that outlive a render.
  const latestEnvelope = useRef(envelope);
  const draftSourceRef = useRef(draftSource);
  useLayoutEffect(() => {
    latestEnvelope.current = envelope;
  }, [envelope]);
  useLayoutEffect(() => {
    draftSourceRef.current = draftSource;
  }, [draftSource]);
  // One editing session per visit to the editor page: Undo reaches back to
  // where this visit started, never further.
  useEffect(() => {
    if (!editing) return undefined;
    const id = newEditSession();
    return () => endEditSession(id);
  }, [editing]);
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
  const wholeBoard = renderSnapshot?.board || sourceBoard;
  const pages = wholeBoard.pages?.length ? wholeBoard.pages : HOME_PAGES;
  const hash = useSyncExternalStore(subscribeHash, readHash, noHash);
  // "Opens on: last page viewed" is remembered per device.
  const opensOnLast = settings?.studioDefaults?.opensOn === "last";
  const remembered = useSyncExternalStore(
    subscribeHash,
    () => (opensOnLast ? readLastPage(dashboard.id) : null),
    () => null,
  );
  const currentPage =
    pageFromHash(wholeBoard, hash) ||
    (remembered && pages.some((page) => page.id === remembered) ? remembered : firstPageId(wholeBoard));
  // Everything below works on the current page; only its widgets mount, so
  // widgets on other pages don't poll their services.
  // The size being shown: the screen's own, or in the editor the one picked
  // in its size switch. A tablet or phone view carries that size's layout.
  // The editor docked beside the board narrows it; the layout being edited
  // stays the one chosen before it opened.
  const wideScreen = useWideScreen();
  const docked = Boolean(wideScreen && modal?.type === "content" && modal.panel);
  // (The panel takes min(480px, 42vw) plus a 20px gap; see studio.css.)
  const dockWidth = docked && typeof window !== "undefined" ? Math.min(480, window.innerWidth * 0.42) + 20 : 0;
  const layoutSize = editing && editSize ? editSize : sizeForWidth(width + dockWidth);
  // The live dashboard lays a size out without the widgets it leaves out
  // (Show on), so a generated tablet or phone layout closes up around them
  // rather than keeping their gap (review M6).
  const board = useMemo(
    () =>
      sizeView(
        editing
          ? pageBoard(wholeBoard, currentPage)
          : withoutHiddenOn(pageBoard(wholeBoard, currentPage), settings, layoutSize),
        layoutSize,
      ),
    [wholeBoard, currentPage, layoutSize, editing, settings],
  );
  // The page's own background, or the dashboard's (Appearance).
  const cardTheme = useCardTheme();
  const dashboardPageBackground = readLook({ background: settings?.studioTheme?.pageBackground }).background;
  const pageBackground = pages.find((page) => page.id === currentPage)?.background ?? dashboardPageBackground;
  const renderedNativeData = renderSnapshot ? renderSnapshot.data : nativePairMatches ? nativeData : EMPTY_NATIVE;
  const nativeUnavailable = !envelope || nativeContentStale;
  const controlsDisabled = saving || nativeUnavailable || accessLoading;
  const interactionBlocked = Boolean(modal) || controlsDisabled;
  // Content that changed under an arrangement is merged when it saves
  // (owner report, 4 Nov 2026: Save must never dead-end), so it is no
  // conflict to report.
  const dirty = Boolean(draft && !equal(draft, envelope?.board));
  useLayoutEffect(() => {
    boardRef.current = board;
    wholeRef.current = wholeBoard;
  }, [board, wholeBoard]);
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
  // The live dashboard leaves out widgets not shown on this layout. The
  // editor keeps them, faded, so they can still be found and turned back on.
  const projection = useMemo(
    () => sizeProjection(editing ? board : withoutHiddenOn(board, settings, layoutSize), layoutSize),
    [board, layoutSize, editing, settings],
  );
  // While editing: the widgets this layout leaves out (shown faded).
  const offLayout = useMemo(
    () =>
      editing
        ? new Set(
            board.panels
              .filter((panel) => !showsOn(resolvedBehaviour(settings, panel).showOn, layoutSize))
              .map((panel) => panel.id),
          )
        : null,
    [board, settings, editing, layoutSize],
  );
  const gap = gapOf(settings);
  const geometry = useMemo(
    () => new Map(projection.units.map((unit) => [unit.id, pixelRect(unit.rect, width, projection.columns, gap)])),
    [projection, width, gap],
  );
  // Tab follows the projected layout (row, then column) without reordering
  // native hosts in the DOM.
  const readingOrder = useMemo(
    () => [...projection.units].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((unit) => unit.id),
    [projection],
  );
  useBoardFocusOrder(canvas, readingOrder);
  // Names for the small pictures of the other sizes.
  const unitTitles = useMemo(
    () =>
      new Map([
        ...board.panels.map((panel) => [panel.id, panel.title]),
        ...board.stacks.map((stack) => [stack.id, "Stack"]),
      ]),
    [board],
  );
  const visibleIds = null;

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
  // Commits a whole board (all pages) as the arrangement draft. `record`
  // false is for the many steps of one drag; the drag records once.
  const commitWhole = useCallback(
    (next, source, { pageId } = {}) => {
      // An autosave in flight never blocks the next change: it saves next.
      if (nativeRefreshLock.current) return false;
      const previous = wholeRef.current;
      if (next === previous) return true;
      // Pointer cancellation may arrive before React commits the queued draft.
      // Keep the next gesture event aligned with the last submitted board.
      wholeRef.current = next;
      let shown = pageId ?? boardRef.current?.pageId;
      if (!next.pages?.some((page) => page.id === shown)) shown = firstPageId(next);
      boardRef.current = pageBoard(next, shown);
      // Keep the address on the page in view: a rename changes its name, and
      // undo can bring back or take away pages.
      if (pageFromHash(next, window.location.hash) !== shown && (window.location.hash || shown !== firstPageId(next)))
        writeHash(pageHash(next, shown), true);
      // The base is the saved board this draft started from: a save that
      // meets someone else's change keeps theirs where this draft didn't move.
      setDraftSource(
        (current) =>
          current ||
          source || {
            revision: envelope?.revision,
            configurationRevision: envelope?.configurationRevision,
            data: nativeData,
            board: envelope?.board,
          },
      );
      draftPending.current = true;
      setDraft(next);
      setError(null);
      setNotice("");
      return true;
    },
    [envelope?.revision, envelope?.configurationRevision, envelope?.board, nativeData],
  );
  // Changes made on the current page's view merge back into the whole board.
  const changeBoard = useCallback(
    (nextView, source, options) => {
      if (nextView === boardRef.current) return !nativeRefreshLock.current;
      return commitWhole(mergeSizeView(wholeRef.current, nextView), source, options);
    },
    [commitWhole],
  );

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
  // A widget's editor docks beside the board on wide screens (T26): the real
  // card shows the draft as it changes.
  const [liveDraft, setLiveDraft] = useState(null);
  const editedId = docked ? modal.panel.id : null;
  useEffect(() => {
    if (!editedId) return;
    // Bring the card being edited into view beside the panel.
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-panel-id="${CSS.escape(editedId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "auto" }),
    );
  }, [editedId]);
  const closeModal = () => {
    if (discardAction) setDiscardAction(null);
    else requestEditorAction(dismissEditor);
  };

  // Saves the arrangement as it stands (every page). Changes made while it
  // saves are kept and saved next. Someone else's save in between is merged:
  // what this draft moved stays moved, the rest follows theirs.
  const pendingSave = useRef(null);
  const retryTimer = useRef(null);
  const retryDelay = useRef(2000);
  const retrySave = useRef(null);
  const saveArrangement = useCallback(() => {
    if (pendingSave.current) return pendingSave.current;
    const run = async () => {
      for (let attempt = 0; ; attempt += 1) {
        const whole = wholeRef.current;
        const base = latestEnvelope.current;
        if (!draftPending.current || !whole || equal(whole, base?.board)) {
          draftPending.current = false;
          setDraft(null);
          setDraftSource(null);
          setSaveState("saved");
          return true;
        }
        setSaveState("saving");
        try {
          const saved = await studioRequest("/studio/api/board", { revision: base?.revision, board: whole });
          await mutate(saved, { revalidate: false });
          latestEnvelope.current = saved;
          retryDelay.current = 2000;
          changeSaved();
          if (wholeRef.current === whole) {
            draftPending.current = false;
            setDraft(null);
            setDraftSource(null);
            setSaveState("saved");
            return true;
          }
          // Changed while saving: the newer board saves next, on this base.
          setDraftSource({
            revision: saved.revision,
            configurationRevision: saved.configurationRevision,
            data: draftSourceRef.current?.data,
            board: saved.board,
          });
        } catch (err) {
          if (err?.status === 409 && err.details?.code === "REVISION_CONFLICT" && attempt < 3) {
            // Someone else saved: take theirs, keep what this draft changed.
            const theirs = await mutate();
            if (theirs?.board) {
              const merged = rebaseBoard(draftSourceRef.current?.board, wholeRef.current, theirs.board);
              latestEnvelope.current = theirs;
              wholeRef.current = merged;
              setDraft(merged);
              setDraftSource({
                revision: theirs.revision,
                configurationRevision: theirs.configurationRevision,
                data: draftSourceRef.current?.data,
                board: theirs.board,
              });
              continue;
            }
          }
          // Unreachable or busy: the changes stay in this tab and save when it can.
          if (!err?.status || err.status >= 500 || err.status === 408 || err.status === 429) {
            setSaveState("retrying");
            clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null;
              retrySave.current?.();
            }, retryDelay.current);
            retryDelay.current = Math.min(retryDelay.current * 2, 30000);
            return false;
          }
          setSaveState("failed");
          setError(err);
          return false;
        }
      }
    };
    const promise = run().finally(() => {
      pendingSave.current = null;
    });
    pendingSave.current = promise;
    return promise;
  }, [mutate, changeSaved]);
  useLayoutEffect(() => {
    retrySave.current = saveArrangement;
  }, [saveArrangement]);
  const savePending = () => Boolean(pendingSave.current || draftPending.current || retryTimer.current);
  // Everything pending saved, before anything that saves content or leaves.
  const flushArrangement = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
    if (pendingSave.current) await pendingSave.current;
    return saveArrangement();
  }, [saveArrangement]);
  // Autosave: a moment after the last change, never in the middle of a drag.
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (!editing || !draft) return undefined;
    const schedule = () => {
      autosaveTimer.current = setTimeout(() => {
        autosaveTimer.current = null;
        if (operation.current) schedule();
        else saveArrangement();
      }, AUTOSAVE_DELAY);
    };
    clearTimeout(autosaveTimer.current);
    schedule();
    return () => clearTimeout(autosaveTimer.current);
  }, [editing, draft, saveArrangement]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const loadCatalog = () => {
    if (!catalogRequest.current) {
      const request = studioRequest("/studio/catalog.json");
      catalogRequest.current = request;
      request.catch(() => {
        if (catalogRequest.current === request) catalogRequest.current = null;
      });
    }
    return catalogRequest.current;
  };
  const loadEditorData = async (type) => {
    if (type === "picker" || type === "content") loadCatalog();
    if (type === "appearance") return { appearance: await studioRequest("/studio/api/appearance") };
    // Arrangers place saved widgets from the board alone; the files stay
    // with administrators.
    if (type === "saved") {
      loadCatalog();
      const [state, catalog] = await Promise.all([studioRequest("/studio/api/board"), catalogRequest.current]);
      return { state, catalog };
    }
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
    // Anything still saving lands first, so the editor starts from it.
    if (savePending() && !(await flushArrangement())) return;
    const token = ++generation.current;
    setModal({ type, ...detail });
    setEditorError(null);
    setEditorData(null);
    try {
      const loaded = await loadEditorData(type);
      if (token !== generation.current) return;
      // The widget menu's Duplicate opens the add editor, filled from the saved item.
      if (detail.duplicate) {
        const entry = duplicateEntry(detail.panel, loaded.state, loaded.catalog);
        if (!entry) throw new Error("That widget is no longer in the configuration.");
        setModal({ type, entry });
      }
      setEditorData(loaded);
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
  // A committed change from anywhere (a dialog, a bulk action, undo).
  const savedContent = async (state, details = {}) => {
    if (!details.stepped) changeSaved();
    nativeRefreshLock.current = true;
    setNativeSnapshot({
      board: wholeRef.current,
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
    // The arrangement now is exactly what was committed.
    draftPending.current = false;
    setDraft(null);
    setDraftSource(null);
    // Successful commits explicitly bypass the unsaved-draft dismissal guard.
    if (!details.stepped) dismissEditor();
    setSelection([]);
    // In the editor the bar's Saved says a plain save happened; only what
    // needs more is noted there.
    if (!details.stepped && !details.quiet)
      setNotice(
        [
          details.importNote,
          details.customJsChanged
            ? "Changes saved. Reload once to apply custom JavaScript."
            : details.importNote || editorPage
              ? ""
              : "Changes saved",
        ]
          .filter(Boolean)
          .join(" "),
      );
    if (details.customJsChanged) setReloadRequired(true);
    await refreshNativeContent();
  };
  const reloadEditor = () => {
    if (modal) openEditor(modal.type, { panel: modal.panel, entry: modal.entry }, true);
  };
  const editPanel = async (panel) => {
    if (saveInFlight.current || nativeRefreshLock.current) return;
    if (panel.nativeLocator?.discovered) {
      if (!(await flushArrangement())) return;
      setModal({ type: "discovery", panel });
      setEditorData(null);
    } else if (isAdmin) {
      // With the editor docked the board stays usable: editing another widget
      // switches the panel to it, asking first about unsaved changes.
      if (modal?.type === "content" && modal.panel?.id === panel.id) return;
      if (modal) requestEditorAction(() => openEditor("content", { panel }));
      else openEditor("content", { panel });
    }
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
    // A stack is made on the desktop layout; tablet and phone place it.
    const desktop = pageBoard(wholeRef.current, currentPage);
    const next = stackBoard(desktop, selection, uuid());
    if (next !== desktop) {
      const stack = next.stacks.at(-1);
      const members = desktop.panels.filter((panel) => stack.panelIds.includes(panel.id));
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
      setNotice("Stack created.");
    }
  };

  const manipulate = (event, id, mode) => {
    if (saveInFlight.current || nativeRefreshLock.current || !envelope) return;
    if ((event.button !== undefined && event.button !== 0) || event.isPrimary === false) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    let initial = boardRef.current;
    const initialWhole = wholeRef.current;
    const originalPage = initial.pageId;
    let unit = unitsForBoard(initial).find((item) => item.id === id);
    if (!unit) return;
    const element = event.currentTarget;
    element?.setPointerCapture?.(event.pointerId);
    let initialProjection = sizeProjection(initial, layoutSize);
    let column = (width + gap) / initialProjection.columns;
    // Dragging onto another page's tab: drop to send the widget to the end of
    // that page, or hold for a moment to open the page and place it exactly.
    let pageTarget = null;
    let pageDwell;
    let pageMoved = false;
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
    const setPageTarget = (next, point) => {
      if (next === pageTarget) return;
      clearTimeout(pageDwell);
      pageTarget = next;
      setDropPage(next);
      if (!next) return;
      pageDwell = setTimeout(() => {
        // Open the page under the pointer and carry the widget onto it.
        const moved = moveToPage(wholeRef.current, id, next);
        initial = sizeView(pageBoard(moved, next), layoutSize);
        initialProjection = sizeProjection(initial, layoutSize);
        column = (width + gap) / initialProjection.columns;
        unit = unitsForBoard(initial).find((item) => item.id === id);
        const bounds = canvas.current.getBoundingClientRect();
        const cellX = Math.floor((point.x - bounds.left) / column);
        const cellY = Math.max(0, Math.floor((point.y - bounds.top) / (ROW_HEIGHT + gap)));
        initial = moveUnit(initial, id, { ...unit.rect, x: Math.max(0, cellX), y: cellY });
        unit = unitsForBoard(initial).find((item) => item.id === id);
        initialProjection = sizeProjection(initial, layoutSize);
        commitWhole(mergeSizeView(moved, initial), undefined, { record: false, pageId: next });
        latest = initial;
        lastCell = { dx: 0, dy: 0 };
        start.x = point.x;
        start.y = point.y;
        pageMoved = true;
        pageTarget = null;
        setDropPage(null);
        showPage(next, { keepGesture: true });
      }, 700);
    };
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== start.pointerId) return;
      if (mode === "move") {
        const tab = document.elementFromPoint?.(moveEvent.clientX, moveEvent.clientY)?.closest?.("[data-page-drop]");
        const over = tab?.dataset.pageDrop;
        setPageTarget(over && over !== boardRef.current.pageId ? over : null, {
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        if (pageTarget) return;
      }
      const dx = Math.round((moveEvent.clientX - start.x) / column);
      const dy = Math.round((moveEvent.clientY - start.y) / (ROW_HEIGHT + gap));
      let rect = clampRect(
        mode === "resize"
          ? { ...unit.rect, w: unit.rect.w + dx, h: unit.rect.h + dy }
          : { ...unit.rect, x: unit.rect.x + dx, y: unit.rect.y + dy },
        initialProjection.columns,
      );
      // On a centred grid a widget near the middle snaps onto the centre line.
      const columns = initialProjection.columns;
      if (mode === "move" && columns % 2 === 1 && (columns - rect.w) % 2 === 0) {
        const middle = (columns - rect.w) / 2;
        if (Math.abs(rect.x - middle) <= 1) rect = { ...rect, x: middle };
      }
      if (!lastCell || lastCell.dx !== dx || lastCell.dy !== dy) {
        latest = mode === "move" ? moveUnit(initial, id, rect) : resizeUnit(initial, id, rect);
        lastCell = { dx, dy };
        changeBoard(latest, undefined, { record: false });
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
        const pixels = pixelRect(other.rect, width, initialProjection.columns, gap);
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
      clearTimeout(pageDwell);
      const droppedOnPage = !cancel && pageTarget;
      setDropPage(null);
      const quiet = { record: false };
      if (cancel) {
        commitWhole(initialWhole, undefined, { ...quiet, pageId: originalPage });
        if (pageMoved) showPage(originalPage, { keepGesture: true, replace: true });
      } else if (droppedOnPage) {
        commitWhole(moveToPage(initialWhole, id, droppedOnPage), undefined, { ...quiet, pageId: originalPage });
        if (pageMoved) showPage(originalPage, { keepGesture: true, replace: true });
        const name = wholeRef.current.pages?.find((page) => page.id === droppedOnPage)?.name;
        showToast(`Moved to ${name}`, true);
        setSelection([]);
      } else if (target && stackReady && performance.now() - targetTime >= 500) {
        if (target.kind === "stack") {
          changeBoard(
            {
              ...initial,
              stacks: initial.stacks.map((stack) =>
                stack.id === target.id ? { ...stack, panelIds: [...stack.panelIds, id] } : stack,
              ),
            },
            undefined,
            quiet,
          );
        } else
          changeBoard(stackBoard(pageBoard(initialWhole, initial.pageId), [target.id, id], uuid()), undefined, quiet);
        setSelection([]);
      } else changeBoard(latest, undefined, quiet);
      // One drag is one step to undo: it autosaves once, when it ends.
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
    const next = { ...unit.rect, [key]: unit.rect[key] + amount };
    changeBoard(key === "w" || key === "h" ? resizeUnit(board, id, next) : moveUnit(board, id, next));
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
  // Done waits for anything still saving, then leaves.
  const finishEditing = async () => {
    setSaving(true);
    const saved = await flushArrangement();
    setSaving(false);
    if (saved) {
      setSelection([]);
      leave();
    }
  };
  // ---- Pages ----------------------------------------------------------
  // The current page follows the address (#media), so links open a page and
  // back and forward move between pages.
  const showPage = useCallback(
    (id, { replace = false, keepGesture = false } = {}) => {
      if (!keepGesture) operation.current?.();
      setSelection([]);
      const next = pageHash(wholeRef.current || wholeBoard, id);
      if (next && window.location.hash !== next) writeHash(next, replace);
      try {
        localStorage.setItem(lastPageKey(dashboard.id), id);
      } catch {
        // Remembering the page is a convenience only.
      }
    },
    [dashboard.id, wholeBoard],
  );
  // Back and forward change page like a tab click: drop any drag and selection.
  useEffect(() => {
    const follow = () => {
      operation.current?.();
      setSelection([]);
    };
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);
  const showToast = useCallback((message, undoable = false) => {
    setToast({ message, undoable, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  // Plain functions: the key handler below re-subscribes each render.
  // Undo and redo go through the server: first anything pending saves (so it
  // is a step), then the step goes back and the board shows the result.
  const stepping = useRef(false);
  const stepHistory = async (direction) => {
    if (stepping.current || nativeRefreshLock.current) return;
    // Nothing to step (the button is greyed): a shortcut does nothing either.
    // A change still waiting to save becomes a step once it saves.
    const steps = direction === "undo" ? history.current.past : history.current.future;
    if (!steps.length && !(direction === "undo" && draftPending.current)) return;
    stepping.current = true;
    try {
      if (!(await flushArrangement())) return;
      const state = await studioRequest(`/studio/api/${direction}`, { revision: latestEnvelope.current?.revision });
      setHistory({ past: state.canUndo ? [true] : [], future: state.canRedo ? [true] : [] });
      setSelection([]);
      await savedContent(state, { stepped: true });
      showToast(direction === "undo" ? "Undone" : "Redone");
    } catch (err) {
      // No step to take is not a conflict: say so quietly, never with the
      // red "another change was saved" banner.
      if (err?.details?.code === "NOTHING_TO_UNDO" || err?.details?.code === "UNDO_UNAVAILABLE") {
        setHistory({ past: [], future: [] });
        if (err.details.code === "UNDO_UNAVAILABLE") showToast(err.message);
      } else setError(err);
    } finally {
      stepping.current = false;
    }
  };
  const undo = () => stepHistory("undo");
  const redo = () => stepHistory("redo");
  const pageActions = {
    canAdd: pages.length < MAX_PAGES,
    add: () => {
      const { board: next, pageId } = addPage(wholeRef.current, freePageName(wholeRef.current), currentPage);
      if (!pageId || !commitWhole(next, undefined, { pageId })) return null;
      showPage(pageId);
      return pageId;
    },
    rename: (id, name) => commitWhole(updatePage(wholeRef.current, id, { name })),
    move: (id, index) => {
      if (commitWhole(movePage(wholeRef.current, id, index))) showToast("Page moved", true);
    },
    icon: (page) => setModal({ type: "pageIcon", page }),
    background: (page) => setModal({ type: "pageBackground", page }),
    grid: (page, grid) => {
      if (commitWhole(setPageGrid(wholeRef.current, page.id, grid)))
        showToast(grid === "centred" ? "Centred grid: 25 columns" : "Even grid: 24 columns", true);
    },
    // Copies every widget on the page as real widgets (administrators only),
    // saved at once like any content change.
    duplicate: isAdmin
      ? async (page) => {
          if (!(await flushArrangement())) return;
          try {
            const state = await studioRequest("/studio/api/page-duplicate", {
              revision: latestEnvelope.current.revision,
              pageId: page.id,
            });
            changeSaved();
            await savedContent(state);
            showPage(state.pageId);
            showToast(
              state.skipped
                ? `Duplicated “${page.name}”. ${state.skipped} discovered widget${state.skipped === 1 ? " stays" : "s stay"} on the original page only.`
                : `Duplicated “${page.name}”`,
            );
          } catch (err) {
            setError(err);
          }
        }
      : undefined,
    copyLink: async (page) => {
      const url = `${window.location.origin}${window.location.pathname.replace(/\/edit$/, "")}${pageHash(wholeRef.current, page.id)}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
      } catch {
        setModal({ type: "pageLink", url });
      }
    },
    // Esc while naming a page just added takes it back (board 14), quietly.
    cancelAdd: (id, previous) => {
      if (pageBoard(wholeRef.current, id).panels.length) return;
      const target = pages.some((item) => item.id === previous) ? previous : pages.find((item) => item.id !== id)?.id;
      if (target && commitWhole(removePage(wholeRef.current, id, target))) showPage(target, { replace: true });
    },
    remove: (page) => {
      const units = pageBoard(wholeRef.current, page.id);
      if (!units.panels.length) {
        const target = pages.find((item) => item.id !== page.id).id;
        if (commitWhole(removePage(wholeRef.current, page.id, target))) {
          showPage(target, { replace: true });
          showToast(`Deleted “${page.name}”`, true);
        }
      } else setModal({ type: "deletePage", page });
    },
  };
  const deletePage = (page, target) => {
    if (target) {
      if (!commitWhole(removePage(wholeRef.current, page.id, target))) return;
      dismissEditor();
      showPage(target, { replace: true });
      showToast(`Deleted “${page.name}”. Its widgets moved to ${pages.find((item) => item.id === target).name}.`, true);
    }
  };
  // Discovered widgets that arrived since the arrangement was last saved
  // land on the first page; the editor asks once which page they belong on,
  // with the page being edited preselected.
  const [discoveredTarget, setDiscoveredTarget] = useState(null);
  const [discoveredHandled, setDiscoveredHandled] = useState(null);
  const newDiscovered =
    editing && discoveredHandled !== envelope?.revision
      ? (envelope?.newDiscoveredIds || []).filter((id) => wholeBoard.panels.some((panel) => panel.id === id))
      : [];
  const placeNewDiscovered = async () => {
    const target = pages.some((page) => page.id === discoveredTarget) ? discoveredTarget : currentPage;
    let next = wholeRef.current || wholeBoard;
    for (const id of newDiscovered) {
      const stack = next.stacks.find((item) => item.panelIds.includes(id));
      const unitId = stack ? stack.id : id;
      const pageId = stack ? stack.pageId : next.panels.find((panel) => panel.id === id)?.pageId;
      if (pageId !== target) next = moveToPage(next, unitId, target);
    }
    // Saved like any other move.
    if (commitWhole(next)) setDiscoveredHandled(envelope.revision);
  };
  const moveUnitsToPage = (ids, target) => {
    let next = wholeRef.current;
    for (const id of ids) next = moveToPage(next, id, target);
    if (commitWhole(next)) {
      setSelection([]);
      showToast(`Moved to ${pages.find((page) => page.id === target)?.name}`, true);
    }
  };
  const showToolsByTap = (event) => {
    if (lastPointer.current !== "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    const panel = target?.closest("[data-panel-id]");
    setToolsShown(panel && !panel.dataset.stackId ? panel.dataset.panelId : null);
  };
  // Shift-click or Ctrl-click a widget to add it to the selection or take it out.
  const selectByClick = (event) => {
    if (!(event.shiftKey || event.ctrlKey || event.metaKey) || controlsDisabled) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(".studio-select-target,.studio-resize-handle,.studio-move-handle")) return;
    const shell = target.closest("[data-stack-shell-id]");
    const panel = target.closest("[data-panel-id]");
    const id = shell?.dataset.stackShellId || panel?.dataset.stackId || panel?.dataset.panelId;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    select(id);
  };
  // Drag a box on empty space to select every widget it touches.
  const startMarquee = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || controlsDisabled || modal) return;
    if (!(event.target instanceof Element) || event.target.closest(".studio-panel,.studio-stack-shell,button,a,input"))
      return;
    // Dragging a box must not select page text on the way.
    event.preventDefault();
    window.getSelection?.()?.removeAllRanges();
    const box = canvas.current.getBoundingClientRect();
    const start = { x0: event.clientX - box.left, y0: event.clientY - box.top };
    const keep = event.shiftKey || event.ctrlKey || event.metaKey ? selection : [];
    let current = null;
    const move = (next) => {
      current = { ...start, x1: next.clientX - box.left, y1: next.clientY - box.top };
      if (Math.abs(current.x1 - current.x0) + Math.abs(current.y1 - current.y0) > 6) setMarquee(current);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setMarquee(null);
      if (!current || Math.abs(current.x1 - current.x0) + Math.abs(current.y1 - current.y0) <= 6) return;
      const area = {
        left: Math.min(current.x0, current.x1),
        top: Math.min(current.y0, current.y1),
        right: Math.max(current.x0, current.x1),
        bottom: Math.max(current.y0, current.y1),
      };
      const touched = [...geometry.entries()]
        .filter(
          ([, rect]) =>
            rect.left < area.right &&
            rect.left + rect.width > area.left &&
            rect.top < area.bottom &&
            rect.top + rect.height > area.top,
        )
        .map(([id]) => id);
      setSelection([...new Set([...keep, ...touched])]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  // Several widgets selected: the bulk bar. Stacks count as their members
  // for look and behaviour, duplicate and delete.
  const selectedPanels = () => {
    const ids = selection.flatMap((id) => wholeBoard.stacks.find((stack) => stack.id === id)?.panelIds || [id]);
    return wholeBoard.panels.filter((panel) => ids.includes(panel.id));
  };
  const bulkLook = (changes, inherited) => {
    const changed = new Map(applyChanges(selectedPanels(), changes, inherited).map((panel) => [panel.id, panel]));
    const next = {
      ...wholeRef.current,
      panels: wholeRef.current.panels.map((panel) => changed.get(panel.id) || panel),
    };
    if (commitWhole(next)) {
      dismissEditor();
      showToast(`Changed ${widgetCount(changed.size)}`, true);
    }
  };
  const bulkSize = ({ w, h }) => {
    let view = boardRef.current;
    for (const id of selection) {
      const unit = unitsForBoard(view).find((item) => item.id === id);
      if (unit) view = moveUnit(view, id, { ...unit.rect, w: w ?? unit.rect.w, h: h ?? unit.rect.h });
    }
    if (changeBoard(view)) {
      dismissEditor();
      showToast(`Resized ${widgetCount(selection.length)}`, true);
    }
  };
  // Duplicate and delete change the configuration files, so they save at once.
  const bulkContent = {
    save: async (path) => {
      if (!(await flushArrangement())) return null;
      const state = await studioRequest(path, {
        revision: latestEnvelope.current.revision,
        ids: selectedPanels().map((panel) => panel.id),
      });
      changeSaved();
      await savedContent(state);
      return state;
    },
    duplicate: async () => {
      try {
        const state = await bulkContent.save("/studio/api/widgets-duplicate");
        if (!state) return;
        setSelection(state.ids || []);
        showToast(`Duplicated ${widgetCount(state.ids?.length || 0)}`);
      } catch (err) {
        setError(err);
      }
    },
    remove: async () => {
      const count = selectedPanels().length;
      setModal({ type: "bulkDelete", pending: true });
      try {
        if (await bulkContent.save("/studio/api/widgets-delete")) showToast(`Deleted ${widgetCount(count)}`);
      } catch (err) {
        setModal({ type: "bulkDelete" });
        setError(err);
      }
    },
  };
  const runBulk = (id, event) => {
    if (id === "look") setModal({ type: "bulkLook" });
    else if (id === "size")
      movableSelection.length === 1 ? position(movableSelection[0]) : setModal({ type: "bulkSize" });
    else if (id === "page") {
      const box = event.currentTarget.getBoundingClientRect();
      setPageMenu({ x: box.left, y: box.bottom + 4, above: box.top - 4, from: event.currentTarget });
    } else if (id === "stack") createStack();
    else if (id === "duplicate") bulkContent.duplicate();
    else if (id === "delete") setModal({ type: "bulkDelete" });
  };
  const bulkActions = () => {
    const panels = selectedPanels();
    const discovered = panels.some((panel) => panel.nativeLocator?.discovered);
    return [
      panels.length > 0 && { id: "look", icon: "paint", label: "Look" },
      movableSelection.length > 0 && { id: "size", icon: "resize", label: "Size" },
      pages.length > 1 && movableSelection.length > 0 && { id: "page", icon: "move", label: "Page", menu: true },
      stackableSelection.length > 1 && { id: "stack", icon: "stack", label: "Stack" },
      isAdmin &&
        panels.length > 0 && {
          id: "duplicate",
          icon: "copy",
          label: "Duplicate",
          disabled: discovered,
          hint: discovered ? "Discovered widgets belong to their provider and can't be copied" : undefined,
        },
      isAdmin && panels.length > 0 && { id: "delete", icon: "trash", label: "Delete", danger: true },
    ];
  };

  // The widget menu (right-click or hold while editing).
  const panelHref = (panel) => {
    const resolved = resolveNativePanel(panel, renderedNativeData);
    const href = resolved?.service?.href || resolved?.bookmark?.href;
    return typeof href === "string" && /^https?:\/\//i.test(href) ? href : null;
  };
  const panelType = (panel) =>
    panel.kind === "serviceWidget" || panel.kind === "informationWidget"
      ? `${panel.kind}:${panel.nativeLocator?.type}`
      : panel.kind;
  const typeName = (panel, catalog) => {
    if (panel.kind === "service") return "link";
    if (panel.kind === "bookmark") return "bookmark";
    const list = catalog?.[panel.kind === "serviceWidget" ? "service" : "info"];
    return list?.find((entry) => entry.type === panel.nativeLocator?.type)?.name || panel.nativeLocator?.type || "such";
  };
  const copyLook = (panel) => {
    const look = panel.look || {};
    setLookClipboard(look);
    try {
      localStorage.setItem(LOOK_CLIPBOARD, JSON.stringify(look));
    } catch {
      // Without storage the copy still lasts while this page is open.
    }
    showToast(Object.keys(look).length ? "Look copied" : "Look copied (the default look)");
  };
  const applyLook = (ids, look, message) => {
    const targets = new Set(ids);
    const next = {
      ...wholeRef.current,
      panels: wholeRef.current.panels.map((item) => {
        if (!targets.has(item.id)) return item;
        const { look: _old, ...rest } = item;
        return look && Object.keys(look).length ? { ...rest, look: structuredClone(look) } : rest;
      }),
    };
    if (commitWhole(next)) showToast(message, true);
  };
  // One widget is deleted at once, with Undo right there (board 21); the
  // whole entry goes, since its card was its only card. Several still ask.
  const deletePanel = async (panel) => {
    if (!isAdmin || nativeRefreshLock.current) return;
    if (savePending() && !(await flushArrangement())) return;
    try {
      const state = await studioRequest("/studio/api/widgets-delete", {
        revision: latestEnvelope.current.revision,
        ids: [panel.id],
      });
      await savedContent(state, { quiet: true });
      showToast(`${panel.title} ${panel.nativeLocator?.discovered ? "hidden" : "deleted"}`, true);
    } catch (err) {
      setError(err);
    }
  };
  // Asks the integrations behind these widgets for fresh numbers now.
  const refreshNow = (ids, page = false) => {
    const count = refreshCards(ids);
    showToast(
      count
        ? page
          ? `Refreshing ${count} widget${count === 1 ? "" : "s"} on this page`
          : "Refreshing"
        : "Nothing here updates on its own",
    );
  };
  const openUnitMenu = async (id, pointer, from) => {
    // Docked, the board beside the editor keeps its widget menu (review R2).
    if (controlsDisabled || (modal && !docked) || saveInFlight.current || nativeRefreshLock.current) return;
    const element = canvas.current?.querySelector(
      `[data-panel-id="${CSS.escape(id)}"]:not([aria-hidden]), [data-stack-shell-id="${CSS.escape(id)}"]`,
    );
    const box = element?.getBoundingClientRect();
    const x = pointer?.clientX ?? (box ? box.left + 16 : 16);
    const y = pointer?.clientY ?? (box ? box.top + 16 : 16);
    const menu = { id, x, y, from: from || document.activeElement };
    // Only for naming the widget type in "Use this look on every … widget".
    const catalog = await loadCatalog().catch(() => null);
    setUnitMenu({ ...menu, items: unitMenuItems(id, menu, catalog) });
  };
  const unitMenuItems = (id, menu, catalog) => {
    // With the editor docked, an action that opens another editor asks
    // about its unsaved changes first; the widget being edited keeps its
    // look and its Delete in the editor, so they aren't offered twice.
    const guarded = (action) => () => (modal ? requestEditorAction(action) : action());
    const beingEdited = docked && modal?.panel?.id === id;
    const panel = wholeBoard.panels.find((item) => item.id === id);
    const stack = wholeBoard.stacks.find((item) => item.id === id);
    const otherPages = pages.filter((page) => page.id !== currentPage);
    const moveItem = otherPages.length > 0 && {
      id: "move",
      icon: "move",
      label: "Move to page…",
      keepFocus: true,
      onSelect: () => setUnitMenu({ ...menu, pages: true }),
    };
    // Centred grid (board 23): the middle of its row, on desktop.
    const centreItem = layoutSize === "desktop" &&
      gridColumns(boardRef.current) % 2 === 1 && {
        id: "centre",
        icon: "grid",
        label: "Centre in row",
        onSelect: () => {
          const next = centreInRow(boardRef.current, id);
          if (!next) showToast("Its row has no free space in the middle.", false);
          else if (next !== boardRef.current) changeBoard(next);
        },
      };
    if (stack)
      return [
        { id: "edit", icon: "edit", label: "Edit stack", onSelect: guarded(() => editStack(stack)) },
        centreItem,
        moveItem,
      ];
    if (!panel) return [];
    const discovered = Boolean(panel.nativeLocator?.discovered);
    const canChange = isAdmin && !discovered;
    const sameType = wholeBoard.panels.filter((item) => panelType(item) === panelType(panel));
    const href = panelHref(panel);
    const hasClipboard = lookClipboard !== null;
    return [
      (isAdmin || discovered) && {
        id: "edit",
        icon: "edit",
        label: discovered ? "Show or hide" : "Edit",
        shortcut: "E",
        onSelect: () => editPanel(panel),
      },
      canChange && {
        id: "duplicate",
        icon: "copy",
        label: "Duplicate",
        shortcut: "Ctrl D",
        onSelect: guarded(() => openEditor("content", { panel, duplicate: true })),
      },
      "-",
      { id: "copy-look", icon: "paint", label: "Copy look", shortcut: "Ctrl Alt C", onSelect: () => copyLook(panel) },
      {
        id: "paste-look",
        label: "Paste look",
        shortcut: "Ctrl Alt V",
        disabled: !hasClipboard,
        hint: hasClipboard ? undefined : "Copy a widget's look first",
        onSelect: () => applyLook([panel.id], lookClipboard, "Look pasted"),
      },
      sameType.length > 1 && {
        id: "look-everywhere",
        icon: "grid",
        label: `Use this look on every ${typeName(panel, catalog)} widget`,
        onSelect: () =>
          applyLook(
            sameType.map((item) => item.id),
            panel.look || {},
            `Look used on ${sameType.length} ${typeName(panel, catalog)} widget${sameType.length === 1 ? "" : "s"}`,
          ),
      },
      "-",
      CHART_SHOWS.includes(resolvedLook(settings, panel).show) && {
        id: "full-view",
        icon: "expand",
        label: "Open full view",
        shortcut: "Space",
        onSelect: () => setFullView(panel),
      },
      canRefresh(panel.id) && {
        id: "refresh",
        icon: "refresh",
        label: "Refresh now",
        shortcut: "R",
        onSelect: () => refreshNow([panel.id]),
      },
      centreItem,
      moveItem,
      href && {
        id: "open",
        icon: "external",
        label: "Open link",
        onSelect: () => window.open(href, "_blank", "noopener,noreferrer"),
      },
      canChange && "-",
      canChange && {
        id: "delete",
        icon: "trash",
        label: "Delete",
        shortcut: "Del",
        danger: true,
        onSelect: () => deletePanel(panel),
      },
    ]
      .filter(Boolean)
      .filter(
        (item) =>
          !(beingEdited && ["edit", "copy-look", "paste-look", "delete"].includes(item.id)) &&
          !(docked && item.id === "look-everywhere"),
      )
      .filter((item, index, list) => item !== "-" || (index > 0 && index < list.length - 1 && list[index - 1] !== "-"));
  };
  // Widget keys while editing act on the one selected widget, or the
  // focused one: E edits, Delete deletes, Ctrl D duplicates, Ctrl Alt C and
  // V copy and paste its look, and the menu key opens its menu.
  useEffect(() => {
    if (!editing) return undefined;
    const key = (event) => {
      if (event.defaultPrevented || typing(event.target) || modal || overlayOpen || unitMenu) return;
      // Ctrl A selects everything on the page; Esc lets go of the selection.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(unitsForBoard(board).map((unit) => unit.id));
        return;
      }
      if (event.key === "Escape" && selection.length && !moving) {
        event.preventDefault();
        setSelection([]);
        return;
      }
      const focusedId = document.activeElement?.closest?.("[data-panel-id]")?.dataset.panelId;
      const id = selection.length === 1 ? selection[0] : selection.length === 0 ? focusedId : null;
      if (!id) return;
      const panel = wholeBoard.panels.find((item) => item.id === id);
      const command = event.ctrlKey || event.metaKey;
      const lower = event.key.toLowerCase();
      const run = (action) => {
        event.preventDefault();
        action();
      };
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        return run(() => openUnitMenu(id, null, document.activeElement));
      if (!panel) return;
      const canChange = isAdmin && !panel.nativeLocator?.discovered;
      if (command && event.altKey && event.code === "KeyC") return run(() => copyLook(panel));
      if (command && event.altKey && event.code === "KeyV" && lookClipboard !== null)
        return run(() => applyLook([panel.id], lookClipboard, "Look pasted"));
      if (event.altKey) return;
      if (command && lower === "d" && canChange) return run(() => openEditor("content", { panel, duplicate: true }));
      if (command || event.shiftKey) return;
      if (lower === "e" && (isAdmin || panel.nativeLocator?.discovered)) return run(() => editPanel(panel));
      if (lower === "r" && canRefresh(panel.id)) return run(() => refreshNow([panel.id]));
      if (event.key === " " && CHART_SHOWS.includes(resolvedLook(settings, panel).show))
        return run(() => setFullView(panel));
      if ((event.key === "Delete" || event.key === "Backspace") && canChange) return run(() => deletePanel(panel));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Page keys: 1-9 jump to a page, [ and ] step. Editing adds undo and redo.
  useEffect(() => {
    const key = (event) => {
      if (event.defaultPrevented || typing(event.target) || modal || overlayOpen) return;
      const command = event.ctrlKey || event.metaKey;
      if (editing && command && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      // Save and keep editing.
      if (editing && command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!controlsDisabled) flushArrangement();
        return;
      }
      if (editing && command && !event.altKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.shiftKey && !command && !event.altKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        refreshNow(
          board.panels.map((panel) => panel.id),
          true,
        );
        return;
      }
      if (event.key === "?" && !command && !event.altKey) {
        event.preventDefault();
        setModal({ type: "shortcuts" });
        return;
      }
      if (command || event.altKey || pages.length < 2) return;
      const index = pages.findIndex((page) => page.id === currentPage);
      let target = null;
      if (/^[1-9]$/.test(event.key)) target = pages[Number(event.key) - 1];
      else if (event.key === "[") target = pages[index - 1];
      else if (event.key === "]") target = pages[index + 1];
      else return;
      // Claimed even without a target, so typing "9" on a three-page
      // dashboard doesn't open search instead.
      event.preventDefault();
      if (target) showPage(target.id);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  // On phones, a sideways swipe on the dashboard's empty space changes page.
  useEffect(() => {
    const element = canvas.current;
    if (!element || pages.length < 2 || editing) return undefined;
    let start = null;
    const down = (event) => {
      if (event.pointerType !== "touch" || event.target.closest?.(".studio-panel, .studio-stack-shell")) return;
      start = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const up = (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const quick = performance.now() - start.time < 600;
      start = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const index = pages.findIndex((page) => page.id === currentPage);
      const target = pages[index + (dx < 0 ? 1 : -1)];
      if (target) showPage(target.id);
    };
    const cancel = () => {
      start = null;
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
    };
  }, [pages, currentPage, editing, showPage]);

  const stackedIds = new Set(board.stacks.flatMap((stack) => stack.panelIds));
  const movableSelection = selection.filter((id) => unitsForBoard(board).some((unit) => unit.id === id));
  const stackableSelection = selection.filter(
    (id) => board.panels.some((panel) => panel.id === id) && !stackedIds.has(id),
  );
  const selectedCount = selection.length ? selectedPanels().length : 0;
  const modalTitles = {
    picker: "Add to your dashboard",
    saved: "Add a saved widget",
    content: modal?.panel ? `Edit ${modal.panel.title}` : modal?.entry?.name || "Configure content",
    settings: "Dashboard settings",
    appearance: "Appearance",
    files: "Configuration files",
    connections: "Saved connections",
    images: "Images",
    backups: "Snapshots & restore",
    stack: "Edit widget stack",
    position: "Position & size",
    discovery: modal?.panel?.title || "Discovered content",
    deletePage: modal?.page ? `Delete “${modal.page.name}”?` : "Delete page?",
    pageIcon: modal?.page ? `${modal.page.name}: icon` : "Page icon",
    pageBackground: modal?.page ? `${modal.page.name}: background` : "Page background",
    pageLink: "Link to page",
    shortcuts: "Keyboard shortcuts",
    moveHere: "Move widgets here",
    bulkLook: `Look for ${selection.length} selected`,
    bulkSize: "Size",
    bulkDelete: `Delete ${widgetCount(selectedCount)}?`,
  };

  return (
    <main
      className={`studio-app${editing ? " studio-edit-mode" : ""}${editing && selection.length ? " studio-has-bulk" : ""}${docked ? " studio-docked-editing" : ""}`}
      data-glass={(pageBackground && settings?.studioTheme?.glass) || undefined}
      style={Object.fromEntries(
        Object.entries(statusColours(settings)).map(([key, colour]) => [`--studio-status-${key}`, colour]),
      )}
      aria-busy={saving || refreshing || undefined}
    >
      {pageBackground && <CardBackground className="studio-page-bg" background={pageBackground} tokens={cardTheme} />}
      {/* Without a title of its own in settings.yaml, the browser tab shows the
          dashboard's name, as the top bar does. */}
      {!settings?.title && access?.dashboard?.name && (
        <Head>
          <title>{access.dashboard.name}</title>
        </Head>
      )}
      <StudioTopBar
        title={access?.dashboard?.name || settings?.title || "Dashboard"}
        dashboardId={access?.dashboard?.id}
        logo={access?.dashboard?.logo ? dashboardPath(`/studio/logo?v=${access.dashboard.logo.version}`) : undefined}
        access={access}
        onSearch={editing ? undefined : onSearch}
        searchDisabled={controlsDisabled}
      >
        <PageTabs
          editing={editing}
          board={wholeBoard}
          pages={pages}
          currentId={currentPage}
          onSelect={(id) => showPage(id)}
          disabled={controlsDisabled}
          dropTarget={dropPage}
          actions={pageActions}
        />
      </StudioTopBar>
      <ErrorMessage
        arrangement
        error={error || loadError}
        heading={!error && loadError ? "The dashboard could not refresh" : undefined}
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
      {/* Editing (board 14): one light row. The dashboard's name is already in
          the top bar; every tool stays, the ones a phone can't use step aside. */}
      {editing && (
        <div className="studio-board-toolbar studio-edit-bar" role="toolbar" aria-label="Editing">
          <span className="studio-editing-pill">Editing</span>
          {canArrange && (
            <button
              className="studio-button studio-quiet"
              disabled={controlsDisabled}
              aria-label={isAdmin ? "Widgets" : "Saved widgets"}
              onClick={() => openEditor(isAdmin ? "picker" : "saved")}
            >
              <StudioIcon name="plus" size={16} />
              <span className="studio-edit-bar-label studio-edit-bar-label-kept">
                {isAdmin ? "Widgets" : "Saved widgets"}
              </span>
            </button>
          )}
          <button
            className="studio-button studio-quiet"
            disabled={controlsDisabled || tidyBoard(board) === board}
            title="Close the gaps on this page. Each widget slides straight up."
            onClick={() => {
              if (changeBoard(tidyBoard(boardRef.current))) showToast("Tidied up", true);
            }}
          >
            <StudioIcon name="grid" size={16} />
            <span className="studio-edit-bar-label">Tidy up</span>
          </button>
          {sizeSwitchShown && (
            <SizeSwitch
              size={layoutSize}
              disabled={moving !== null}
              onChange={(next) => setEditSize(next === "desktop" ? null : next)}
            />
          )}
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Undo"
            aria-keyshortcuts="Control+Z Meta+Z"
            title="Undo (Ctrl / ⌘ Z)"
            disabled={controlsDisabled || !historyCounts.past}
            onClick={undo}
          >
            <StudioIcon name="undo" size={17} />
          </button>
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Redo"
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
            title="Redo (Ctrl / ⌘ Shift Z)"
            disabled={controlsDisabled || !historyCounts.future}
            onClick={redo}
          >
            <StudioIcon name="redo" size={17} />
          </button>
          <span className="studio-toolbar-spacer" />
          <SaveStatus state={saveState} pending={dirty} />
          <button
            type="button"
            className="studio-icon-button studio-shortcuts-button"
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="Shift+?"
            title="Keyboard shortcuts (?)"
            onClick={() => setModal({ type: "shortcuts" })}
          >
            <StudioIcon name="keyboard" size={17} />
          </button>
          {/* Everything saves as you go; Done waits for the last save and leaves. */}
          <span className="studio-edit-bar-actions">
            <button className="studio-button studio-primary" disabled={controlsDisabled} onClick={finishEditing}>
              <StudioIcon name="check" size={16} />
              {saving ? "Saving…" : "Done"}
            </button>
          </span>
          {unitMenu && (
            <Menu
              key={unitMenu.pages ? "pages" : "actions"}
              anchor={unitMenu}
              label={unitMenu.pages ? "Move to page" : "Widget actions"}
              returnFocus={unitMenu.from}
              onClose={() => setUnitMenu((menu) => (menu?.pages === unitMenu.pages ? null : menu))}
              items={
                unitMenu.pages
                  ? pages
                      .filter((page) => page.id !== currentPage)
                      .map((page) => ({
                        id: page.id,
                        label: page.name,
                        onSelect: () => moveUnitsToPage([unitMenu.id], page.id),
                      }))
                  : unitMenu.items
              }
            />
          )}
          {pageMenu && (
            <Menu
              anchor={pageMenu}
              label="Move to page"
              returnFocus={pageMenu.from}
              onClose={() => setPageMenu(null)}
              items={pages
                .filter((page) => page.id !== currentPage)
                .map((page) => ({
                  id: page.id,
                  label: page.name,
                  onSelect: () => moveUnitsToPage(movableSelection, page.id),
                }))}
            />
          )}
        </div>
      )}
      {editing && selection.length > 0 && (
        <div className="studio-bulk-bar" role="toolbar" aria-label={`${selection.length} selected`}>
          <span className="studio-bulk-count">{selection.length} selected</span>
          {bulkActions()
            .filter(Boolean)
            .map((action) => (
              <button
                key={action.id}
                type="button"
                className={`studio-button studio-quiet${action.danger ? " studio-bulk-danger" : ""}`}
                disabled={controlsDisabled || action.disabled}
                title={action.hint}
                aria-haspopup={action.menu ? "menu" : undefined}
                onClick={(event) => runBulk(action.id, event)}
              >
                <StudioIcon name={action.icon} size={16} />
                {action.label}
              </button>
            ))}
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            onClick={() => setSelection([])}
          >
            <StudioIcon name="close" size={16} />
          </button>
        </div>
      )}
      {newDiscovered.length > 0 && (
        <div className="studio-discovered-note" role="group" aria-label="Newly discovered widgets">
          <span>
            {newDiscovered.length === 1
              ? "A new widget was discovered."
              : `${newDiscovered.length} new widgets were discovered.`}
          </span>
          {pages.length > 1 && (
            <label className="studio-discovered-page">
              Put {newDiscovered.length === 1 ? "it" : "them"} on
              <select
                value={pages.some((page) => page.id === discoveredTarget) ? discoveredTarget : currentPage}
                onChange={(event) => setDiscoveredTarget(event.target.value)}
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="studio-button" disabled={controlsDisabled} onClick={placeNewDiscovered}>
            {pages.length < 2 ? "OK" : newDiscovered.length === 1 ? "Put it there" : "Put them there"}
          </button>
        </div>
      )}
      {editing && (
        <SizeStatus
          size={layoutSize}
          follows={followsDesktop(wholeBoard, layoutSize)}
          disabled={controlsDisabled}
          onFollow={() => {
            if (commitWhole(followDesktop(wholeRef.current, layoutSize)))
              showToast(`The ${layoutSize} layout follows desktop again`, true);
          }}
        />
      )}
      {editing && sizeSwitchShown && editSize && (
        <div className="studio-size-previews" aria-label="Other sizes">
          {["desktop", "tablet", "phone"]
            .filter((size) => size !== layoutSize)
            .map((size) => (
              <SizePreview
                key={size}
                view={pageBoard(wholeBoard, currentPage)}
                size={size}
                titles={unitTitles}
                onChoose={() => setEditSize(size === "desktop" ? null : size)}
              />
            ))}
        </div>
      )}
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
        onClickCapture={
          editing
            ? (event) => {
                showToolsByTap(event);
                selectByClick(event);
              }
            : undefined
        }
        onPointerDownCapture={(event) => {
          lastPointer.current = event.pointerType;
        }}
        onPointerDown={editing ? startMarquee : undefined}
        style={{
          ...(editing && editSize ? { maxWidth: SIZE_WIDTH[editSize], marginInline: "auto" } : {}),
          height: board.panels.length ? projection.rows * (ROW_HEIGHT + gap) + 32 : 480,
          "--studio-grid-column": `${(width + gap) / projection.columns}px`,
          "--studio-grid-row": `${ROW_HEIGHT + gap}px`,
        }}
      >
        {moving && projection.columns % 2 === 1 && (
          <div className="studio-centre-guide" aria-hidden="true" style={{ left: width / 2 }} />
        )}
        {moving &&
          snapGuides(geometry, moving).map((line) => (
            <div
              key={`${line.vertical ? "v" : "h"}${line.at}`}
              className="studio-snap-guide"
              aria-hidden="true"
              style={
                line.vertical
                  ? { left: line.at - 0.5, top: line.from, width: 1, height: line.to - line.from }
                  : { top: line.at - 0.5, left: line.from, height: 1, width: line.to - line.from }
              }
            />
          ))}
        {marquee && (
          <div
            className="studio-marquee"
            aria-hidden="true"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {!board.panels.length && wholeBoard.panels.length > 0 && (
          <div className="studio-empty studio-empty-page">
            <span className="studio-empty-icon">
              <StudioIcon name="layout" size={32} />
            </span>
            <h2>Nothing here yet</h2>
            {editing ? (
              <div className="studio-inline-actions">
                {isAdmin && (
                  <button
                    className="studio-button studio-primary"
                    disabled={controlsDisabled}
                    onClick={() => openEditor("picker")}
                  >
                    <StudioIcon name="plus" size={17} />
                    Add widget
                  </button>
                )}
                <button
                  className="studio-button"
                  disabled={controlsDisabled}
                  onClick={() => setModal({ type: "moveHere" })}
                >
                  <StudioIcon name="move" size={17} />
                  Move widgets here
                </button>
              </div>
            ) : (
              <p>This page has no widgets.</p>
            )}
          </div>
        )}
        {/* Until the board arrives there is nothing to say about it being empty. */}
        {!envelope && !loadError && (
          <div className="studio-empty studio-loading" role="status">
            <h2>Opening your dashboard…</h2>
          </div>
        )}
        {envelope && !wholeBoard.panels.length && (
          <div className="studio-empty">
            <span className="studio-empty-icon">
              <StudioIcon name="layout" size={32} />
            </span>
            <p className="studio-eyebrow">A clean slate</p>
            <h2>Make room for what matters.</h2>
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
              }}
            />
          ))}
        </div>
        <PanelLayer
          offLayout={offLayout}
          liveDraft={docked ? liveDraft : null}
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
          onFullView={editing ? undefined : setFullView}
          canEdit={(panel) => isAdmin || Boolean(panel.nativeLocator?.discovered)}
          onSelect={select}
          onManipulate={manipulate}
          onUnitKey={unitKey}
          onLongPress={editing ? openUnitMenu : undefined}
          overlayOpen={overlayOpen}
          toolsShown={editing ? toolsShown : null}
        />
        <div className="studio-stack-layer">
          {board.stacks.map((stack) => (
            <StackShell
              key={stack.id}
              stack={stack}
              panels={board.panels}
              rect={geometry.get(stack.id)}
              editing={editing || Boolean(modal)}
              selected={selection.includes(stack.id)}
              onSelect={select}
              busy={controlsDisabled}
              overlayOpen={overlayOpen}
              reducedMotion={reducedMotion}
              onActive={onActive}
              registerController={registerController}
              onEdit={editStack}
              onLongPress={editing ? openUnitMenu : undefined}
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
      {fullView && (
        <FullViewHost
          panel={fullView}
          data={renderedNativeData}
          settings={settings}
          onClose={() => setFullView(null)}
        />
      )}
      {search?.open && !editing && (
        <StudioSearch
          board={wholeBoard}
          data={renderedNativeData}
          query={search.query}
          onQuery={search.onQuery}
          onClose={search.onClose}
          onShowPanel={(item) => {
            showPage(item.pageId);
            // Once the page shows, bring the widget into view and point it out.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const element = document.querySelector(`[data-panel-id="${CSS.escape(item.id)}"]`);
                if (!element) return;
                element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
                // A data attribute, so a re-render of the card's classes keeps it.
                delete element.dataset.found;
                void element.offsetWidth;
                element.dataset.found = "true";
                setTimeout(() => delete element.dataset.found, 1700);
              }),
            );
          }}
        />
      )}
      {toast && (
        <div className="studio-toast" role="status" key={toast.key}>
          <span>{toast.message}</span>
          {toast.undoable && editing && historyCounts.past > 0 && (
            <button
              type="button"
              className="studio-text-button"
              onClick={() => {
                setToast(null);
                undo();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {modal && (
        <StudioDialog
          docked={docked}
          title={modalTitles[modal.type]}
          onClose={closeModal}
          onBack={
            modal.type === "content" && modal.back
              ? () => requestEditorAction(() => setModal({ type: "picker", initial: modal.back }))
              : undefined
          }
          wide={modal.type === "files" || modal.type === "picker" || modal.type === "settings"}
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
              {modal.type === "deletePage" ? (
                <DeletePageDialog
                  page={modal.page}
                  pages={pages}
                  count={{
                    widgets: pageBoard(wholeBoard, modal.page.id).panels.length,
                    stacks: pageBoard(wholeBoard, modal.page.id).stacks.length,
                  }}
                  canDeleteWidgets={isAdmin}
                  deleteBlocked={false}
                  onMove={(target) => deletePage(modal.page, target)}
                  onDeleteAll={async () => {
                    if (!(await flushArrangement())) return;
                    const state = await studioRequest("/studio/api/page-delete", {
                      revision: latestEnvelope.current.revision,
                      pageId: modal.page.id,
                    });
                    changeSaved();
                    showPage(state.board.pages[0].id, { replace: true });
                    await savedContent(state);
                    showToast(`Deleted “${modal.page.name}” and its widgets`);
                  }}
                  onClose={closeModal}
                />
              ) : modal.type === "pageIcon" ? (
                <PageIconEditor
                  page={modal.page}
                  onApply={(icon) => {
                    if (commitWhole(updatePage(wholeRef.current, modal.page.id, { icon }))) dismissEditor();
                  }}
                  onClose={closeModal}
                />
              ) : modal.type === "pageBackground" ? (
                <PageBackgroundEditor
                  page={modal.page}
                  dashboardBackground={dashboardPageBackground}
                  tokens={cardTheme}
                  onApply={(background) => {
                    if (commitWhole(updatePage(wholeRef.current, modal.page.id, { background }))) dismissEditor();
                  }}
                  onClose={closeModal}
                />
              ) : modal.type === "pageLink" ? (
                <div className="studio-dialog-body">
                  <p className="studio-note">Copying isn’t available here. Select the address and copy it yourself.</p>
                  <input
                    className="studio-link-field"
                    readOnly
                    value={modal.url}
                    onFocus={(event) => event.target.select()}
                  />
                </div>
              ) : modal.type === "moveHere" ? (
                <MoveHereDialog
                  board={wholeBoard}
                  pageId={currentPage}
                  onMove={(ids) => {
                    moveUnitsToPage(ids, currentPage);
                    dismissEditor();
                  }}
                  onClose={closeModal}
                />
              ) : modal.type === "bulkLook" ? (
                <BulkLookEditor
                  panels={selectedPanels()}
                  savedLooks={wholeBoard.looks}
                  onApply={bulkLook}
                  onCancel={closeModal}
                />
              ) : modal.type === "bulkSize" ? (
                <BulkSizeEditor
                  units={unitsForBoard(board).filter((unit) => selection.includes(unit.id))}
                  onApply={bulkSize}
                  onCancel={closeModal}
                />
              ) : modal.type === "bulkDelete" ? (
                <DeleteWidgetsConfirm
                  count={selectedCount}
                  discovered={selectedPanels().filter((panel) => panel.nativeLocator?.discovered).length}
                  pending={Boolean(modal.pending)}
                  onDelete={bulkContent.remove}
                  onCancel={closeModal}
                />
              ) : modal.type === "shortcuts" ? (
                <ShortcutsSheet editing={editing} pages={pages.length > 1} />
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
              ) : modal.type === "picker" || modal.type === "saved" ? (
                <ContentPicker
                  savedOnly={modal.type === "saved"}
                  catalog={editorData.catalog}
                  state={editorData.state}
                  onRestore={async (id) => {
                    try {
                      await savedContent(
                        await studioRequest("/studio/api/discovery-visibility", {
                          revision: editorData.state.revision,
                          id,
                          hidden: false,
                          pageId: currentPage,
                        }),
                      );
                    } catch (err) {
                      setEditorError(err);
                    }
                  }}
                  initial={modal.initial}
                  // Choosing one opens its dialog with Back to this list, the
                  // search kept (board 26).
                  onChoose={(entry, back) => setModal({ type: "content", entry, back })}
                  onPlace={async (entry) =>
                    savedContent(
                      await studioRequest("/studio/api/library/use", {
                        scope: entry.scope,
                        id: entry.id,
                        revision: editorData.state.revision,
                        pageId: currentPage,
                      }),
                    )
                  }
                />
              ) : modal.type === "content" ? (
                <ContentEditor
                  key={modal.panel?.id || `${modal.entry?.kind}:${modal.entry?.type}`}
                  {...editorData}
                  panel={modal.panel}
                  entry={modal.entry}
                  startDeleting={Boolean(modal.deleting)}
                  pageId={currentPage}
                  wholeBoard={wholeBoard}
                  renderPreview={(panel, override, extra) => (
                    <CardPreview
                      panel={panel}
                      data={renderedNativeData}
                      override={override}
                      // The desktop grid the widget sits on, as wide as it is
                      // shown when editing on a desktop screen.
                      grid={{
                        width: layoutSize === "desktop" ? width : 1200,
                        gap,
                        columns: columnsOfPage(pages.find((item) => item.id === currentPage)),
                      }}
                    >
                      {extra}
                    </CardPreview>
                  )}
                  onSaved={savedContent}
                  onCancel={closeModal}
                  onReload={reloadEditor}
                  docked={docked}
                  onLiveDraft={docked ? setLiveDraft : undefined}
                  beforeSave={
                    docked
                      ? async () => ((await flushArrangement()) ? latestEnvelope.current?.revision : null)
                      : undefined
                  }
                  onDuplicate={(entry) => requestEditorAction(() => setModal({ type: "content", entry }))}
                  onDelete={
                    isAdmin
                      ? (panel) => {
                          closeModal();
                          deletePanel(panel);
                        }
                      : undefined
                  }
                />
              ) : modal.type === "appearance" ? (
                <AppearanceOnlyEditor
                  {...editorData}
                  logo={access?.dashboard?.logo ?? null}
                  name={access?.dashboard?.name}
                  onLogoChange={() => mutateAccess()}
                  onSaved={savedContent}
                  onClose={closeModal}
                  onReload={reloadEditor}
                />
              ) : modal.type === "settings" ? (
                <SettingsEditor
                  {...editorData}
                  pageCount={pages.length}
                  hasCharts={wholeBoard.panels.some((panel) => needsHistory(resolvedLook(settings, panel)))}
                  logo={access?.dashboard?.logo ?? null}
                  name={access?.dashboard?.name}
                  onLogoChange={() => mutateAccess()}
                  onSaved={savedContent}
                  onClose={closeModal}
                  onOpenFiles={() => requestEditorAction(() => setModal({ type: "files" }))}
                  onOpenBackups={() => requestEditorAction(() => openEditor("backups"))}
                  onOpenConnections={() => requestEditorAction(() => setModal({ type: "connections" }))}
                  onOpenImages={() => requestEditorAction(() => setModal({ type: "images" }))}
                  onReload={reloadEditor}
                />
              ) : modal.type === "images" ? (
                <ImagesEditor onClose={closeModal} />
              ) : modal.type === "connections" ? (
                <ConnectionsEditor onClose={closeModal} />
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
