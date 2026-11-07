import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { Group, Row, Segmented, revealForm } from "./ui";

// Saved connections (server/connections.mjs): a service address and its key,
// typed once, named, and reused on any widget. A widget that uses one holds
// placeholders, never the key; the dashboard fills them in on the server.
export const CONNECTION_FIELDS = ["url", "key", "username", "password"];
const SECRET_FIELDS = ["key", "username", "password"];
const PLACEHOLDER = /^\{\{STUDIO_CONNECTION_([A-F0-9]{16})_(URL|KEY|USERNAME|PASSWORD)\}\}$/;
const FIELD_LABELS = { key: "Key", username: "User name", password: "Password" };

export const connectionPlaceholder = (id, field) => `{{STUDIO_CONNECTION_${id}_${field.toUpperCase()}}}`;
export const isConnectionPlaceholder = (text) => typeof text === "string" && PLACEHOLDER.test(text);
export const savedConnectionId = (value) => PLACEHOLDER.exec(value?.url ?? "")?.[1] ?? null;

// The widget's settings pointed at a connection: its address always, and
// each secret the connection has and the widget can take.
export function withConnection(value, connection, keys) {
  const next = withoutConnection(value);
  for (const field of CONNECTION_FIELDS) {
    if (!keys.includes(field)) continue;
    if (field === "url" || connection.has?.[field]) next[field] = connectionPlaceholder(connection.id, field);
  }
  return next;
}

export function withoutConnection(value) {
  const next = { ...value };
  for (const field of CONNECTION_FIELDS) if (isConnectionPlaceholder(next[field])) delete next[field];
  return next;
}

// Whether this person is a Studio administrator (or sign-in is off).
export function useStudioAdmin() {
  const { data: access } = useSWR("/studio/api/access", studioRequest);
  return !access?.authEnabled || access?.user?.role === "admin";
}

// Both ways out of a certificate failure (UI review M2), naming
// Administration only to people who can open it.
export function certificateRemedy(admin, where = "") {
  return admin
    ? `Add its authority in Administration › Trusted certificates, or turn off Check its certificate${where}.`
    : `Turn off Check its certificate${where}, or ask an administrator to add its authority in Trusted certificates.`;
}

export function useSavedConnections() {
  const { data: access } = useSWR("/studio/api/access", studioRequest);
  const personal = Boolean(access?.authEnabled && access.user);
  const here = useSWR("/studio/api/connections", studioRequest);
  const mine = useSWR(personal ? "/studio/api/my-connections" : null, studioRequest);
  return {
    personal,
    dashboard: here.data?.connections ?? null,
    mine: mine.data?.connections ?? null,
    error: here.error || mine.error,
    reload: () => Promise.all([here.mutate(), personal ? mine.mutate() : null]),
  };
}

const usedText = (count) =>
  count ? `Used by ${count} widget${count === 1 ? "" : "s"}` : "Not used by any saved widget yet";

