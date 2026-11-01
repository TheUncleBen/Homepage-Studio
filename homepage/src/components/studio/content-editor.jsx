import { useContext, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { chartRanges } from "./card-chart";
import { resolvedBehaviour, resolvedLook, widgetFields } from "./card-look";
import ConfigForm, { LINK_FIELDS, SERVICE_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import { moveToPage, pageOf, pagesOf } from "./geometry.mjs";
import StudioIcon from "./icons";
import LookEditor from "./look-editor";
import { patchFromDraft, sourceForPanel } from "./native-adapter.mjs";
import { ActionRow, Group, Row } from "./ui";

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

// What "Duplicate" opens: the add editor, filled with this item's saved
// settings and named "<name> copy". Used by the editor's Duplicate button and
// the widget menu on the board.
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
    seed: {
      name: `${source.name || parent?.name || entry?.name || "Widget"} copy`,
      group: source.group || parent?.group || "Dashboard",
      serviceId: source.serviceId,
    },
  };
}

const ENDPOINT = {
  service: "service",
  serviceWidget: "service-widget",
  informationWidget: "info-widget",
  bookmark: "bookmark",
};
const LABEL = {
  service: "Service tile",
  serviceWidget: "Integration widget",
  informationWidget: "Information widget",
  bookmark: "Bookmark",
};

