import { useState } from "react";

import { FILES, studioRequest } from "./api.mjs";
import ConfigForm, { SETTINGS_FIELDS } from "./config-form";
import { ErrorMessage } from "./dialog";
import { patchFromDraft } from "./native-adapter.mjs";

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
  onReload,
}) {
  const original = state.settingsConfig || {};
  const [draft, setDraft] = useState(() => structuredClone(original));
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const save = async (event) => {
    event.preventDefault();
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
        <div className="studio-settings-shortcuts">
          <button type="button" onClick={onOpenFiles}>
            <strong>Configuration files</strong>
            <span>All nine native files, with YAML and code editing</span>
          </button>
          <button type="button" onClick={onOpenBackups}>
            <strong>Snapshots & restore</strong>
            <span>
              {state.backupRetention || 25} pre-change snapshots retained
            </span>
          </button>
        </div>
        <ConfigForm
          value={draft}
          onChange={setDraft}
          fields={SETTINGS_FIELDS}
          onValidity={setValid}
          docs="https://gethomepage.dev/configs/settings/"
        />
        <p className="studio-note">
          Studio owns panel size, position, stacking and its charcoal/eggplant
          surfaces. Native group tabs, column counts, collapse and equal-height
          layout options are preserved in YAML; they do not control this board.
          Native status colors, providers, targets and widget behavior remain
          Homepage settings.
        </p>
        <div className="studio-about">
          <strong>Homepage Studio</strong>
          <span>Native Homepage 2.6.0 · React board protocol 1</span>
          <a
            href="https://github.com/TheUncleBen/Homepage-Studio"
            target="_blank"
            rel="noreferrer"
          >
            Source code & license ↗
          </a>
        </div>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button
          type="button"
          className="studio-button studio-quiet"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="studio-button studio-primary"
          disabled={!valid || pending}
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}

export function FilesEditor({ state, onSaved, onClose, onReload }) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(FILES.map(([, key]) => [key, state[key] || ""])),
  );
  const [selected, setSelected] = useState(FILES[0][1]);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const changed = FILES.filter(([, key]) => draft[key] !== (state[key] || ""));
  const save = async (event) => {
    event.preventDefault();
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
            onClick={() =>
              downloadFile(
                FILES.find(([, key]) => key === selected)[0],
                draft[selected],
                "text/plain",
              )
            }
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
                  JSON.stringify(
                    await studioRequest("/__studio/api/export"),
                    null,
                    2,
                  ),
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
          These are your complete local native files. Secret references remain
          literal text. Save validates the draft and creates one recovery
          snapshot for the transaction.
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
          <label className="studio-button studio-quiet">
            Import into this file
            <input
              type="file"
              accept=".yaml,.yml,.css,.js,.txt"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > 2 * 1024 * 1024)
                    setError(new Error("Choose a file no larger than 2 MiB."));
                  if (file.size <= 2 * 1024 * 1024) {
                    const text = await file.text();
                    setDraft((current) => ({ ...current, [selected]: text }));
                  }
                }
                event.target.value = "";
              }}
            />
          </label>
          <span className="studio-muted">
            The imported file stays a draft until Save.
          </span>
        </div>
      </div>
      <footer className="studio-dialog-footer">
        <small className="studio-muted">
          {changed.length} modified file{changed.length === 1 ? "" : "s"}
        </small>
        <span className="studio-footer-spacer" />
        <button
          type="button"
          className="studio-button studio-quiet"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="studio-button studio-primary"
          disabled={pending || !changed.length}
        >
          {pending ? "Saving…" : "Save configuration"}
        </button>
      </footer>
    </form>
  );
}

export function SnapshotEditor({ state, backups, onSaved, onClose }) {
  const [chosen, setChosen] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const restore = async () => {
    setPending(true);
    setError(null);
    try {
      await onSaved(
        await studioRequest("/__studio/api/restore", {
          revision: state.revision,
          backupId: chosen,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="studio-dialog-body">
        <ErrorMessage error={error} />
        <p className="studio-note">
          Snapshots capture configuration before a successful change. Slideshow
          playback creates no snapshots. Restoring also preserves a snapshot of
          the current configuration.
        </p>
        <div className="studio-snapshots">
          {backups.map((backup) => (
            <button
              className={`studio-snapshot${chosen === backup.id ? " studio-snapshot-selected" : ""}`}
              key={backup.id}
              onClick={() => setChosen(backup.id)}
            >
              <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
              <small>{backup.changedFiles?.join(", ") || backup.id}</small>
            </button>
          ))}
        </div>
        {!backups.length && (
          <p className="studio-muted">
            Your first saved change will appear here.
          </p>
        )}
        {chosen && (
          <p className="studio-note">
            Restore the selected snapshot? This replaces the current native
            configuration and saved arrangement.
          </p>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <button
          className="studio-text-button"
          disabled={!chosen || pending}
          onClick={async () => {
            try {
              downloadFile(
                `homepage-studio-snapshot-${chosen}.json`,
                JSON.stringify(
                  await studioRequest(
                    `/__studio/api/backups/${encodeURIComponent(chosen)}`,
                  ),
                  null,
                  2,
                ),
              );
            } catch (err) {
              setError(err);
            }
          }}
        >
          Export pre-save snapshot
        </button>
        <span className="studio-footer-spacer" />
        <button className="studio-button studio-quiet" onClick={onClose}>
          Close
        </button>
        <button
          className="studio-button studio-primary"
          disabled={!chosen || pending}
          onClick={restore}
        >
          {pending ? "Restoring…" : "Restore selected snapshot"}
        </button>
      </footer>
    </>
  );
}