// Data › Connection in the widget dialog: use a saved connection, or type the
// address and key here. Hidden while there is nothing saved to choose (Rule 1).
export function ConnectionChooser({ value, keys, saved, onSaved, onChange }) {
  const { personal, dashboard, mine, reload } = useSavedConnections();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const id = savedConnectionId(value);
  const others = (mine || []).filter((entry) => !dashboard?.some((item) => item.id === entry.id));
  if (!id && !saved && !dashboard?.length && !others.length) return null;
  const current = dashboard?.find((entry) => entry.id === id);
  const choose = async (choice) => {
    setError("");
    setBusy(true);
    try {
      let connection = dashboard?.find((entry) => entry.id === choice);
      // A personal connection is copied onto this dashboard before it is used.
      if (!connection) ({ connection } = await studioRequest("/studio/api/my-connections/use", { id: choice }));
      await reload();
      onChange(withConnection(value, connection, keys));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Row label="Use">
        <Segmented
          label="Where this widget's connection comes from"
          value={saved ? "saved" : "here"}
          onChange={(next) => {
            setError("");
            if (next === "here") onChange(withoutConnection(value));
            onSaved(next === "saved");
          }}
          options={[
            ["saved", "Saved connection"],
            ["here", "Enter here"],
          ]}
        />
      </Row>
      {saved && (
        <Row
          label="Connection"
          htmlFor={selectId}
          info="The address and key are kept on the server and filled in when the dashboard loads. Change them in dashboard settings under Saved connections; every widget that uses the connection follows."
        >
          <select
            id={selectId}
            value={id || ""}
            disabled={busy}
            onChange={(event) => event.target.value && choose(event.target.value)}
          >
            {!id && <option value="">Choose a connection</option>}
            {id && !current && <option value={id}>A connection that no longer exists</option>}
            {dashboard?.length > 0 && (
              <optgroup label="This dashboard">
                {dashboard.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
            {personal && others.length > 0 && (
              <optgroup label="Just me">
                {others.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Row>
      )}
      {saved && current && (
        <p className="studio-muted studio-connection-detail">
          {current.url} · {usedText(current.usedBy?.length || 0)}
        </p>
      )}
      {saved && id && !current && dashboard && (
        <p className="studio-callout studio-callout-warn" role="status">
          This widget uses a saved connection that was removed. Choose another one, or enter the address here.
        </p>
      )}
      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// Test connection: runs the widget's own first request with what is in the
// dialog (a saved connection's key stays on the server) and says in plain
// words what happened. Shown once there is an address to test.
export function ConnectionTest({ value, skipCertificateCheck = false }) {
  const [state, setState] = useState(null);
  const admin = useStudioAdmin();
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url || typeof value.type !== "string") return null;
  const run = async () => {
    setState({ busy: true });
    try {
      setState(
        await studioRequest("/studio/api/connection-test", {
          widget: value,
          ...(skipCertificateCheck ? { skipCertificateCheck: true } : {}),
        }),
      );
    } catch (failure) {
      setState({ ok: false, message: failure.message });
    }
  };
  return (
    <div className="studio-inline-actions studio-connection-test">
      <button type="button" className="studio-button studio-quiet" disabled={state?.busy} onClick={run}>
        {state?.busy ? "Testing…" : "Test connection"}
      </button>
      <p
        className={`studio-connection-result${state && !state.busy ? (state.ok ? " studio-ok" : " studio-failed") : ""}`}
        role="status"
      >
        {state && !state.busy
          ? state.kind === "certificate"
            ? `${state.message} ${certificateRemedy(admin, " below")}`
            : state.message
          : ""}
      </p>
    </div>
  );
}

// Under typed-in connection settings: keep them as a named connection to
// reuse on other widgets. Shown once there is an address to save.
export function ConnectionSave({ value, keys, onChange, onSaved }) {
  const { personal, dashboard, reload } = useSavedConnections();
  const [form, setForm] = useState(null);
  const formBox = useRef(null);
  // The form opens at the foot of the Connection section: bring it into view.
  const formOpen = Boolean(form);
  useEffect(() => {
    if (formOpen) revealForm(formBox.current);
  }, [formOpen]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url || isConnectionPlaceholder(url) || !dashboard) return null;
  const open = () => {
    let name = "";
    try {
      name = new URL(url).hostname;
    } catch {
      // The server explains a bad address when it is saved.
    }
    setError("");
    setForm({ name, place: "dashboard" });
  };
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const secrets = Object.fromEntries(
        SECRET_FIELDS.filter((field) => keys.includes(field) && typeof value[field] === "string" && value[field]).map(
          (field) => [field, value[field]],
        ),
      );
      const body = { action: "add", name: form.name, url, ...secrets };
      let connection;
      if (form.place === "personal") {
        const { connection: mine } = await studioRequest("/studio/api/my-connections", body);
        ({ connection } = await studioRequest("/studio/api/my-connections/use", { id: mine.id }));
      } else ({ connection } = await studioRequest("/studio/api/connections", body));
      await reload();
      setForm(null);
      onChange(withConnection(value, connection, keys));
      onSaved(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  if (!form)
    return (
      <div className="studio-inline-actions studio-connection-save">
        <button type="button" className="studio-button studio-quiet" onClick={open}>
          Save as a connection…
        </button>
      </div>
    );
  return (
    <div className="studio-connection-form" role="group" aria-label="Save as a connection" ref={formBox}>
      <Row label="Name" htmlFor={nameId}>
        <input
          id={nameId}
          value={form.name}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (form.name.trim() && !busy) save();
            }
          }}
        />
      </Row>
      {personal && (
        <Row label="Who can use it">
          <Segmented
            label="Who can use it"
            value={form.place}
            onChange={(place) => setForm({ ...form, place })}
            options={[
              ["personal", "Just me"],
              ["dashboard", "This dashboard"],
            ]}
          />
        </Row>
      )}
      <p className="studio-muted">
        The key stays on the server and is never shown again, only replaced. This widget then uses the connection.
      </p>
      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-inline-actions">
        <button type="button" className="studio-button studio-quiet" disabled={busy} onClick={() => setForm(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={busy || !form.name.trim()}
          onClick={save}
        >
          {busy ? "Saving…" : "Save connection"}
        </button>
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: "", url: "", key: "", username: "", password: "", clear: [] };

function ConnectionForm({ entry, personal, onDone, onCancel }) {
  const [form, setForm] = useState(() =>
    entry ? { ...EMPTY_FORM, name: entry.name, url: entry.url } : { ...EMPTY_FORM, place: "dashboard" },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();
  const set = (key, text) => setForm({ ...form, [key]: text });
  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const path =
        (entry ? entry.place : form.place) === "personal" ? "/studio/api/my-connections" : "/studio/api/connections";
      const secrets = Object.fromEntries(
        SECRET_FIELDS.filter((field) => form[field]).map((field) => [field, form[field]]),
      );
      await studioRequest(
        path,
        entry
          ? {
              action: "update",
              id: entry.id,
              name: form.name,
              url: form.url,
              ...secrets,
              ...(form.clear.length ? { clear: form.clear } : {}),
            }
          : { action: "add", name: form.name, url: form.url, ...secrets },
      );
      await onDone();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="studio-connection-form"
      aria-label={entry ? `Change ${entry.name}` : "New connection"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
    >
      <Row label="Name" htmlFor={`${base}-name`}>
        <input
          id={`${base}-name`}
          value={form.name}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => set("name", event.target.value)}
        />
      </Row>
      <Row label="Address" htmlFor={`${base}-url`}>
        <input
          id={`${base}-url`}
          value={form.url}
          inputMode="url"
          autoComplete="off"
          placeholder="https://service.example.org"
          onChange={(event) => set("url", event.target.value)}
        />
      </Row>
      {SECRET_FIELDS.map((field) => {
        const kept = entry?.has?.[field] && !form.clear.includes(field);
        return (
          <Row key={field} label={FIELD_LABELS[field]} htmlFor={`${base}-${field}`}>
            <input
              id={`${base}-${field}`}
              type={field === "username" ? "text" : "password"}
              value={form[field]}
              autoComplete="off"
              placeholder={kept ? "Saved. Type to replace it." : "Optional"}
              onChange={(event) =>
                setForm({ ...form, [field]: event.target.value, clear: form.clear.filter((item) => item !== field) })
              }
            />
            {kept && (
              <button
                type="button"
                className="studio-button studio-quiet"
                aria-label={`Remove the saved ${FIELD_LABELS[field].toLowerCase()}`}
                onClick={() => setForm({ ...form, [field]: "", clear: [...form.clear, field] })}
              >
                Remove
              </button>
            )}
          </Row>
        );
      })}
      {!entry && personal && (
        <Row label="Who can use it">
          <Segmented
            label="Who can use it"
            value={form.place}
            onChange={(place) => set("place", place)}
            options={[
              ["personal", "Just me"],
              ["dashboard", "This dashboard"],
            ]}
          />
        </Row>
      )}
      {error && (
        <p className="studio-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-inline-actions">
        <button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="studio-button studio-primary" disabled={busy || !form.name.trim() || !form.url.trim()}>
          {busy ? "Saving…" : entry ? "Save changes" : "Add connection"}
        </button>
      </div>
    </form>
  );
}

function ConnectionList({ title, info, entries, place, personal, editing, onEdit, onRemove, busy, onDone }) {
  if (!entries?.length) return null;
  return (
    <Group title={title} info={info}>
      {entries.map((entry) =>
        editing === entry.id ? (
          <ConnectionForm
            key={entry.id}
            entry={{ ...entry, place }}
            personal={personal}
            onDone={onDone}
            onCancel={() => onEdit(null)}
          />
        ) : (
          <div key={entry.id} className="studio-row studio-connection-row">
            <div className="studio-row-main">
              <span className="studio-row-label">
                <span>{entry.name}</span>
              </span>
              <div className="studio-row-control">
                <button
                  type="button"
                  className="studio-button studio-quiet"
                  aria-label={`Change ${entry.name}`}
                  disabled={busy}
                  onClick={() => onEdit(entry.id)}
                >
                  Change
                </button>
                <button
                  type="button"
                  className="studio-button studio-quiet"
                  aria-label={`Remove ${entry.name}`}
                  disabled={busy}
                  onClick={() => onRemove(entry, place)}
                >
                  Remove
                </button>
              </div>
            </div>
            <p className="studio-muted studio-connection-detail">
              {entry.url}
              {SECRET_FIELDS.some((field) => entry.has?.[field])
                ? ` · ${SECRET_FIELDS.filter((field) => entry.has[field])
                    .map((field) => FIELD_LABELS[field].toLowerCase())
                    .join(", ")} saved`
                : ""}
              {place === "dashboard" ? ` · ${usedText(entry.usedBy?.length || 0)}` : ""}
            </p>
          </div>
        ),
      )}
    </Group>
  );
}

// Dashboard settings › Saved connections.
export function ConnectionsEditor({ onClose }) {
  const { personal, dashboard, mine, error: loadError, reload } = useSavedConnections();
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = async () => {
    await reload();
    setEditing(null);
  };
  const remove = async (entry, place) => {
    setError(null);
    setBusy(true);
    try {
      await studioRequest(place === "personal" ? "/studio/api/my-connections" : "/studio/api/connections", {
        action: "delete",
        id: entry.id,
      });
      await reload();
    } catch (failure) {
      const usedBy = failure.details?.details?.usedBy;
      setError(
        usedBy?.length
          ? `${entry.name} is still used by ${usedBy.join(", ")}. Change those widgets first.`
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  };
  const loading = !dashboard && !loadError;
  const empty = dashboard && !dashboard.length && !mine?.length;
  return (
    <>
      <div className="studio-dialog-body">
        <p className="studio-note">
          Type a service address and key once and reuse them on any widget. Keys stay on the server and are never shown
          again, only replaced. Changing a connection updates every widget that uses it.
        </p>
        {(loadError || error) && (
          <p className="studio-callout studio-callout-warn" role="alert">
            {error || loadError.message}
          </p>
        )}
        {loading && <p className="studio-muted">Loading…</p>}
        {empty && editing !== "new" && <p className="studio-empty-note">No saved connections yet.</p>}
        <ConnectionList
          title="This dashboard"
          info="Anyone who can change this dashboard's widgets can use these. Duplicating the dashboard copies them."
          entries={dashboard}
          place="dashboard"
          personal={personal}
          editing={editing}
          onEdit={setEditing}
          onRemove={remove}
          busy={busy}
          onDone={done}
        />
        <ConnectionList
          title="Just me"
          info="Only you see these, on any dashboard you can change. Using one on a widget copies it to that dashboard."
          entries={personal ? mine : null}
          place="personal"
          personal={personal}
          editing={editing}
          onEdit={setEditing}
          onRemove={remove}
          busy={busy}
          onDone={done}
        />
        {editing === "new" ? (
          <Group title="New connection">
            <ConnectionForm personal={personal} onDone={done} onCancel={() => setEditing(null)} />
          </Group>
        ) : (
          !loading &&
          !editing && (
            <div className="studio-inline-actions">
              <button type="button" className="studio-button" disabled={busy} onClick={() => setEditing("new")}>
                Add connection
              </button>
            </div>
          )
        )}
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </>
  );
}