export function ContentPicker({ catalog, state, onChoose, onRestore }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [restoring, setRestoring] = useState(null);
  useEditorDraft(false, Boolean(restoring));
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
      kind: "informationWidget",
      icon: "clock",
    })),
    ...(catalog.service || []).map((item) => ({
      ...item,
      kind: "serviceWidget",
      icon: "layout",
    })),
  ];
  // In All, an information widget and an integration widget can share a name
  // (Custom API, Glances, …); their subtitle names the kind so the two can be
  // told apart.
  const nameCounts = new Map();
  for (const entry of entries) {
    const key = (entry.name || entry.type).toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const subtitle = (entry) =>
    category === "all" && nameCounts.get((entry.name || entry.type).toLowerCase()) > 1
      ? LABEL[entry.kind]
      : entry.description || LABEL[entry.kind];
  const visible = entries.filter(
    (entry) =>
      (category === "all" || entry.kind === category) &&
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
          <nav className="studio-tabs studio-picker-tabs" aria-label="Content categories">
            {[
              ["all", "All"],
              ["serviceWidget", "Integrations"],
              ["informationWidget", "Information"],
              ["service", "Services"],
              ["bookmark", "Bookmarks"],
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
          {Boolean(state?.hiddenDiscoveredIds?.length) && (
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
          <div className="studio-catalog">
            {visible.map((entry) => (
              <button
                key={`${entry.kind}:${entry.type}`}
                className="studio-catalog-item"
                onClick={() => onChoose(entry)}
              >
                <span className="studio-catalog-icon">
                  <StudioIcon name={entry.icon} size={20} />
                </span>
                <span>
                  <strong>{entry.name || entry.type}</strong>
                  <small>{subtitle(entry)}</small>
                </span>
                <StudioIcon name="chevron" size={15} />
              </button>
            ))}
          </div>
          {!visible.length && <p className="studio-muted">No native widgets match that search.</p>}
        </fieldset>
      </div>
    </>
  );
}

export default function ContentEditor({
  state,
  catalog,
  panel,
  entry,
  onSaved,
  onCancel,
  onParent,
  onReload,
  onDuplicate,
  pageId,
  wholeBoard,
  renderPreview,
  startDeleting = false,
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
      JSON.stringify(savedLooks) !== JSON.stringify(wholeBoard.looks || []));
  const nextBoard = () => {
    let next = {
      ...wholeBoard,
      ...(savedLooks.length ? { looks: savedLooks } : { looks: undefined }),
      panels: wholeBoard.panels.map((item) => {
        if (item.id !== boardPanel.id) return item;
        const { look: _look, behaviour: _behaviour, ...rest } = item;
        return { ...rest, ...(look ? { look } : {}), ...(behaviour ? { behaviour } : {}) };
      }),
    };
    if (page !== initialPage) next = moveToPage(next, boardPanel.id, page);
    return next;
  };
  const source = panel ? sourceForPanel(panel, state) : null;
  const parent = state.services?.find((service) => service.id === source?.serviceId);
  const selectedEntry =
    entry || (kind === "serviceWidget" ? catalog.service : catalog.info)?.find((item) => item.type === source?.type);
  const initial = source?.config || selectedEntry?.defaults || {};
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const initialName = source?.name || entry?.seed?.name || (kind === "serviceWidget" ? selectedEntry?.name || "" : "");
  const initialGroup = source?.group || entry?.seed?.group || parent?.group || "Dashboard";
  const initialServiceId = source?.serviceId || entry?.seed?.serviceId || "new";
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState(initialGroup);
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(startDeleting);
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
  useEditorDraft(
    !valid ||
      name !== initialName ||
      group !== initialGroup ||
      serviceId !== initialServiceId ||
      editorDraftChanged(initial, draft) ||
      lookChanged,
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
  const fields =
    kind === "service"
      ? SERVICE_FIELDS.filter((field) => !studioOwned.has(field.key))
      : kind === "bookmark"
        ? [...LINK_FIELDS, { key: "abbr", label: "Abbreviation", type: "string" }].filter(
            (field) => !studioOwned.has(field.key),
          )
        : selectedEntry?.fields || [];
  // The id is the panel's identity and a service's widgets are their own
  // panels, so neither is listed under More options.
  const hiddenKeys =
    kind === "service"
      ? ["id", "target", "showStats", "widget", "widgets"]
      : kind === "bookmark"
        ? ["id", "target"]
        : [];
  const lookProps = boardPanel
    ? {
        kind,
        chartFields: chartProbe?.values,
        rangeChoices: chartRanges(settings, look?.chartRange),
        look,
        behaviour,
        inheritedLook: resolvedLook(settings, null),
        inheritedBehaviour: resolvedBehaviour(settings, null),
        fields: widgetFields.get(boardPanel.id) || [],
        pages: pagesOf(wholeBoard),
        pageId: page,
        onLook: setLook,
        onBehaviour: setBehaviour,
        onPage: stacked ? undefined : setPage,
        savedLooks,
        onSavedLooks: setSavedLooks,
        statusAddress:
          kind === "service"
            ? {
                web: typeof draft.siteMonitor === "string" ? draft.siteMonitor : "",
                ping: typeof draft.ping === "string" ? draft.ping : "",
                href: typeof draft.href === "string" ? draft.href : "",
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
  const changedGroup = source?.group === group ? source?.groupPath || group : group;
  const submit = async (action = source ? "update" : "add") => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const contentChanged =
        action !== "update" ||
        name !== initialName ||
        group !== initialGroup ||
        serviceId !== initialServiceId ||
        editorDraftChanged(initial, draft);
      // A look-only change saves the arrangement; with content it travels
      // along so both commit together.
      if (!contentChanged && lookChanged) {
        await onSaved(await studioRequest("/studio/api/board", { revision: state.revision, board: nextBoard() }));
        return;
      }
      const body = {
        revision: state.revision,
        action,
        ...(source ? { id: source.id } : {}),
        config: patchFromDraft(initial, draft),
      };
      // New content lands on the page being edited.
      if (pageId && !source) body.pageId = pageId;
      if (lookChanged && action === "update") body.board = nextBoard();
      if (kind === "service" || kind === "bookmark") {
        body.name = name;
        body.group = changedGroup;
      }
      if (kind === "informationWidget" || kind === "serviceWidget") body.type = source?.type || entry.type;
      if (kind === "serviceWidget" && !source) {
        if (serviceId === "new") body.newService = { name, group };
        else body.serviceId = serviceId;
      }
      const result = await studioRequest(`/studio/api/${ENDPOINT[kind]}`, body);
      await onSaved(result);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const requiresName =
    kind === "service" || kind === "bookmark" || (kind === "serviceWidget" && !source && serviceId === "new");
  const disabled = !valid || pending || (requiresName && (!name.trim() || !group.trim()));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={`studio-dialog-body${boardPanel && renderPreview ? " studio-widget-layout" : ""}`}>
        {boardPanel && renderPreview && (
          <aside className="studio-look-preview" aria-label="Preview">
            <span className="studio-look-preview-label" aria-hidden="true">
              Preview
            </span>
            {renderPreview(
              {
                ...boardPanel,
                look,
                behaviour,
                title: kind === "service" || kind === "bookmark" ? name || boardPanel.title : boardPanel.title,
              },
              // A link's name, address, description and icon show as they are typed.
              kind === "service" || kind === "bookmark"
                ? { name: name || boardPanel.title, href: draft.href, description: draft.description, icon: draft.icon }
                : null,
            )}
          </aside>
        )}
        <div className="studio-widget-settings">
          <ErrorMessage error={error} onReload={onReload} />
          <fieldset disabled={pending} style={editorFieldsetStyle}>
            {((kind === "serviceWidget" && !source) || requiresName) && (
              <Group>
                {kind === "serviceWidget" && !source && (
                  <Row
                    label="Service"
                    htmlFor="studio-service-context"
                    info="An integration lives in a service tile. Add it to one you have, or to a new tile that shows only this widget."
                  >
                    <select
                      id="studio-service-context"
                      value={serviceId}
                      onChange={(event) => setServiceId(event.target.value)}
                    >
                      <option value="new">New service</option>
                      {state.services?.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.group} / {service.name}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}
                {requiresName && (
                  <>
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
                    <Row label="Group" htmlFor="studio-source-group">
                      <input
                        id="studio-source-group"
                        list="studio-groups"
                        value={group}
                        onChange={(event) => setGroup(event.target.value)}
                        required
                        placeholder="Required"
                      />
                      <datalist id="studio-groups">
                        {[
                          ...new Set([
                            ...(state.groups || []).map((item) => item.label || item.name),
                            ...(state.bookmarks || []).map((item) => item.group),
                          ]),
                        ].map((item) => (
                          <option value={item} key={item} />
                        ))}
                      </datalist>
                    </Row>
                  </>
                )}
              </Group>
            )}
            {parent && (
              <Group>
                <ActionRow
                  icon="link"
                  detail={`${parent.group} / ${parent.name}`}
                  disabled={pending}
                  onClick={() => onParent(parent)}
                >
                  Service
                </ActionRow>
              </Group>
            )}
            {boardPanel && <LookEditor part="top" {...lookProps} />}
            <ConfigForm
              value={draft}
              onChange={setDraft}
              fields={fields}
              knownKeys={hiddenKeys}
              onValidity={setValid}
              docs={selectedEntry?.docs}
              guide={selectedEntry?.guide}
              setupNotes={selectedEntry?.setupNotes}
              name={selectedEntry?.name}
              connections={kind === "serviceWidget" || kind === "informationWidget"}
              testable={kind === "serviceWidget"}
            />
            {(kind === "serviceWidget" || kind === "informationWidget") &&
              customApiMappingsMissing(source?.type || entry?.type, draft) && (
                <p className="studio-callout studio-callout-warn" role="status">
                  This Custom API widget has no <code>mappings</code> yet, so its panel will be empty. Add at least one
                  in YAML. You can still save it now.
                </p>
              )}
            {boardPanel && <LookEditor part="bottom" {...lookProps} />}
            {source && (
              <Group className="studio-item-actions">
                <ActionRow
                  icon="copy"
                  disabled={pending}
                  onClick={() => {
                    // Duplicate the saved source. Switching away from an edited
                    // source asks before discarding its local changes.
                    onDuplicate(duplicateEntry(panel, state, catalog));
                  }}
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
            )}
            {deleting && (
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
                    Delete permanently
                  </button>
                </div>
              </div>
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
