import { useRef, useState } from "react";

import { FILES, studioRequest } from "./api.mjs";
import AppearanceEditor from "./appearance-editor";
import ConfigForm, { SETTINGS_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import { patchFromDraft } from "./native-adapter.mjs";

const buildRevision = process.env.NEXT_PUBLIC_REVISION;
const sourceUrl = `https://github.com/TheUncleBen/Homepage-Studio${/^[a-f0-9]{40}$/i.test(buildRevision || "") ? `/tree/${buildRevision}` : ""}`;

export function downloadFile(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsEditor({
  state,
  onSaved,
  onClose,
  onOpenFiles,
  onOpenBackups,
  onOpenDashboards,
  onReload,
}) {
  const original = state.settingsConfig || {};
  const [draft, setDraft] = useState(() => structuredClone(original));
  const [valid, setValid] = useState(true);
  const [appearanceValid, setAppearanceValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  useEditorDraft(!valid || !appearanceValid || editorDraftChanged(original, draft), pending);
  const save = async (event) => {
    event.preventDefault();
    if (pending || !valid || !appearanceValid) return;
    setError(null);
    setPending(true);
    try {
      await onSaved(
        await studioRequest("/__studio/api/settings", {
          revision: state.revision,
          config: patchFromDraft(original, draft),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={save}>
      <div className="studio-dialog-body">
        <ErrorMessage error={error} onReload={onReload} />
        <fieldset disabled={pending} style={editorFieldsetStyle}>
          <div className="studio-settings-shortcuts">
            {onOpenDashboards && (
              <button type="button" onClick={onOpenDashboards}>
                <strong>Manage dashboards</strong>
                <span>Independent dashboards and their addresses</span>
              </button>
            )}
            <button type="button" onClick={onOpenFiles}>
              <strong>Configuration files</strong>
              <span>All nine native files, with YAML and code editing</span>
            </button>
            <button type="button" onClick={onOpenBackups}>
              <strong>Snapshots & restore</strong>
              <span>{state.backupRetention || 25} pre-change snapshots retained</span>
            </button>
          </div>
          <fieldset disabled={!valid} style={editorFieldsetStyle}>
            <AppearanceEditor settings={draft} onChange={setDraft} onValidity={setAppearanceValid} />
          </fieldset>
          <ConfigForm
            value={draft}
            onChange={setDraft}
            fields={SETTINGS_FIELDS.filter((field) => field.key !== "theme")}
            knownKeys={["theme", "studioTheme"]}
            onValidity={setValid}
            docs="https://gethomepage.dev/configs/settings/"
          />
          <p className="studio-note">
            Studio owns panel size, position, stacking and dashboard appearance. Native group tabs, column counts,
            collapse and equal-height layout options are preserved in YAML; they do not control this board. Native
            status colors, providers, targets and widget behavior remain Homepage settings.
          </p>
          <div className="studio-about">
            <strong>Homepage Studio</strong>
            <span>
              Homepage 2.6.0
              {buildRevision ? ` · Studio build ${buildRevision.slice(0, 8)}` : " · Development build"}
            </span>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              Source code & license ↗
            </a>
          </div>
        </fieldset>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button className="studio-button studio-primary" disabled={!valid || !appearanceValid || pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}

export function FilesEditor({ state, onSaved, onClose, onReload }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(FILES.map(([, key]) => [key, state[key] || ""])));
  const [selected, setSelected] = useState(FILES[0][1]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const filePicker = useRef(null);
  const changed = FILES.filter(([, key]) => draft[key] !== (state[key] || ""));
  useEditorDraft(Boolean(changed.length), pending || importing);
  const save = async (event) => {
    event.preventDefault();
    if (pending || importing || !changed.length) return;
    setError(null);
    setPending(true);
    try {
      await onSaved(
        await studioRequest("/__studio/api/save", {
          revision: state.revision,
          ...Object.fromEntries(changed.map(([, key]) => [key, draft[key]])),
        }),
        { customJsChanged: draft.customJs !== (state.customJs || "") },
      );
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={save}>
      <div className="studio-dialog-body">
        <ErrorMessage error={error} onReload={onReload} />
        <fieldset disabled={pending || importing} style={editorFieldsetStyle}>
          <div className="studio-file-toolbar">
            <select
              aria-label="Configuration file"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {FILES.map(([name, key]) => (
                <option value={key} key={key}>
                  {name}
                  {draft[key] !== (state[key] || "") ? " • modified" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="studio-text-button"
              onClick={() => downloadFile(FILES.find(([, key]) => key === selected)[0], draft[selected], "text/plain")}
            >
              Export file
            </button>
            <button
              type="button"
              className="studio-text-button"
              disabled={Boolean(changed.length)}
              onClick={async () => {
                try {
                  downloadFile(
                    "homepage-studio-configuration.json",
                    JSON.stringify(await studioRequest("/__studio/api/export"), null, 2),
                  );
                } catch (err) {
                  setError(err);
                }
              }}
            >
              Export saved dashboard
            </button>
          </div>
          <p className="studio-note">
            These are your complete local native files. Secret references remain literal text. Save validates the draft
            and creates one recovery snapshot for the transaction.
          </p>
          <textarea
            className="studio-code-editor studio-full-file"
            aria-label={FILES.find(([, key]) => key === selected)[0]}
            value={draft[selected]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [selected]: event.target.value,
              }))
            }
            spellCheck={false}
            wrap="off"
          />
          <div className="studio-file-import">
            <button type="button" className="studio-button studio-quiet" onClick={() => filePicker.current?.click()}>
              Import into this file
            </button>
            <input
              ref={filePicker}
              type="file"
              hidden
              aria-label="Import configuration file"
              accept=".yaml,.yml,.css,.js,.txt"
              onChange={async (event) => {
                const input = event.target;
                const file = input.files?.[0];
                if (!file) return;
                setError(null);
                setImporting(true);
                try {
                  if (file.size > 2 * 1024 * 1024) throw new Error("Choose a file no larger than 2 MiB.");
                  const text = await file.text();
                  setDraft((current) => ({ ...current, [selected]: text }));
                } catch (err) {
                  setError(err);
                } finally {
                  input.value = "";
                  setImporting(false);
                }
              }}
            />
            <span className="studio-muted">The imported file stays a draft until Save.</span>
          </div>
        </fieldset>
      </div>
      <footer className="studio-dialog-footer">
        <small className="studio-muted">
          {changed.length} modified file{changed.length === 1 ? "" : "s"}
        </small>
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" disabled={pending || importing} onClick={onClose}>
          Cancel
        </button>
        <button className="studio-button studio-primary" disabled={pending || importing || !changed.length}>
          {pending ? "Saving…" : importing ? "Reading file…" : "Save configuration"}
        </button>
      </footer>
    </form>
  );
}

export function SnapshotEditor({ state, backups, onSaved, onClose, onReload }) {
  const [chosen, setChosen] = useState(null);
  const [archive, setArchive] = useState(null);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const filePicker = useRef(null);
  const busy = reading || pending;
  useEditorDraft(false, busy);
  const selectArchive = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    setReading(true);
    setError(null);
    setArchive(null);
    setChosen(null);
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error("Choose a dashboard backup no larger than 40 MiB.");
      let content;
      try {
        content = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "This file could not be read as a dashboard JSON backup. Choose an exported dashboard or pre-save snapshot.",
        );
      }
      const files = content?.files || content?.before;
      const expected = [...FILES.map(([name]) => name), "state.json"];
      if (
        content?.version !== 1 ||
        !files ||
        typeof files !== "object" ||
        Array.isArray(files) ||
        Object.keys(files).length !== expected.length ||
        expected.some((name) => !Object.hasOwn(files, name))
      ) {
        throw new Error(
          "Choose a complete dashboard export or snapshot containing all nine native files and its saved layout.",
        );
      }
      setArchive({ name: file.name, content });
      setChosen(null);
    } catch (err) {
      setError(err);
    } finally {
      setReading(false);
    }
  };
  const restore = async () => {
    if (busy || (!chosen && !archive)) return;
    setPending(true);
    setError(null);
    try {
      const restored = await studioRequest(archive ? "/__studio/api/import" : "/__studio/api/restore", {
        revision: state.revision,
        ...(archive ? { archive: archive.content } : { backupId: chosen }),
      });
      await onSaved(restored, {
        customJsChanged: (restored.customJs || "") !== (state.customJs || ""),
      });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="studio-dialog-body">
        <ErrorMessage error={error} onReload={onReload} />
        <section className="studio-dashboard-import" aria-labelledby="studio-dashboard-import-heading">
          <h3 id="studio-dashboard-import-heading">Import a dashboard</h3>
          <p className="studio-note">
            Restore an exported dashboard or downloaded snapshot, including widgets, layout, appearance and custom
            files.
          </p>
          <button
            type="button"
            className="studio-button studio-quiet"
            disabled={busy}
            onClick={() => filePicker.current?.click()}
          >
            {reading ? "Reading backup…" : "Choose dashboard backup"}
          </button>
          <input
            ref={filePicker}
            type="file"
            accept=".json,application/json"
            aria-label="Dashboard backup file"
            hidden
            disabled={busy}
            onChange={selectArchive}
          />
          {archive && (
            <div className="studio-import-confirm" role="status">
              <strong>Replace this dashboard with {archive.name}?</strong>
              <p>
                This replaces all current configuration and the saved arrangement. A recovery snapshot is created before
                replacement. Nothing changes until you select Import dashboard.
              </p>
              <p className="studio-note">
                Environment variables, mounted files and external services must also be available to this deployment.
              </p>
              <button type="button" className="studio-text-button" disabled={busy} onClick={() => setArchive(null)}>
                Clear selected backup
              </button>
            </div>
          )}
        </section>
        <h3>Saved snapshots</h3>
        <p className="studio-note">
          Snapshots capture configuration before a successful change. Slideshow playback creates no snapshots. Restoring
          also preserves a snapshot of the current configuration.
        </p>
        <div className="studio-snapshots">
          {backups.map((backup) => (
            <button
              className={`studio-snapshot${chosen === backup.id ? " studio-snapshot-selected" : ""}`}
              key={backup.id}
              aria-pressed={chosen === backup.id}
              disabled={busy}
              onClick={() => {
                setChosen(backup.id);
                setArchive(null);
              }}
            >
              <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
              <small>{backup.changedFiles?.join(", ") || backup.id}</small>
            </button>
          ))}
        </div>
        {!backups.length && <p className="studio-muted">Your first saved change will appear here.</p>}
        {chosen && (
          <p className="studio-note">
            Restore the selected snapshot? This replaces the current native configuration and saved arrangement.
          </p>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <button
          className="studio-text-button"
          disabled={!chosen || busy}
          onClick={async () => {
            try {
              downloadFile(
                `homepage-studio-snapshot-${chosen}.json`,
                JSON.stringify(await studioRequest(`/__studio/api/backups/${encodeURIComponent(chosen)}`), null, 2),
              );
            } catch (err) {
              setError(err);
            }
          }}
        >
          Export pre-save snapshot
        </button>
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button className="studio-button studio-primary" disabled={(!chosen && !archive) || busy} onClick={restore}>
          {pending
            ? archive
              ? "Importing…"
              : "Restoring…"
            : archive
              ? "Import dashboard"
              : "Restore selected snapshot"}
        </button>
      </footer>
    </>
  );
}
