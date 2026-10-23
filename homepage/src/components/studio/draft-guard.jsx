import { createContext, useContext, useLayoutEffect } from "react";

// Only the currently mounted editor reports here. Drafts stay inside their
// editor; the board needs two flags to guard dismissal and pending writes.
export const EditorDraftContext = createContext(null);

export function editorDraftChanged(original, draft) {
  try {
    return JSON.stringify(original) !== JSON.stringify(draft);
  } catch {
    // Advanced YAML can contain a draft that cannot yet be serialized to the
    // writer's JSON protocol. Keep it guarded instead of crashing the editor.
    return true;
  }
}

// An editor may name its draft for the discard prompt: `discard.heading` and
// `discard.description` replace the generic wording. Both are plain text.
export function useEditorDraft(dirty, pending = false, discard = null) {
  const report = useContext(EditorDraftContext);
  const heading = (dirty && discard?.heading) || "";
  const description = (dirty && discard?.description) || "";
  useLayoutEffect(() => {
    report?.({
      dirty: Boolean(dirty),
      pending: Boolean(pending),
      ...(heading ? { discard: { heading, description } } : {}),
    });
  }, [report, dirty, pending, heading, description]);
  useLayoutEffect(
    () => () => report?.({ dirty: false, pending: false }),
    [report],
  );
}

export const editorFieldsetStyle = {
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
};
