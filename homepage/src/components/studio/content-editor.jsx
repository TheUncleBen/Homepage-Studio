import { useEffect, useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import ConfigForm, { LINK_FIELDS, SERVICE_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import {
  editorDraftChanged,
  editorFieldsetStyle,
  useEditorDraft,
} from "./draft-guard";
import StudioIcon from "./icons";
import { patchFromDraft, sourceForPanel } from "./native-adapter.mjs";

// A Custom API widget renders only its mappings, so without any it shows an
// empty native panel. This is valid YAML, so the editor hints instead of
// blocking the save.
export function customApiMappingsMissing(type, config) {
  if (type !== "customapi") return false;
  const mappings = config?.mappings;
  if (mappings === undefined || mappings === null || mappings === "")
    return true;
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
  ].filter(
    (entry) =>
      (category === "all" || entry.kind === category) &&
      `${entry.name} ${entry.type} ${entry.description || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
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
              placeholder="Search native widgets and tiles…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav
            className="studio-tabs studio-picker-tabs"
            aria-label="Content categories"
          >
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
          <p className="studio-note">
            Native Homepage content, with a separate panel for every instance.
            Integration credentials stay in your local configuration.
          </p>
          {Boolean(state?.hiddenDiscoveredIds?.length) && (
            <details className="studio-hidden-discovered">
              <summary>
                Hidden discovered panels ({state.hiddenDiscoveredIds.length})
              </summary>
              <div className="studio-stack-candidates">
                {(state.discoveredSources || [])
                  .filter((source) =>
                    state.hiddenDiscoveredIds.includes(source.id),
                  )
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
                        {restoring === source.id
                          ? "Restoring…"
                          : "Restore to dashboard"}
                        {" · "}
                        {source.group}
                      </small>
                    </button>
                  ))}
              </div>
            </details>
          )}
          <div className="studio-catalog">
            {entries.map((entry) => (
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
                  <small>{entry.description || LABEL[entry.kind]}</small>
                </span>
                <StudioIcon name="chevron" size={15} />
              </button>
            ))}
          </div>
          {!entries.length && (
            <p className="studio-muted">No native widgets match that search.</p>
          )}
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
  const parent = state.services?.find(
    (service) => service.id === source?.serviceId,
  );
  const selectedEntry =
    entry ||
    (kind === "serviceWidget" ? catalog.service : catalog.info)?.find(
      (item) => item.type === source?.type,
    );
  const initial = source?.config || selectedEntry?.defaults || {};
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const initialName =
    source?.name ||
    entry?.seed?.name ||
    (kind === "serviceWidget" ? selectedEntry?.name || "" : "");
  const initialGroup =
    source?.group || entry?.seed?.group || parent?.group || "Dashboard";
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
      deleteConfirm.current?.scrollIntoView?.({ block: "nearest" });
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
        ? [
            ...LINK_FIELDS,
            { key: "abbr", label: "Abbreviation", type: "string" },
          ]
        : selectedEntry?.fields || [];
  const changedGroup =
    source?.group === group ? source?.groupPath || group : group;
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
      if (kind === "informationWidget" || kind === "serviceWidget")
        body.type = source?.type || entry.type;
      if (kind === "serviceWidget" && !source) {
        if (serviceId === "new") body.newService = { name, group };
        else body.serviceId = serviceId;
      }
      const result = await studioRequest(
        `/__studio/api/${ENDPOINT[kind]}`,
        body,
      );
      await onSaved(result);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const requiresName =
    kind === "service" ||
    kind === "bookmark" ||
    (kind === "serviceWidget" && !source && serviceId === "new");
  const disabled =
    !valid || pending || (requiresName && (!name.trim() || !group.trim()));
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
          {kind === "serviceWidget" && !source && (
            <div className="studio-field">
              <label htmlFor="studio-service-context">Service context</label>
              <select
                id="studio-service-context"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
              >
                <option value="new">Create a new service context</option>
                {state.services?.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.group} / {service.name}
                  </option>
                ))}
              </select>
              <small className="studio-muted">
                Native integrations belong to a service. A new context without a
                URL creates just this widget.
              </small>
            </div>
          )}
          {requiresName && (
            <div className="studio-fields-grid studio-identity-fields">
              <div className="studio-field">
                <label htmlFor="studio-source-name">Name</label>
                <input
                  id="studio-source-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={200}
                  placeholder="Name this panel"
                />
              </div>
              <div className="studio-field">
                <label htmlFor="studio-source-group">Group</label>
                <input
                  id="studio-source-group"
                  list="studio-groups"
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  required
                />
                <datalist id="studio-groups">
                  {[
                    ...new Set([
                      ...(state.groups || []).map(
                        (item) => item.label || item.name,
                      ),
                      ...(state.bookmarks || []).map((item) => item.group),
                    ]),
                  ].map((item) => (
                    <option value={item} key={item} />
                  ))}
                </datalist>
              </div>
            </div>
          )}
          {parent && (
            <p className="studio-note">
              Service context: {parent.group} / {parent.name}.{" "}
              <button
                type="button"
                className="studio-text-button"
                disabled={pending}
                onClick={() => onParent(parent)}
              >
                Edit service name, group and link
              </button>
            </p>
          )}
          {kind === "informationWidget" && (
            <p className="studio-note">
              {selectedEntry?.name || source?.type || entry.type} is a native
              information widget. Each instance can move, resize and join a
              stack independently.
            </p>
          )}
          <ConfigForm
            value={draft}
            onChange={setDraft}
            fields={fields}
            onValidity={setValid}
            docs={selectedEntry?.docs}
            notice={selectedEntry?.coverage}
          />
          {kind === "serviceWidget" &&
            customApiMappingsMissing(source?.type || entry?.type, draft) && (
              <p className="studio-note" role="status">
                This Custom API widget has no <code>mappings</code> yet, so its
                panel will be empty. Add at least one mapping (the response
                field and the label to show) in the options above or in Advanced
                YAML. You can still save it now.
              </p>
            )}
          {selectedEntry?.setupNotes?.map((note, index) => (
            <p key={index} className="studio-note">
              {note}
            </p>
          ))}
          {deleting && (
            <div
              ref={deleteConfirm}
              className="studio-delete-confirm"
              role="alert"
            >
              <strong>Delete {panel?.title || "this item"}?</strong>
              <p>
                {kind === "service"
                  ? "This removes the service and its configured widgets. Other dashboard content is kept."
                  : "This removes its native configuration and panel. A pre-change snapshot is retained."}
              </p>
              <div className="studio-inline-actions">
                <button
                  type="button"
                  className="studio-button studio-danger"
                  disabled={pending}
                  onClick={() => submit("delete")}
                >
                  Delete permanently
                </button>
                <button
                  ref={keepButton}
                  type="button"
                  className="studio-button studio-quiet"
                  onClick={() => setDeleting(false)}
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </fieldset>
      </div>
      <footer className="studio-dialog-footer">
        {source && (
          <>
            <button
              ref={deleteButton}
              type="button"
              className="studio-text-button studio-danger-text"
              disabled={pending}
              onClick={() => setDeleting(true)}
            >
              <StudioIcon name="trash" size={16} />
              Delete
            </button>
            <button
              type="button"
              className="studio-text-button"
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
            </button>
          </>
        )}
        <span className="studio-footer-spacer" />
        <button
          type="button"
          className="studio-button studio-quiet"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="studio-button studio-primary"
          disabled={disabled}
        >
          {pending ? "Saving…" : source ? "Save changes" : "Add to dashboard"}
        </button>
      </footer>
    </form>
  );
}
