import { useContext, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { chartRanges } from "./card-chart";
import { resolvedBehaviour, resolvedLook, widgetFields } from "./card-look";
import ConfigForm, { LINK_FIELDS, SERVICE_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import { moveToPage, pageOf, pagesOf } from "./geometry.mjs";
import Guide from "./guide";
import { loadIndex } from "./icon-chooser";
import { builtInIconUrl } from "./icon-source.mjs";
import StudioIcon from "./icons";
import LookEditor, { lookSections, lookSummaries, valuesPartShown } from "./look-editor";
import { patchFromDraft, sourceForPanel } from "./native-adapter.mjs";
import { ActionRow, Group, Row, Section } from "./ui";

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

// The host of an address, for a section's summary ("pfsense.home.arpa").
function hostOf(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

// What a widget's card takes from the entry it lives in: its link and
// status check (its name is the entry's name).
const WIDGET_SERVICE_KEYS = ["href", "siteMonitor", "ping"];
function widgetService(config = {}) {
  return Object.fromEntries(
    WIDGET_SERVICE_KEYS.map((key) => [key, typeof config[key] === "string" ? config[key] : ""]),
  );
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
    // A copy is its own widget (owner rule, 4 Nov 2026): its own entry, with
    // the same link and status check.
    seed: {
      name: `${source.name || parent?.name || entry?.name || "Widget"} copy`,
      ...(parent ? { service: widgetService(parent.config) } : {}),
    },
  };
}

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
    const keys = [entry.type, entry.name].map((text) =>
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    );
    const name = keys.map((key) => logos.get(key)).find(Boolean);
    return name ? builtInIconUrl(name) : null;
  };
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
  // One section open at a time (board 24). A new item opens on its settings;
  // an existing one opens with everything summarised.
  const [openSection, setOpenSection] = useState(startDeleting ? "manage" : panel ? null : "settings");
  const sectionProps = (id) => ({
    open: openSection === id,
    onToggle: () => setOpenSection((current) => (current === id ? null : id)),
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
      ? ["id", "target", "showStats", "widget", "widgets"]
      : kind === "bookmark"
        ? ["id", "target"]
        : nativeValues
          ? ["fields"]
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
        fields: reportedValues,
        nativeValues,
        pages: pagesOf(wholeBoard),
        pageId: page,
        onLook: setLook,
        onBehaviour: setBehaviour,
        onPage: stacked ? undefined : setPage,
        savedLooks,
        onSavedLooks: setSavedLooks,
        statusAddress:
          kind === "serviceWidget"
            ? {
                web: service.siteMonitor,
                ping: service.ping,
                href: service.href,
                onChange: (check, value) =>
                  setService({ ...service, [check === "ping" ? "ping" : "siteMonitor"]: value || "" }),
              }
            : kind === "service"
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
  const sections = lookSections(kind);
  const valuesShown =
    Boolean(boardPanel) &&
    valuesPartShown({
      show: sections,
      fields: reportedValues,
      nativeValues,
      effective: { ...lookProps.inheritedLook, ...look },
    });
  const summaries = boardPanel ? lookSummaries({ ...lookProps, savedLooks }) : {};
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
  const behaviourDetail = boardPanel
    ? sentence([
        sections.status && "status check",
        kind === "serviceWidget" && "link",
        sections.link && "on click",
        sections.values && "refresh",
        "on phones",
      ])
    : "Where the card's name takes you";
  if (!boardPanel) summaries.status = hostOf(service?.href);
  const guideName = selectedEntry?.name;
  const guided = Boolean(
    selectedEntry &&
    (selectedEntry.guide?.length > 0 ||
      selectedEntry.setupNotes?.length > 0 ||
      selectedEntry.secrets?.length > 0 ||
      selectedEntry.docs),
  );
  const submit = async (action = source ? "update" : "add") => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const contentChanged =
        action !== "update" || name !== initialName || serviceChanged || editorDraftChanged(initial, draft);
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
            {requiresName && (
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
            )}
            <div className="studio-sections">
              <Section
                title={settingsSection.title}
                detail={settingsSection.detail}
                summary={settingsSection.summary}
                attention={valid ? null : "Needs a fix"}
                {...sectionProps("settings")}
              >
                <ConfigForm
                  value={draft}
                  onChange={setDraft}
                  fields={fields}
                  knownKeys={hiddenKeys}
                  onValidity={setValid}
                  sectioned
                  connections={kind === "serviceWidget" || kind === "informationWidget"}
                  testable={kind === "serviceWidget" && (source?.type || selectedEntry?.type || true)}
                />
                {(kind === "serviceWidget" || kind === "informationWidget") &&
                  customApiMappingsMissing(source?.type || entry?.type, draft) && (
                    <p className="studio-callout studio-callout-warn" role="status">
                      This Custom API widget has no <code>mappings</code> yet, so its panel will be empty. Add at least
                      one in YAML. You can still save it now.
                    </p>
                  )}
              </Section>
              {boardPanel && valuesShown && (
                <Section
                  title="Values and charts"
                  detail={
                    sections.charts
                      ? "Which values show, their order, charts, warnings"
                      : "Which values show, their order, warnings"
                  }
                  summary={summaries.values}
                  {...sectionProps("values")}
                >
                  <LookEditor part="values" {...lookProps} />
                </Section>
              )}
              {boardPanel && (
                <Section
                  title="Look"
                  detail={`Saved looks, fill, colour, edge, corners${sections.logo ? ", header" : ""}`}
                  summary={summaries.look}
                  {...sectionProps("look")}
                >
                  <LookEditor part="look" {...lookProps} />
                </Section>
              )}
              {(boardPanel || kind === "serviceWidget") && (
                <Section
                  title={!boardPanel ? "Link" : sections.status ? "Status and behaviour" : "Behaviour"}
                  detail={behaviourDetail}
                  summary={summaries.status}
                  {...sectionProps("status")}
                >
                  {kind === "serviceWidget" && (
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
                  )}
                  {boardPanel && <LookEditor part="status" {...lookProps} />}
                </Section>
              )}
              {boardPanel && !stacked && lookProps.pages.length > 1 && (
                <Section
                  title="Page"
                  detail="Which page it is on"
                  summary={lookProps.pages.find((item) => item.id === page)?.name}
                  {...sectionProps("page")}
                >
                  <LookEditor part="page" {...lookProps} />
                </Section>
              )}
              {source && (
                <Section title="Management" detail="Duplicate or delete" {...sectionProps("manage")}>
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
                </Section>
              )}
              {guided && (
                <Section
                  title={guideName ? `Setting up ${guideName}` : "Setting it up"}
                  detail={
                    selectedEntry?.secrets?.length
                      ? `What ${guideName || "it"} needs and how to name its secrets`
                      : `What ${guideName || "it"} needs`
                  }
                  {...sectionProps("guide")}
                >
                  <Guide
                    blocks={selectedEntry?.guide}
                    notes={selectedEntry?.setupNotes}
                    secrets={selectedEntry?.secrets}
                    name={guideName}
                    docs={selectedEntry?.docs}
                  />
                </Section>
              )}
            </div>
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
