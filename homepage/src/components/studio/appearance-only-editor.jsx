import { useState } from "react";

import { studioRequest } from "./api.mjs";
import AppearanceEditor from "./appearance-editor";
import { ErrorMessage } from "./dialog";
import { editorDraftChanged, editorFieldsetStyle, useEditorDraft } from "./draft-guard";
import { patchFromDraft } from "./native-adapter.mjs";

// For people who may arrange a dashboard but not read its settings: only the
// display mode and Studio appearance, through the appearance endpoint.
export default function AppearanceOnlyEditor({ appearance, onSaved, onClose, onReload }) {
  const original = appearance.settings || {};
  const [draft, setDraft] = useState(() => structuredClone(original));
  const [valid, setValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const changed = editorDraftChanged(original, draft);
  useEditorDraft(!valid || changed, pending);
  const save = async (event) => {
    event.preventDefault();
    if (pending || !valid || !changed) return;
    setError(null);
    setPending(true);
    try {
      await onSaved(
        await studioRequest("/studio/api/appearance", {
          revision: appearance.revision,
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
          <AppearanceEditor settings={draft} onChange={setDraft} onValidity={setValid} />
        </fieldset>
        <p className="studio-note">
          An administrator manages this dashboard&apos;s other settings, its widgets and its configuration files.
        </p>
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button className="studio-button studio-primary" disabled={!valid || !changed || pending}>
          {pending ? "Saving…" : "Save appearance"}
        </button>
      </footer>
    </form>
  );
}
