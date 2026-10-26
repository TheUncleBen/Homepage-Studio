import { useEffect, useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import ConfigForm, { LINK_FIELDS, SERVICE_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import StudioIcon from "./icons";
import { patchFromDraft, sourceForPanel } from "./native-adapter.mjs";
import { ActionRow, Group, Row } from "./ui";

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
      description: "A link to an app, with native status and statistics.",
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
}) {
  const kind = panel?.kind || entry.kind;
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
  const [deleting, setDeleting] = useState(false);
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
      editorDraftChanged(initial, draft),
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
  const fields =
    kind === "service"
      ? SERVICE_FIELDS
      : kind === "bookmark"
        ? [...LINK_FIELDS, { key: "abbr", label: "Abbreviation", type: "string" }]
        : selectedEntry?.fields || [];
  const changedGroup = source?.group === group ? source?.groupPath || group : group;
  const submit = async (action = source ? "update" : "add") => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const body = {
        revision: state.revision,
        action,
        ...(source ? { id: source.id } : {}),
        config: patchFromDraft(initial, draft),
      };
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
      <div className="studio-dialog-body">
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
          <ConfigForm
            value={draft}
            onChange={setDraft}
            fields={fields}
            onValidity={setValid}
            docs={selectedEntry?.docs}
            guide={selectedEntry?.guide}
            setupNotes={selectedEntry?.setupNotes}
            name={selectedEntry?.name}
          />
          {(kind === "serviceWidget" || kind === "informationWidget") &&
            customApiMappingsMissing(source?.type || entry?.type, draft) && (
              <p className="studio-callout studio-callout-warn" role="status">
                This Custom API widget has no <code>mappings</code> yet, so its panel will be empty. Add at least one in
                YAML. You can still save it now.
              </p>
            )}
          {source && (
            <Group className="studio-item-actions">
              <ActionRow
                icon="copy"
                disabled={pending}
                onClick={() => {
                  // Duplicate the saved source. Switching away from an edited
                  // source asks before discarding its local changes.
                  const copy = structuredClone(initial);
                  if (kind === "service" || kind === "bookmark") delete copy.id;
                  onDuplicate({
                    ...selectedEntry,
                    kind,
                    type: source.type || kind,
                    name: selectedEntry?.name || LABEL[kind],
                    defaults: copy,
                    seed: {
                      name: `${source.name || parent?.name || selectedEntry?.name || "Widget"} copy`,
                      group: source.group || parent?.group || "Dashboard",
                      serviceId: source.serviceId,
                    },
                  });
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
