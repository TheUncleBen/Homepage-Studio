import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { cardFits, resolvedBehaviour, resolvedLook, useCardFit, widgetFields } from "./card-look";
import ConfigForm, { LINK_FIELDS, SERVICE_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import { isFiller } from "./fillers";
import {
  gridColumns,
  mergePage,
  moveToPage,
  pageBoard,
  pageOf,
  pagesOf,
  resizeUnit,
  ROW_HEIGHT,
  unitMinimum,
} from "./geometry.mjs";
import Guide from "./guide";
import { loadIndex } from "./icon-chooser";
import { builtInIconUrl } from "./icon-source.mjs";
import StudioIcon from "./icons";
import { SCOPE_LABEL, useLibrary } from "./library";
import LookEditor, { contentOnly, lookOnly, lookSections, sameLook, valuesPartShown } from "./look-editor";
import Menu from "./menu";
import { patchFromDraft, sourceForPanel } from "./native-adapter.mjs";
import ShowEditor, { LimitNote } from "./show-editor";
import { ActionRow, Disclosure, Group, revealForm, Row, Section, Segmented } from "./ui";

import { SettingsContext } from "utils/contexts/settings";

// A Custom API widget renders only its mappings, so without any it shows an
// empty native panel. This is valid YAML, so the editor hints instead of
// blocking the save.
export function customApiMappingsMissing(type, config) {
  if (type !== "customapi") return false;
  const mappings = config?.mappings;
  if (mappings === undefined || mappings === null || mappings === "") return true;
  if (Array.isArray(mappings)) return mappings.length === 0;
  return typeof mappings === "object" && Object.keys(mappings).length === 0;
}

// The preview's corner: drag it, or use the arrow keys on it, to change the
// widget's size in grid steps, never below its smallest size.
export function ResizeCorner({ rect, minimum, columns, onChange, describedBy, fitId }) {
  // Mock-ups v4: it also stops at the smallest size the widget's settings
  // allow. The preview says, each time it fits itself, when they no longer
  // fit; the size then goes back to the last one that did.
  const current = useRef(rect);
  useLayoutEffect(() => {
    current.current = rect;
  }, [rect]);
  const good = useRef(rect);
  useEffect(() => {
    if (!fitId || typeof window === "undefined") return undefined;
    const check = (event) => {
      if (event.detail?.id !== fitId) return;
      const fit = cardFits.get(fitId);
      const now = current.current;
      if (!fit || !now) return;
      if (!(fit.squeezed || fit.relaxed || !fit.fits)) {
        good.current = now;
        return;
      }
      const last = good.current;
      if (now.w >= last.w && now.h >= last.h) return;
      const w = Math.max(now.w, last.w);
      const h = Math.max(now.h, last.h);
      onChange((value) => ({ ...value, w, h }));
      window.dispatchEvent(
        new CustomEvent("studio-card-limit", { detail: { id: fitId.replace(/^preview:/, ""), w, h } }),
      );
    };
    window.addEventListener("studio-card-fit", check);
    return () => window.removeEventListener("studio-card-fit", check);
  }, [fitId, onChange]);
  const clamp = (w, h) => ({
    w: Math.max(Math.min(minimum.w, columns), Math.min(columns, w)),
    h: Math.max(minimum.h, Math.min(200, h)),
  });
  const start = (event) => {
    const card = event.currentTarget.closest(".studio-card-preview");
    if (!card) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // One grid step in pixels, read from the card as drawn.
    const box = card.getBoundingClientRect();
    const stepX = box.width / rect.w || 40;
    const stepY = box.height / rect.h || ROW_HEIGHT;
    // The pointer's start, kept apart from the widget's grid place.
    const from = { pointerX: event.clientX, pointerY: event.clientY, w: rect.w, h: rect.h };
    const move = (moveEvent) => {
      const next = clamp(
        from.w + Math.round((moveEvent.clientX - from.pointerX) / stepX),
        from.h + Math.round((moveEvent.clientY - from.pointerY) / stepY),
      );
      onChange((current) => (current.w === next.w && current.h === next.h ? current : { ...current, ...next }));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const key = (event) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    onChange((current) => ({ ...current, ...clamp(current.w + step[0], current.h + step[1]) }));
  };
  return (
    <button
      type="button"
      className="studio-preview-resize"
      aria-label={`Resize: ${rect.w} columns wide, ${rect.h} rows tall. Arrow keys change it.`}
      aria-describedby={describedBy}
      onPointerDown={start}
      onKeyDown={key}
    >
      <StudioIcon name="resize" size={14} />
    </button>
  );
}

// Save as a saved widget (board 26): its configuration, look and the saved
// connections it uses, never its size or place, for Just me, This dashboard
// or Everyone. The server reads the widget as last saved, so its keys never
// pass through the browser.
function SaveAsWidget({ library, defaultName, panelId, changed, onDone }) {
  const [name, setName] = useState(defaultName);
  const [scope, setScope] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const id = useId();
  const box = useRef(null);
  const scopes = library.scopes;
  const chosen = scope ?? (scopes.includes("dashboard") ? "dashboard" : scopes[0]);
  // The form opens under the actions, often below the fold: bring it into
  // view and start in its name.
  useEffect(() => {
    if (library.loaded) revealForm(box.current);
  }, [library.loaded]);
  if (!library.loaded) return <p className="studio-muted">Loading…</p>;
  if (saved)
    return (
      <p className="studio-callout" role="status">
        Saved as “{saved}” for {SCOPE_LABEL[chosen].toLowerCase()}. Find it under Add › Saved.{" "}
        <button type="button" className="studio-text-button" onClick={onDone}>
          Done
        </button>
      </p>
    );
  return (
    <div className="studio-save-as" ref={box}>
      <ErrorMessage error={error} />
      <Row label="Name" htmlFor={id}>
        <input id={id} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
      </Row>
      <Row
        label="Who can use it"
        info="Just me: only you, on any dashboard you edit. This dashboard: anyone who can arrange this dashboard. Everyone: anyone who can arrange any dashboard."
      >
        <Segmented
          label="Who can use it"
          value={chosen}
          onChange={setScope}
          options={scopes.map((item) => [item, SCOPE_LABEL[item]])}
        />
      </Row>
      <p className="studio-note">
        It keeps the settings, values, look, link, status check and any saved connection it uses, but not its size or
        place.
        {changed && " It is saved as it was last saved: save your changes first to include them."}
      </p>
      {chosen === "everyone" && (
        <p className="studio-note">
          Anyone who can arrange any dashboard can place it there. Its saved connections, keys included, are copied to
          that dashboard; they never see the keys, but that dashboard’s viewers see the widget’s data.
        </p>
      )}
      <div className="studio-inline-actions">
        <button type="button" className="studio-button studio-quiet" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={pending || !name.trim()}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await library.change({ action: "add", kind: "widget", scope: chosen, name: name.trim(), panelId });
              setSaved(name.trim());
            } catch (err) {
              setError(err);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// The host of an address, for a section's summary ("pfsense.home.arpa").
function hostOf(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

// What a widget's card takes from the entry it lives in: its link, status
// check, logo and description (its name is the entry's name).
const WIDGET_SERVICE_KEYS = [
  "href",
  "siteMonitor",
  "ping",
  "icon",
  "description",
  "server",
  "container",
  "skipCertificateCheck",
];
// Check now in the Status setting: the card's own check, on the draft address.
// Information widgets that fetch an address of their own, so they carry the
// per-widget certificate exception (owner decision D1). Longhorn's address is
// in settings.yaml (providers.longhorn), so its exception is set there.
const CERTIFICATE_INFO_WIDGETS = new Set(["glances", "customapi", "unifi_console"]);

const statusCheckNow = (check, address, skipCertificateCheck = false) =>
  studioRequest("/studio/api/connection-test", {
    status: { check, address, ...(skipCertificateCheck ? { skipCertificateCheck: true } : {}) },
  });
function widgetService(config = {}) {
  return Object.fromEntries(
    WIDGET_SERVICE_KEYS.map((key) => [
      key,
      key === "skipCertificateCheck"
        ? config[key] === true
          ? true
          : ""
        : typeof config[key] === "string"
          ? config[key]
          : "",
    ]),
  );
}

// What "Duplicate" opens: the add editor, filled with this item's saved
// settings and named "<name> copy". Used by the editor's Duplicate button and
// the widget menu on the board.
// What a new information widget shows before anything is chosen, where
// Homepage's own default is an empty card: Resources starts with CPU and
// memory, which need no setup (fresh-deploy check on the widget rebuild).
const STARTERS = { resources: { cpu: true, memory: true } };

export function duplicateEntry(panel, state, catalog) {
  const kind = panel.kind;
  const source = sourceForPanel(panel, state);
  if (!source) return null;
  const parent = state.services?.find((service) => service.id === source.serviceId);
  const entry = (kind === "serviceWidget" ? catalog?.service : catalog?.info)?.find(
    (item) => item.type === source.type,
  );
  const copy = structuredClone(source.config || entry?.defaults || {});
  if (kind === "service" || kind === "bookmark") delete copy.id;
  return {
    ...entry,
    kind,
    type: source.type || kind,
    name: entry?.name || LABEL[kind],
    defaults: copy,
    // A copy is its own widget (owner rule, 4 Nov 2026): its own entry, with
    // the same link and status check.
    seed: {
      name: `${source.name || parent?.name || entry?.name || "Widget"} copy`,
      ...(parent ? { service: widgetService(parent.config) } : {}),
    },
  };
}

// Studio's fillers have no app logo; each has its own symbol.
const FILLER_ICONS = { heading: "heading", note: "note", picture: "image", spacer: "maximize" };

const ENDPOINT = {
  service: "service",
  serviceWidget: "service-widget",
  informationWidget: "info-widget",
  bookmark: "bookmark",
};
const KIND_HINT = {
  service: "A link to an app, with its status.",
  serviceWidget: "Live numbers from one of your apps.",
  informationWidget: "Stands on its own, no app needed.",
  bookmark: "A compact link.",
};
const LABEL = {
  service: "Service tile",
  serviceWidget: "Integration widget",
  informationWidget: "Information widget",
  bookmark: "Bookmark",
};

// Saved widgets in the picker's Saved tab (board 26): place one as a new,
// independent widget on this page; rename or delete them in one place.
function SavedWidgets({ library, query, catalog, onPlace, busy, canManage = true }) {
  const [managing, setManaging] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);
  const names = new Map([...(catalog.service || []), ...(catalog.info || [])].map((item) => [item.type, item.name]));
  const needle = query.trim().toLowerCase();
  const shown = library.widgets.filter((entry) =>
    `${entry.name} ${entry.type} ${names.get(entry.type) || ""}`.toLowerCase().includes(needle),
  );
  const run = async (operation) => {
    setError(null);
    try {
      await operation();
    } catch (err) {
      setError(err);
    }
  };
  if (!library.loaded && !library.error) return <p className="studio-muted">Loading saved widgets…</p>;
  if (library.error) return <ErrorMessage error={library.error} />;
  if (!library.widgets.length)
    return (
      <p className="studio-empty-note">
        {canManage
          ? "No saved widgets yet. To save one, open a widget, then choose Save as a saved widget from its ⋯ menu."
          : "No saved widgets yet. An administrator saves them; then they appear here for you to place."}
      </p>
    );
  return (
    <>
      <ErrorMessage error={error} />
      {canManage && (
        <div className="studio-saved-widgets-head">
          <button type="button" className="studio-text-button" onClick={() => setManaging((value) => !value)}>
            {managing ? "Done" : "Manage saved widgets"}
          </button>
        </div>
      )}
      <div className="studio-catalog">
        {shown.map((entry) => {
          const key = `${entry.scope}:${entry.id}`;
          const detail = `${names.get(entry.type) || entry.type} · ${SCOPE_LABEL[entry.scope]}`;
          if (!managing)
            return (
              <button
                key={key}
                type="button"
                className="studio-catalog-item"
                disabled={busy}
                onClick={() => run(() => onPlace(entry))}
              >
                <span className="studio-catalog-icon">
                  <StudioIcon name="layout" size={20} />
                </span>
                <span>
                  <strong>{entry.name}</strong>
                  <small>{detail}</small>
                </span>
                <StudioIcon name="plus" size={15} />
              </button>
            );
          return (
            <div key={key} className="studio-catalog-item studio-saved-widget-row">
              {renaming?.key === key ? (
                <span className="studio-saved-look-name-edit">
                  <input
                    aria-label={`New name for ${entry.name}`}
                    maxLength={60}
                    value={renaming.name}
                    autoFocus
                    onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                  />
                  <button type="button" className="studio-button studio-quiet" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="studio-button studio-primary"
                    disabled={!renaming.name.trim()}
                    onClick={() =>
                      run(async () => {
                        await library.change({
                          action: "rename",
                          kind: "widget",
                          scope: entry.scope,
                          id: entry.id,
                          name: renaming.name.trim(),
                        });
                        setRenaming(null);
                      })
                    }
                  >
                    Save
                  </button>
                </span>
              ) : deleting === key ? (
                <span className="studio-saved-look-name-edit" role="alert">
                  <span>Delete “{entry.name}”? Widgets placed from it stay.</span>
                  <button type="button" className="studio-button studio-quiet" onClick={() => setDeleting(null)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="studio-button studio-danger"
                    onClick={() =>
                      run(async () => {
                        await library.change({ action: "delete", kind: "widget", scope: entry.scope, id: entry.id });
                        setDeleting(null);
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              ) : (
                <>
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{detail}</small>
                  </span>
                  <button
                    type="button"
                    className="studio-button studio-quiet"
                    onClick={() => setRenaming({ key, name: entry.name })}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="studio-button studio-quiet"
                    aria-label={`Delete saved widget ${entry.name}`}
                    onClick={() => setDeleting(key)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {!shown.length && <p className="studio-muted">No saved widgets match that search.</p>}
    </>
  );
}

// `savedOnly`: people who arrange (but don't administer) a dashboard place
// saved widgets only (owner decision, 5 Nov 2026): no other tab, no catalog.
export function ContentPicker({ catalog, state, onChoose, onRestore, onPlace, initial, savedOnly = false }) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [category, setCategory] = useState(savedOnly ? "saved" : (initial?.category ?? "all"));
  const [restoring, setRestoring] = useState(null);
  const [placing, setPlacing] = useState(false);
  const library = useLibrary(Boolean(onPlace));
  useEditorDraft(false, Boolean(restoring) || placing);
  const entries = [
    {
      kind: "service",
      name: "Service tile",
      description: "A link to an app, with its status.",
      type: "service",
      icon: "link",
    },
    {
      kind: "bookmark",
      name: "Bookmark",
      description: "A compact link, independently positioned.",
      type: "bookmark",
      icon: "link",
    },
    ...(catalog.info || []).map((item) => ({
      ...item,
      ...(STARTERS[item.type] && !Object.keys(item.defaults || {}).length ? { defaults: STARTERS[item.type] } : {}),
      kind: "informationWidget",
      icon: FILLER_ICONS[item.type] || "clock",
    })),
    ...(catalog.service || []).map((item) => ({
      ...item,
      kind: "serviceWidget",
      icon: "layout",
    })),
  ];
  // Glances, Custom API and a few others exist both ways: as an integration
  // (attached to one of your services, with its link and status) and as an
  // information widget (on its own). The subtitle says which is which.
  const subtitle = (entry) => entry.description || KIND_HINT[entry.kind];
  const [logos, setLogos] = useState(null);
  useEffect(() => {
    let live = true;
    loadIndex()
      .then((icons) => {
        if (live) setLogos(new Map(icons.map(([name]) => [name.replace(/[^a-z0-9]/g, ""), name])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // The app's own logo from the bundled set, when one matches its name.
  const logoOf = (entry) => {
    if (!logos || (entry.kind !== "serviceWidget" && entry.kind !== "informationWidget")) return null;
    if (entry.kind === "informationWidget" && isFiller(entry.type)) return null;
    const keys = [entry.type, entry.name].map((text) =>
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    );
    const name = keys.map((key) => logos.get(key)).find(Boolean);
    return name ? builtInIconUrl(name) : null;
  };
  const inCategory = (entry) =>
    category === "all" ||
    entry.kind === category ||
    (category === "links" && (entry.kind === "service" || entry.kind === "bookmark"));
  const visible = entries.filter(
    (entry) =>
      inCategory(entry) &&
      `${entry.name} ${entry.type} ${entry.description || ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="studio-dialog-body">
        <fieldset disabled={Boolean(restoring)} style={editorFieldsetStyle}>
          <label className="studio-search">
            <StudioIcon name="search" />
            <input
              autoFocus
              aria-label="Find a tile or widget"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="studio-tabs studio-picker-tabs" aria-label="Content categories" hidden={savedOnly}>
            {[
              ["all", "All"],
              ["serviceWidget", "Integrations"],
              ["informationWidget", "Information"],
              ["links", "Links"],
              ...(onPlace ? [["saved", "Saved"]] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={category === key ? "studio-tab-active" : ""}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {!savedOnly && Boolean(state?.hiddenDiscoveredIds?.length) && (
            <details className="studio-hidden-discovered">
              <summary>Hidden discovered panels ({state.hiddenDiscoveredIds.length})</summary>
              <div className="studio-stack-candidates">
                {(state.discoveredSources || [])
                  .filter((source) => state.hiddenDiscoveredIds.includes(source.id))
                  .map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={async () => {
                        if (restoring) return;
                        setRestoring(source.id);
                        try {
                          await onRestore(source.id);
                        } finally {
                          setRestoring(null);
                        }
                      }}
                    >
                      <strong>{source.title}</strong>
                      <small>
                        {restoring === source.id ? "Restoring…" : "Restore to dashboard"}
                        {" · "}
                        {source.group}
                      </small>
                    </button>
                  ))}
              </div>
            </details>
          )}
          {category === "saved" && (
            <SavedWidgets
              library={library}
              query={query}
              catalog={catalog}
              busy={placing}
              canManage={!savedOnly}
              onPlace={async (entry) => {
                setPlacing(true);
                try {
                  await onPlace(entry);
                } finally {
                  setPlacing(false);
                }
              }}
            />
          )}
          <div className="studio-catalog" hidden={category === "saved"}>
            {visible.map((entry) => (
              <button
                key={`${entry.kind}:${entry.type}`}
                className="studio-catalog-item"
                onClick={() => onChoose(entry, { query, category })}
              >
                <span className="studio-catalog-icon">
                  {logoOf(entry) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoOf(entry)} alt="" width={22} height={22} loading="lazy" />
                  ) : (
                    <StudioIcon name={entry.icon} size={20} />
                  )}
                </span>
                <span>
                  <strong>{entry.name || entry.type}</strong>
                  <small>{subtitle(entry)}</small>
                </span>
                <StudioIcon name="chevron" size={15} />
              </button>
            ))}
          </div>
          {category !== "saved" && !visible.length && (
            <p className="studio-muted">No native widgets match that search.</p>
          )}
        </fieldset>
      </div>
    </>
  );
}

// Sends the docked editor's draft to the board as it changes.
function LiveDraft({ value, onChange }) {
  useEffect(() => {
    const [panel, override] = JSON.parse(value);
    onChange({ panel, override });
  }, [value, onChange]);
  return null;
}

export default function ContentEditor({
  state,
  catalog,
  panel,
  entry,
  onSaved,
  onCancel,
  onReload,
  onDuplicate,
  pageId,
  wholeBoard,
  renderPreview,
  startDeleting = false,
  // The section to open first ("settings" when a card's Fix names it).
  startSection,
  onDelete,
  // Docked beside the board (T26): the board's own card shows the draft
  // through onLiveDraft, so the dialog has no preview of its own.
  docked = false,
  onLiveDraft,
  // Docked, the board beside it can change and save while the dialog is
  // open: settle that first, then save on the board's latest revision.
  beforeSave,
}) {
  const kind = panel?.kind || entry.kind;
  // The widget's own look and behaviour live on the board, not in its YAML.
  const settings = useContext(SettingsContext)?.settings;
  const boardPanel = panel ? wholeBoard?.panels.find((item) => item.id === panel.id) : null;
  const stacked = Boolean(boardPanel && wholeBoard?.stacks.some((stack) => stack.panelIds.includes(boardPanel.id)));
  const initialPage = boardPanel ? pageOf(wholeBoard, boardPanel) : null;
  const [look, setLook] = useState(boardPanel?.look);
  const [behaviour, setBehaviour] = useState(boardPanel?.behaviour);
  const [page, setPage] = useState(initialPage);
  const [savedLooks, setSavedLooks] = useState(wholeBoard?.looks || []);
  // Other widgets moved to a saved look's new version (Manage saved looks ›
  // Update › Update them), applied when this dialog saves.
  const [lookSwaps, setLookSwaps] = useState([]);
  // Its desktop size, changed by dragging the preview's corner (board 24). A
  // widget in a stack takes the stack's size, so it has none of its own here.
  const initialRect = boardPanel && !stacked ? boardPanel.rect : null;
  const [rect, setRect] = useState(initialRect);
  // Docked, the widget is resized on the board itself, which saves it.
  const rectChanged = !docked && Boolean(initialRect) && (rect.w !== initialRect.w || rect.h !== initialRect.h);
  // The formats of this widget's numbers (from Studio's collector), so Show
  // as offers only the charts its data supports.
  const { data: chartProbe } = useSWR(
    boardPanel && kind === "serviceWidget" ? ["/studio/api/history/probe", boardPanel.id] : null,
    ([path, id]) => studioRequest(path, { panel: id }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const lookChanged =
    Boolean(boardPanel) &&
    (JSON.stringify(look ?? null) !== JSON.stringify(boardPanel.look ?? null) ||
      JSON.stringify(behaviour ?? null) !== JSON.stringify(boardPanel.behaviour ?? null) ||
      page !== initialPage ||
      rectChanged ||
      lookSwaps.length > 0 ||
      JSON.stringify(savedLooks) !== JSON.stringify(wholeBoard.looks || []));
  const nextBoard = () => {
    let next = {
      ...wholeBoard,
      ...(savedLooks.length ? { looks: savedLooks } : { looks: undefined }),
      panels: wholeBoard.panels.map((item) => {
        if (item.id !== boardPanel.id) {
          const swap = item.look && lookSwaps.findLast((entry) => sameLook(lookOnly(item.look), entry.from));
          return swap ? { ...item, look: { ...swap.to, ...contentOnly(item.look) } } : item;
        }
        const { look: _look, behaviour: _behaviour, ...rest } = item;
        return { ...rest, ...(look ? { look } : {}), ...(behaviour ? { behaviour } : {}) };
      }),
    };
    // Only the resized widget moves, to the nearest free space if it no
    // longer fits where it is; the others stay put.
    if (rectChanged) {
      const resized = resizeUnit(pageBoard(next, initialPage), boardPanel.id, { ...initialRect, ...rect });
      next = mergePage(next, resized);
    }
    if (page !== initialPage) next = moveToPage(next, boardPanel.id, page);
    return next;
  };
  const source = panel ? sourceForPanel(panel, state) : null;
  const parent = state.services?.find((service) => service.id === source?.serviceId);
  const selectedEntry =
    entry || (kind === "serviceWidget" ? catalog.service : catalog.info)?.find((item) => item.type === source?.type);
  const initial = source?.config || selectedEntry?.defaults || {};
  const [draft, setDraft] = useState(() => structuredClone(initial));
  // Every widget is self-contained (owner rule and Q2, 4 Nov 2026): no group
  // and no service to pick. A widget's name, link and status check are those
  // of its own entry in services.yaml, edited here with it.
  const initialName =
    kind === "serviceWidget"
      ? parent?.name || entry?.seed?.name || selectedEntry?.name || ""
      : source?.name || entry?.seed?.name || "";
  const [name, setName] = useState(initialName);
  const [initialService] = useState(() =>
    kind === "serviceWidget" ? (entry?.seed?.service ?? widgetService(parent?.config)) : null,
  );
  const [service, setService] = useState(initialService);
  const serviceChanged = Boolean(service) && JSON.stringify(service) !== JSON.stringify(initialService);
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(startDeleting);
  const sizeNoteId = useId();
  const [savingAs, setSavingAs] = useState(false);
  // Existing widgets edit in tabs (mock-ups v4, board 1): Data, Show (what it
  // shows, at each size), Look and Behaviour; Duplicate, Save as a saved
  // widget and Delete sit in the More actions menu beside them.
  const showTab = Boolean(boardPanel) && (kind === "serviceWidget" || kind === "service");
  const [tab, setTab] = useState(() =>
    startDeleting || !boardPanel
      ? "data"
      : startSection === "look"
        ? "look"
        : startSection === "status"
          ? "behaviour"
          : showTab
            ? "show"
            : "data",
  );
  const tabsId = useId().replace(/:/g, "");
  const [actionsMenu, setActionsMenu] = useState(null);
  // The size being set up in Show and Look ("all" or one kind of size), and
  // what the card on the board (docked) or the preview last fitted.
  const [scope, setScope] = useState("all");
  const fit = useCardFit(boardPanel ? (docked ? boardPanel.id : `preview:${boardPanel.id}`) : null);
  // Where the resize corner last stopped because of these settings (on the
  // board or the preview); a change to the settings clears it.
  const [limited, setLimited] = useState(null);
  const limitId = boardPanel?.id;
  useEffect(() => {
    if (!limitId) return undefined;
    const on = (event) => {
      if (event.detail?.id !== limitId) return;
      event.preventDefault();
      setLimited({ w: event.detail.w, h: event.detail.h });
    };
    window.addEventListener("studio-card-limit", on);
    return () => window.removeEventListener("studio-card-limit", on);
  }, [limitId]);
  const [limitedLook, setLimitedLook] = useState(look);
  if (limitedLook !== look) {
    setLimitedLook(look);
    setLimited(null);
  }
  // Sections stay open until closed, so Values and Look can be open together
  // (F7, 6 Nov 2026: less back and forth; was one at a time, board 24). A new
  // item opens on its settings; an existing one opens with everything summarised.
  const [openSections, setOpenSections] = useState(
    startDeleting ? ["manage"] : startSection ? [startSection] : panel ? [] : ["settings"],
  );
  // Saved looks and widgets are read once Look or Management first opens.
  const [libraryWanted, setLibraryWanted] = useState(false);
  if ((tab === "look" || savingAs || openSections.includes("manage")) && !libraryWanted) setLibraryWanted(true);
  const library = useLibrary(Boolean(boardPanel) && libraryWanted);
  const sectionProps = (id) => ({
    open: openSections.includes(id),
    onToggle: () =>
      setOpenSections((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])),
  });
  const deleteConfirm = useRef(null);
  const keepButton = useRef(null);
  const deleteButton = useRef(null);
  const deleteShown = useRef(false);
  useEffect(() => {
    // On narrow screens the confirmation renders below the fold. Bring it into
    // view with focus on the safe choice, and return focus to Delete on cancel.
    if (deleting) {
      deleteShown.current = true;
      // The dialog footer is sticky, so leave room for it below the question.
      const confirm = deleteConfirm.current;
      const footer = confirm?.closest("dialog")?.querySelector(".studio-dialog-footer");
      if (confirm) confirm.style.scrollMarginBottom = `${(footer?.offsetHeight ?? 0) + 12}px`;
      confirm?.scrollIntoView?.({ block: "nearest" });
      keepButton.current?.focus({ preventScroll: true });
    } else if (deleteShown.current) {
      deleteShown.current = false;
      deleteButton.current?.focus();
    }
  }, [deleting]);
  // Tapping a part of the widget being edited (on the board beside a docked
  // editor, or in the preview) opens its setting and flashes it (mock-ups v4).
  const tabsRef = useRef(null);
  useEffect(() => {
    if (!boardPanel || typeof document === "undefined") return undefined;
    const tap = (event) => {
      const host = event.target?.closest?.(
        `[data-panel-id="${CSS.escape(boardPanel.id)}"], .studio-look-preview .studio-card-preview`,
      );
      if (!host || event.target.closest(".studio-preview-resize, .studio-resize-handle, .studio-move-handle")) return;
      // The preview's content is inert, so the part is found by position.
      const part = [...host.querySelectorAll("[data-pick]")].find((element) => {
        const box = element.getBoundingClientRect();
        return (
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        );
      });
      const pick = part?.dataset.pick;
      if (!pick) return;
      const next = pick === "header" ? "look" : pick.startsWith("block-") && showTab ? "show" : null;
      if (!next) return;
      setTab(next);
      requestAnimationFrame(() => {
        const target = tabsRef.current
          ?.closest("form")
          ?.querySelector(`[data-key="${CSS.escape(pick === "header" ? "header" : pick)}"]`);
        if (!target) return;
        target.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        target.classList.remove("studio-flash");
        void target.offsetWidth;
        target.classList.add("studio-flash");
      });
    };
    document.addEventListener("click", tap, true);
    return () => document.removeEventListener("click", tap, true);
  }, [boardPanel, showTab]);
  useEditorDraft(
    !valid || name !== initialName || serviceChanged || editorDraftChanged(initial, draft) || lookChanged,
    pending,
  );
  if (panel && !source)
    return (
      <div className="studio-dialog-body">
        <p>This panel’s source changed. Reload before editing it.</p>
        <button className="studio-button" onClick={onReload}>
          Reload configuration
        </button>
      </div>
    );
  // A service's check address lives under Status in the look editor, and
  // On click under Behaviour, so each has one home there. Studio cards don't
  // read the native target or showStats, so they have no row (Rule 1).
  const studioOwned = new Set(["target", "showStats", ...(boardPanel ? ["ping", "siteMonitor"] : [])]);
  // Board 27: on an existing widget the Values list is the one place to pick
  // which values show and in what order; it keeps the widget's fields list.
  const fieldsOption = kind === "serviceWidget" ? selectedEntry?.fields?.find((field) => field.key === "fields") : null;
  const reportedValues = boardPanel ? widgetFields.get(boardPanel.id) || [] : [];
  const valuePrefix =
    reportedValues.map((value) => String(value.field).split(".")[0]).find(Boolean) || source?.type || entry?.type || "";
  const valueChoices = (() => {
    if (fieldsOption?.choices) return fieldsOption.choices;
    const groups = fieldsOption?.optionGroups || [];
    if (!groups.length) return null;
    const shown = new Set(reportedValues.map((value) => String(value.field).replace(`${valuePrefix}.`, "")));
    const overlap = (group) => (group.choices || []).filter((choice) => shown.has(choice)).length;
    return [...groups].sort((a, b) => overlap(b) - overlap(a))[0].choices || null;
  })();
  const draftFields = (() => {
    if (Array.isArray(draft.fields)) return draft.fields.map(String);
    if (typeof draft.fields === "string") {
      try {
        const parsed = JSON.parse(draft.fields);
        return Array.isArray(parsed) ? parsed.map(String) : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  })();
  const nativeValues =
    boardPanel && valueChoices?.length
      ? {
          choices: valueChoices,
          prefix: valuePrefix,
          fields: draftFields,
          onChange: (next) => setDraft({ ...draft, fields: next }),
        }
      : undefined;
  const fields =
    kind === "service"
      ? SERVICE_FIELDS.filter((field) => !studioOwned.has(field.key))
      : kind === "bookmark"
        ? [...LINK_FIELDS, { key: "abbr", label: "Abbreviation", type: "string" }].filter(
            (field) => !studioOwned.has(field.key),
          )
        : (selectedEntry?.fields || []).filter((field) => !(nativeValues && field.key === "fields"));
  // The id is the panel's identity and a service's widgets are their own
  // panels, so neither is listed under More options.
  const hiddenKeys =
    kind === "service"
      ? ["id", "target", "showStats", "widget", "widgets", "skipCertificateCheck"]
      : kind === "bookmark"
        ? ["id", "target"]
        : nativeValues
          ? ["fields"]
          : [];
  const lookProps = boardPanel
    ? {
        kind,
        chartFields: chartProbe?.values,
        look,
        behaviour,
        inheritedLook: resolvedLook(settings, null),
        inheritedBehaviour: resolvedBehaviour(settings, null),
        fields: reportedValues,
        nativeValues,
        pages: pagesOf(wholeBoard),
        pageId: page,
        onLook: setLook,
        onBehaviour: setBehaviour,
        onPage: stacked ? undefined : setPage,
        savedLooks,
        onSavedLooks: setSavedLooks,
        personalLooks: library.scopes.includes("me")
          ? { available: true, looks: library.looks, change: library.change }
          : undefined,
        lookUsage: (saved) =>
          wholeBoard.panels.filter(
            (item) => item.id !== boardPanel.id && item.look && sameLook(lookOnly(item.look), saved),
          ).length,
        onUpdateLookUsers: (from, to) => setLookSwaps((current) => [...current, { from, to }]),
        // An integration widget's logo and description live on the entry
        // around it (owner T8/T30 on 65f724c: lost with that entry in round 4).
        identity:
          kind === "serviceWidget"
            ? {
                icon: service.icon,
                description: service.description,
                onIcon: (value) => setService({ ...service, icon: value || "" }),
                onDescription: (value) => setService({ ...service, description: value }),
              }
            : undefined,
        docker:
          kind === "serviceWidget"
            ? {
                server: service.server,
                container: service.container,
                servers: Array.isArray(state?.dockerServers) ? state.dockerServers : [],
                onChange: (key, value) => setService({ ...service, [key]: value }),
              }
            : undefined,
        // Certificate checking's per-service exception (owner decision D1).
        // A widget's switch is in Connection (config-form); a plain tile's is here.
        certificate:
          kind === "service"
            ? {
                skip: draft.skipCertificateCheck === true,
                onChange: (skip) => {
                  const next = { ...draft };
                  if (skip) next.skipCertificateCheck = true;
                  else delete next.skipCertificateCheck;
                  setDraft(next);
                },
              }
            : undefined,
        statusAddress:
          kind === "serviceWidget"
            ? {
                web: service.siteMonitor,
                ping: service.ping,
                href: service.href,
                // Derived (T35): the Connection address, else the link.
                fallback:
                  /^https?:\/\//i.test(draft.url || "") || /^\{\{STUDIO_CONNECTION_/.test(draft.url || "")
                    ? { address: draft.url, from: "Connection" }
                    : service.href
                      ? { address: service.href, from: "link" }
                      : null,
                onChange: (check, value) =>
                  setService({ ...service, [check === "ping" ? "ping" : "siteMonitor"]: value || "" }),
                onCheck: (check, address) => statusCheckNow(check, address, service.skipCertificateCheck === true),
              }
            : kind === "service"
              ? {
                  web: typeof draft.siteMonitor === "string" ? draft.siteMonitor : "",
                  ping: typeof draft.ping === "string" ? draft.ping : "",
                  href: typeof draft.href === "string" ? draft.href : "",
                  fallback: typeof draft.href === "string" && draft.href ? { address: draft.href, from: "link" } : null,
                  onCheck: (check, address) => statusCheckNow(check, address, draft.skipCertificateCheck === true),
                  onChange: (check, value) => {
                    const key = check === "ping" ? "ping" : "siteMonitor";
                    const next = { ...draft };
                    if (value) next[key] = value;
                    else delete next[key];
                    setDraft(next);
                  },
                }
              : undefined,
      }
    : null;
  const sections = lookSections(kind);
  const valuesShown = Boolean(boardPanel) && valuesPartShown({ show: sections, fields: reportedValues });
  const has = (...keys) => fields.some((field) => keys.includes(field.key));
  const sentence = (parts) => {
    const text = parts.filter(Boolean).join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const settingsSection =
    kind === "serviceWidget"
      ? {
          title: "Connection",
          detail: sentence([
            has("url") && "address",
            has("key", "token", "password", "username") && "key or secret",
            has("version") && "version",
            has("url") && "Test connection",
            "every other setting",
          ]),
          summary: [hostOf(draft.url), /^\d+$/.test(String(draft.version ?? "")) ? `API v${draft.version}` : ""]
            .filter(Boolean)
            .join(" · "),
        }
      : kind === "informationWidget"
        ? { title: "Settings", detail: "What it shows and how" }
        : {
            title: "Details",
            detail: sentence(["address", "description", "icon", kind === "service" && "Docker container"]),
            summary: hostOf(draft.href),
          };
  const guideName = selectedEntry?.name;
  const guided = Boolean(
    selectedEntry &&
    (selectedEntry.guide?.length > 0 ||
      selectedEntry.setupNotes?.length > 0 ||
      selectedEntry.secrets?.length > 0 ||
      selectedEntry.docs),
  );
  const guideTitle =
    selectedEntry?.documentationStatus === "studio"
      ? `About ${guideName}`
      : guideName
        ? `Setting up ${guideName}`
        : "Setting it up";
  const guideDetail =
    selectedEntry?.documentationStatus === "studio"
      ? "What it's for"
      : selectedEntry?.secrets?.length
        ? `What ${guideName || "it"} needs and how to name its secrets`
        : `What ${guideName || "it"} needs`;
  const tabList = [
    ["data", "Data"],
    ...(showTab ? [["show", "Show"]] : []),
    ["look", "Look"],
    ["behaviour", "Behaviour"],
  ];
  const selectTab = (key) => setTab(key);
  const submit = async (action = source ? "update" : "add") => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const revision = beforeSave ? await beforeSave() : state.revision;
      if (!revision) throw new Error("The arrangement beside this dialog could not be saved. Try again.");
      const contentChanged =
        action !== "update" || name !== initialName || serviceChanged || editorDraftChanged(initial, draft);
      // A look-only change saves the arrangement; with content it travels
      // along so both commit together.
      if (!contentChanged && lookChanged) {
        await onSaved(await studioRequest("/studio/api/board", { revision, board: nextBoard() }));
        return;
      }
      const body = {
        revision,
        action,
        ...(source ? { id: source.id } : {}),
        // A new widget's starting settings (a duplicate's copy, a starter)
        // are all sent; an update sends only what changed.
        config: action === "update" ? patchFromDraft(initial, draft) : patchFromDraft({}, draft),
      };
      // New content lands on the page being edited.
      if (pageId && !source) body.pageId = pageId;
      if (lookChanged && action === "update") body.board = nextBoard();
      if (kind === "service" || kind === "bookmark") body.name = name;
      if (kind === "informationWidget" || kind === "serviceWidget") body.type = source?.type || entry.type;
      if (kind === "serviceWidget") {
        if (!source) body.newService = { name };
        const patch = {};
        if (source && name !== initialName) patch.name = name;
        for (const key of WIDGET_SERVICE_KEYS)
          if (service[key] !== (source ? initialService[key] : "")) patch[key] = service[key] || null;
        if (Object.keys(patch).length) body.service = patch;
      }
      const result = await studioRequest(`/studio/api/${ENDPOINT[kind]}`, body);
      await onSaved(result);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const requiresName = kind === "service" || kind === "bookmark" || kind === "serviceWidget";
  const disabled = !valid || pending || (requiresName && !name.trim());
  // What the card shows while editing: in the preview, or on the board itself
  // when the editor is docked.
  const previewPanel = boardPanel
    ? {
        ...boardPanel,
        ...(rect && !docked ? { rect } : {}),
        look,
        behaviour,
        title: kind === "service" || kind === "bookmark" ? name || boardPanel.title : boardPanel.title,
      }
    : null;
  // A link's name, address, description and icon show as they are typed.
  const previewOverride =
    kind === "service" || kind === "bookmark"
      ? { name: name || boardPanel?.title, href: draft.href, description: draft.description, icon: draft.icon }
      : kind === "serviceWidget"
        ? { icon: service.icon, description: service.description, ...(draftFields ? { fields: draftFields } : {}) }
        : // Studio's fillers fetch nothing, so their text and picture show as typed.
          kind === "informationWidget" && isFiller(source?.type || entry?.type)
          ? { options: draft }
          : null;
  const liveKey = docked && previewPanel && onLiveDraft ? JSON.stringify([previewPanel, previewOverride]) : null;
  const nameGroup = requiresName ? (
    <Group>
      <Row label="Name" htmlFor="studio-source-name">
        <input
          id="studio-source-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
          placeholder="Required"
        />
      </Row>
    </Group>
  ) : null;
  const configForm = (
    <>
      <ConfigForm
        value={draft}
        onChange={setDraft}
        fields={fields}
        emptyNote={(source?.type || entry?.type) === "spacer" ? "Nothing to set up. Size it on the board." : undefined}
        knownKeys={hiddenKeys}
        certificate={
          kind === "serviceWidget"
            ? {
                skip: service?.skipCertificateCheck === true,
                onChange: (skip) => setService({ ...service, skipCertificateCheck: skip ? true : "" }),
              }
            : kind === "informationWidget" &&
                CERTIFICATE_INFO_WIDGETS.has(source?.type || selectedEntry?.type || entry?.type)
              ? {
                  skip: draft.skipCertificateCheck === true,
                  onChange: (skip) => {
                    const next = { ...draft };
                    if (skip) next.skipCertificateCheck = true;
                    else delete next.skipCertificateCheck;
                    setDraft(next);
                  },
                }
              : undefined
        }
        onValidity={setValid}
        sectioned
        connections={kind === "serviceWidget" || kind === "informationWidget"}
        testable={kind === "serviceWidget" && (source?.type || selectedEntry?.type || true)}
      />
      {(kind === "serviceWidget" || kind === "informationWidget") &&
        customApiMappingsMissing(source?.type || entry?.type, draft) && (
          <p className="studio-callout studio-callout-warn" role="status">
            This Custom API widget has no <code>mappings</code> yet, so its panel will be empty. Add at least one under
            Value mappings, or in YAML. You can still save it now.
          </p>
        )}
    </>
  );
  const linkGroup =
    kind === "serviceWidget" ? (
      <Group>
        <Row
          label="Link"
          htmlFor="studio-widget-link"
          info="Where the card's name takes you, and where On click opens."
        >
          <input
            id="studio-widget-link"
            type="url"
            inputMode="url"
            value={service.href}
            onChange={(event) => setService({ ...service, href: event.target.value })}
            placeholder="https://"
          />
        </Row>
      </Group>
    ) : null;
  const deleteQuestion = (
    <div ref={deleteConfirm} className="studio-delete-confirm" role="alert">
      <strong>Delete {panel?.title || "this item"}?</strong>
      <p>
        {kind === "service"
          ? "This removes the service and its widgets. The rest of the dashboard stays."
          : "A snapshot is kept, so you can restore it from dashboard settings under Snapshots & restore."}
      </p>
      <div className="studio-inline-actions">
        <button
          ref={keepButton}
          type="button"
          className="studio-button studio-quiet"
          onClick={() => setDeleting(false)}
        >
          Keep it
        </button>
        <button
          type="button"
          className="studio-button studio-danger"
          disabled={pending}
          onClick={() => submit("delete")}
        >
          Delete
        </button>
      </div>
    </div>
  );
  const guide = (
    <Guide
      blocks={selectedEntry?.guide}
      notes={selectedEntry?.setupNotes}
      secrets={selectedEntry?.secrets}
      name={guideName}
      docs={selectedEntry?.docs}
    />
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {liveKey && <LiveDraft value={liveKey} onChange={onLiveDraft} />}
      <div className={`studio-dialog-body${boardPanel && renderPreview && !docked ? " studio-widget-layout" : ""}`}>
        {boardPanel && renderPreview && !docked && (
          <aside className="studio-look-preview" aria-label="Preview">
            <span className="studio-look-preview-label" aria-hidden="true">
              Preview
            </span>
            {renderPreview(
              previewPanel,
              previewOverride,
              rect && (
                <ResizeCorner
                  rect={rect}
                  minimum={unitMinimum(wholeBoard, boardPanel.id)}
                  columns={gridColumns(pageBoard(wholeBoard, initialPage))}
                  onChange={setRect}
                  describedBy={sizeNoteId}
                  fitId={`preview:${boardPanel.id}`}
                />
              ),
            )}
            {rect && (
              <p className="studio-preview-size" id={sizeNoteId}>
                <strong>
                  {rect.w} × {rect.h}
                </strong>{" "}
                Desktop size. Drag the corner to change it; it stops at the smallest size these settings allow.
              </p>
            )}
            {stacked && <p className="studio-preview-size">In a stack, it takes the stack&apos;s size.</p>}
          </aside>
        )}
        <div className="studio-widget-settings">
          <ErrorMessage error={error} onReload={onReload} />
          <fieldset disabled={pending} style={editorFieldsetStyle}>
            {boardPanel ? (
              <>
                <div className="studio-editor-tabbar" ref={tabsRef}>
                  <div
                    role="tablist"
                    aria-label="Widget settings"
                    className="studio-tabs studio-editor-tabs"
                    onKeyDown={(event) => {
                      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
                      if (!step) return;
                      event.preventDefault();
                      const keys = tabList.map(([key]) => key);
                      const next = keys[(keys.indexOf(tab) + step + keys.length) % keys.length];
                      selectTab(next);
                      event.currentTarget.querySelector(`#${CSS.escape(`${tabsId}-${next}`)}`)?.focus();
                    }}
                  >
                    {tabList.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`${tabsId}-${key}`}
                        aria-selected={tab === key}
                        aria-controls={`${tabsId}-${key}-panel`}
                        tabIndex={tab === key ? 0 : -1}
                        className={tab === key ? "studio-tab-active" : ""}
                        onClick={() => selectTab(key)}
                      >
                        {label}
                        {key === "data" && !valid && <i className="studio-tab-attention" aria-label="needs a fix" />}
                      </button>
                    ))}
                  </div>
                  {source && (
                    <button
                      ref={deleteButton}
                      type="button"
                      className="studio-icon-button"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={Boolean(actionsMenu)}
                      disabled={pending}
                      onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        setLibraryWanted(true);
                        setActionsMenu({
                          x: box.right - 230,
                          y: box.bottom + 4,
                          above: box.top - 4,
                          from: event.currentTarget,
                        });
                      }}
                    >
                      <StudioIcon name="more" />
                    </button>
                  )}
                </div>
                {actionsMenu && (
                  <Menu
                    anchor={actionsMenu}
                    label="Widget actions"
                    returnFocus={actionsMenu.from}
                    onClose={() => setActionsMenu(null)}
                    items={[
                      {
                        id: "duplicate",
                        icon: "copy",
                        label: "Duplicate",
                        // Switching away from an edited source asks before
                        // discarding its local changes.
                        onSelect: () => onDuplicate(duplicateEntry(panel, state, catalog)),
                      },
                      (kind === "serviceWidget" || kind === "informationWidget") && {
                        id: "save",
                        icon: "tag",
                        label: "Save as a saved widget",
                        keepFocus: true,
                        onSelect: () => setSavingAs(true),
                      },
                      "-",
                      {
                        id: "delete",
                        icon: "trash",
                        label: "Delete",
                        danger: true,
                        keepFocus: true,
                        // A widget on the board goes at once, with Undo, as
                        // from its menu (board 23): one Delete, one behaviour.
                        onSelect: () => (onDelete ? onDelete(boardPanel) : setDeleting(true)),
                      },
                    ]}
                  />
                )}
                {savingAs && (
                  <SaveAsWidget
                    library={library}
                    defaultName={name || panel?.title || ""}
                    panelId={boardPanel.id}
                    changed={
                      name !== initialName || serviceChanged || editorDraftChanged(initial, draft) || lookChanged
                    }
                    onDone={() => setSavingAs(false)}
                  />
                )}
                {deleting && deleteQuestion}
                {showTab && (
                  <LimitNote
                    look={look}
                    inheritedLook={lookProps.inheritedLook}
                    scope={scope}
                    fit={fit}
                    limited={limited}
                    onLook={setLook}
                  />
                )}
                <div
                  role="tabpanel"
                  id={`${tabsId}-data-panel`}
                  aria-labelledby={`${tabsId}-data`}
                  className="studio-tab-panel"
                  hidden={tab !== "data"}
                >
                  {nameGroup}
                  {configForm}
                  {guided && <Disclosure title={guideTitle}>{guide}</Disclosure>}
                </div>
                {showTab && (
                  <div
                    role="tabpanel"
                    id={`${tabsId}-show-panel`}
                    aria-labelledby={`${tabsId}-show`}
                    className="studio-tab-panel"
                    hidden={tab !== "show"}
                  >
                    <ShowEditor
                      kind={kind}
                      look={look}
                      inheritedLook={lookProps.inheritedLook}
                      onLook={setLook}
                      fields={reportedValues}
                      numbers={
                        Array.isArray(chartProbe?.values) ? chartProbe.values.map((value) => value.field) : undefined
                      }
                      formats={Object.fromEntries(
                        (Array.isArray(chartProbe?.values) ? chartProbe.values : []).map((value) => [
                          value.field,
                          value.format,
                        ]),
                      )}
                      fit={fit}
                      scope={scope}
                      onScope={setScope}
                      choices={nativeValues?.choices}
                      prefix={nativeValues?.prefix}
                      nativeFields={nativeValues?.fields}
                      onNativeFields={nativeValues?.onChange}
                    />
                    {valuesShown && (
                      <Disclosure title="More: each value's name, number style, colour and rules">
                        <LookEditor part="values" {...lookProps} />
                      </Disclosure>
                    )}
                  </div>
                )}
                <div
                  role="tabpanel"
                  id={`${tabsId}-look-panel`}
                  aria-labelledby={`${tabsId}-look`}
                  className="studio-tab-panel"
                  hidden={tab !== "look"}
                >
                  <LookEditor part="look" {...lookProps} scope={scope} onScope={setScope} fit={fit} />
                </div>
                <div
                  role="tabpanel"
                  id={`${tabsId}-behaviour-panel`}
                  aria-labelledby={`${tabsId}-behaviour`}
                  className="studio-tab-panel"
                  hidden={tab !== "behaviour"}
                >
                  {linkGroup}
                  <LookEditor part="status" {...lookProps} />
                  {!stacked && <LookEditor part="page" {...lookProps} />}
                </div>
              </>
            ) : (
              <>
                {nameGroup}
                <div className="studio-sections">
                  <Section
                    title={settingsSection.title}
                    detail={settingsSection.detail}
                    summary={settingsSection.summary}
                    attention={valid ? null : "Needs a fix"}
                    {...sectionProps("settings")}
                  >
                    {configForm}
                  </Section>
                  {kind === "serviceWidget" && (
                    <Section
                      title="Link"
                      detail="Where the card's name takes you"
                      summary={hostOf(service?.href)}
                      {...sectionProps("status")}
                    >
                      {linkGroup}
                    </Section>
                  )}
                  {source && (
                    <Section title="Management" detail="Duplicate or delete" {...sectionProps("manage")}>
                      <Group className="studio-item-actions">
                        <ActionRow
                          icon="copy"
                          disabled={pending}
                          onClick={() => onDuplicate(duplicateEntry(panel, state, catalog))}
                        >
                          Duplicate
                        </ActionRow>
                        <ActionRow
                          ref={deleteButton}
                          icon="trash"
                          danger
                          disabled={pending}
                          aria-expanded={deleting}
                          onClick={() => setDeleting(true)}
                        >
                          Delete
                        </ActionRow>
                      </Group>
                      {deleting && deleteQuestion}
                    </Section>
                  )}
                  {guided && (
                    <Section title={guideTitle} detail={guideDetail} {...sectionProps("guide")}>
                      {guide}
                    </Section>
                  )}
                </div>
              </>
            )}
          </fieldset>
        </div>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="studio-button studio-primary" disabled={disabled}>
          {pending ? "Saving…" : source ? "Save changes" : "Add to dashboard"}
        </button>
      </footer>
    </form>
  );
}
