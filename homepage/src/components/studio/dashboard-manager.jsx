import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { deploymentRequest } from "./api.mjs";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";

const endpoint = "/__studio/api/dashboards";
const address = (entry) => (entry.slug ? `/${entry.slug}` : "/");
const navigate = (path) => window.location.assign(path);

function newCopySlug(entry, dashboards) {
  const base = `${(entry.slug || "main").slice(0, 54)}-copy`;
  let slug = base;
  let number = 2;
  while (dashboards.some((item) => item.slug === slug)) slug = `${base}-${number++}`;
  return slug;
}

export default function DashboardManager({ currentDashboard = { id: "default" }, onClose, onNavigate = navigate }) {
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const inFlight = useRef(false);
  const keepEditing = useRef(null);
  const nameField = useRef(null);
  const dirty = Boolean(form && editorDraftChanged(form.initial, draft));
  useEditorDraft(dirty, pending);
  useEffect(() => {
    let mounted = true;
    deploymentRequest(endpoint).then(
      (result) => {
        if (mounted) {
          setRegistry(result);
          setLoading(false);
        }
      },
      (reason) => {
        if (mounted) {
          setError(reason);
          setLoading(false);
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (discard) keepEditing.current?.focus();
    else if (form) nameField.current?.focus();
  }, [form, discard]);

  const reviewLatest = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const latest = await deploymentRequest(endpoint);
      setRegistry(latest);
      setLoading(false);
      setError(null);
      setConflict(false);
      setNotice(
        form
          ? "The latest dashboard list is loaded. Review your draft before saving again."
          : "Dashboard list refreshed.",
      );
    } catch (reason) {
      setError(reason);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const begin = (action, entry) => {
    if (inFlight.current) return;
    let initial;
    if (action === "archive") initial = { confirmed: false };
    else if (action === "update") initial = { name: entry.name, slug: entry.slug };
    else
      initial = entry
        ? { name: `${entry.name.slice(0, 95)} copy`, slug: newCopySlug(entry, registry.dashboards), sourceId: entry.id }
        : { name: "", slug: "", sourceId: "" };
    setForm({ action, id: entry?.id, initial, duplicate: action === "create" && Boolean(entry) });
    setDraft(structuredClone(initial));
    setError(null);
    setConflict(false);
    setNotice("");
  };
  const clearForm = () => {
    setForm(null);
    setDraft(null);
    setDiscard(false);
    setError(null);
    setConflict(false);
  };
  const back = () => {
    if (pending) return;
    if (dirty) setDiscard(true);
    else clearForm();
  };
  const mutate = async (action, fields) => {
    if (inFlight.current || !registry || conflict) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice("");
    const before = registry.dashboards.find((entry) => entry.id === fields.id);
    try {
      const result = await deploymentRequest(endpoint, { revision: registry.revision, action, ...fields });
      setRegistry(result.registry);
      clearForm();
      setNotice(
        action === "archive"
          ? "Dashboard archived. Its configuration and snapshots are retained."
          : action === "restore"
            ? "Dashboard restored."
            : "Dashboard saved.",
      );
      if (action === "update" && result.dashboard.id === currentDashboard.id && before?.slug !== result.dashboard.slug)
        onNavigate(address(result.dashboard));
      if (action === "archive" && result.dashboard.id === currentDashboard.id)
        onNavigate(address(result.registry.dashboards.find((item) => item.id === "default")));
    } catch (reason) {
      setError(reason);
      if (reason.status === 409) setConflict(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    if (!form || pending || conflict) return;
    if (form.action === "archive") {
      if (draft.confirmed) mutate("archive", { id: form.id, confirmed: true });
    } else if (form.action === "update") mutate("update", { id: form.id, name: draft.name.trim(), slug: draft.slug });
    else
      mutate("create", {
        name: draft.name.trim(),
        slug: draft.slug,
        ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
      });
  };
  const entry = registry?.dashboards.find((item) => item.id === form?.id);
  const active = registry?.dashboards.filter((item) => !item.archived) || [];
  const archived = registry?.dashboards.filter((item) => item.archived) || [];

  return (
    <div aria-busy={pending || loading || undefined}>
      <div className="studio-dialog-body">
        <p className="studio-note">
          Each dashboard has its own widgets, layout, appearance, native files and recovery snapshots. Addresses share
          this deployment’s hostname.
        </p>
        <ErrorMessage error={conflict ? null : error} />
        {conflict && (
          <div className="studio-error" role="alert">
            <strong>Another dashboard change was saved</strong>
            <p>{error?.message}</p>
            <p>Your draft is still here. Load the latest dashboard list, review your draft, then save again.</p>
            <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={reviewLatest}>
              Review latest dashboard list
            </button>
          </div>
        )}
        {notice && (
          <p className="studio-note" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">Loading dashboards…</p>
        ) : !registry ? (
          <button type="button" className="studio-button" disabled={pending} onClick={reviewLatest}>
            Try again
          </button>
        ) : form ? (
          <>
            {discard && (
              <section className="studio-dashboard-discard" aria-label="Discard dashboard draft">
                <h3>Discard unsaved changes?</h3>
                <p>Your dashboard draft has not been saved.</p>
                <div className="studio-inline-actions">
                  <button
                    ref={keepEditing}
                    type="button"
                    className="studio-button studio-primary"
                    onClick={() => setDiscard(false)}
                  >
                    Keep editing
                  </button>
                  <button type="button" className="studio-button studio-quiet" onClick={clearForm}>
                    Discard changes
                  </button>
                </div>
              </section>
            )}
            <form onSubmit={submit} hidden={discard} inert={discard}>
              <fieldset disabled={pending} style={editorFieldsetStyle}>
                <h3>
                  {form.action === "archive"
                    ? `Archive ${entry?.name || "dashboard"}?`
                    : form.action === "update"
                      ? "Edit dashboard"
                      : form.duplicate
                        ? "Duplicate dashboard"
                        : "Create dashboard"}
                </h3>
                {form.action === "archive" ? (
                  <>
                    <p className="studio-note">
                      The address {entry && address(entry)} will stop serving this dashboard. Its files, settings and
                      snapshots stay available for restoration, and its address remains reserved.
                    </p>
                    {form.id === currentDashboard.id && (
                      <p className="studio-note">Your main dashboard will open after this page is archived.</p>
                    )}
                    <label className="studio-check">
                      <input
                        ref={nameField}
                        type="checkbox"
                        checked={draft.confirmed}
                        onChange={(event) => setDraft({ confirmed: event.target.checked })}
                      />{" "}
                      I want to archive this dashboard
                    </label>
                  </>
                ) : (
                  <div className="studio-fields-grid">
                    <label className="studio-field">
                      <span>Dashboard name</span>
                      <input
                        ref={nameField}
                        required
                        maxLength={100}
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label className="studio-field">
                      <span id="studio-dashboard-slug-label">Address slug</span>
                      <input
                        aria-labelledby="studio-dashboard-slug-label"
                        aria-describedby="studio-dashboard-slug-help"
                        required={form.id !== "default"}
                        maxLength={64}
                        pattern="[a-z0-9]+(?:-+[a-z0-9]+)*"
                        value={draft.slug}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                      />
                      <small id="studio-dashboard-slug-help">
                        Lowercase letters, numbers and hyphens.{" "}
                        {form.id === "default"
                          ? "Leave empty to use the root address."
                          : "Choose one path segment, without slashes."}
                      </small>
                    </label>
                    {form.action === "create" && (
                      <label className="studio-field">
                        <span id="studio-dashboard-source-label">Starting configuration</span>
                        <select
                          aria-labelledby="studio-dashboard-source-label"
                          aria-describedby="studio-dashboard-source-help"
                          value={draft.sourceId}
                          onChange={(event) => setDraft({ ...draft, sourceId: event.target.value })}
                        >
                          <option value="">Empty dashboard</option>
                          {active.map((item) => (
                            <option key={item.id} value={item.id}>
                              Copy {item.name}
                            </option>
                          ))}
                        </select>
                        <small id="studio-dashboard-source-help">
                          A copy receives its own identity and configuration. Later changes remain independent.
                        </small>
                      </label>
                    )}
                    <p className="studio-note">
                      Dashboard address: <code>{draft.slug ? `/${draft.slug}` : "/"}</code>
                    </p>
                  </div>
                )}
                {form.action === "update" && entry && (
                  <p className="studio-note">
                    Currently saved: {entry.name} at <code>{address(entry)}</code>.
                  </p>
                )}
                <div className="studio-dashboard-form-actions">
                  <button type="button" className="studio-button studio-quiet" onClick={back}>
                    Back to dashboards
                  </button>
                  <button
                    className="studio-button studio-primary"
                    disabled={pending || conflict || (form.action === "archive" && !draft.confirmed)}
                  >
                    {pending
                      ? "Saving…"
                      : form.action === "archive"
                        ? "Archive dashboard"
                        : form.action === "update"
                          ? "Save dashboard"
                          : "Create dashboard"}
                  </button>
                </div>
              </fieldset>
            </form>
          </>
        ) : (
          <>
            <button
              type="button"
              className="studio-button studio-primary"
              disabled={pending}
              onClick={() => begin("create")}
            >
              Create dashboard
            </button>
            <div className="studio-dashboard-list">
              {active.map((item) => (
                <section className="studio-dashboard-row" key={item.id} aria-label={`Dashboard ${item.name}`}>
                  <div className="studio-dashboard-identity">
                    <strong>{item.name}</strong>
                    <code>{address(item)}</code>
                    {item.id === currentDashboard.id && <small>Current dashboard</small>}
                  </div>
                  <div className="studio-dashboard-actions">
                    <button
                      type="button"
                      className="studio-button studio-quiet"
                      disabled={pending}
                      onClick={() => onNavigate(address(item))}
                      aria-label={`Open ${item.name}`}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="studio-button studio-quiet"
                      disabled={pending}
                      onClick={() => begin("update", item)}
                      aria-label={`Edit ${item.name}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="studio-button studio-quiet"
                      disabled={pending}
                      onClick={() => begin("create", item)}
                      aria-label={`Duplicate ${item.name}`}
                    >
                      Duplicate
                    </button>
                    {item.id !== "default" && (
                      <button
                        type="button"
                        className="studio-text-button"
                        disabled={pending}
                        onClick={() => begin("archive", item)}
                        aria-label={`Archive ${item.name}`}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
            {archived.length > 0 && (
              <>
                <h3>Archived dashboards</h3>
                <div className="studio-dashboard-list">
                  {archived.map((item) => (
                    <section
                      className="studio-dashboard-row"
                      key={item.id}
                      aria-label={`Archived dashboard ${item.name}`}
                    >
                      <div className="studio-dashboard-identity">
                        <strong>{item.name}</strong>
                        <code>{address(item)}</code>
                      </div>
                      <button
                        type="button"
                        className="studio-button studio-quiet"
                        disabled={pending || conflict}
                        onClick={() => mutate("restore", { id: item.id })}
                        aria-label={`Restore ${item.name}`}
                      >
                        Restore
                      </button>
                    </section>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  );
}
