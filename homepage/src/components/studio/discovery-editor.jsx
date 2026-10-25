import { useState } from "react";

import { studioRequest } from "./api.mjs";
import { ErrorMessage } from "./dialog";
import { useEditorDraft } from "./draft-guard";

export default function DiscoveryEditor({
  panel,
  revision,
  onSaved,
  onPosition,
  onClose,
}) {
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  useEditorDraft(false, pending);
  const origin =
    panel.nativeLocator.origin === "kubernetes"
      ? "Kubernetes annotations"
      : "Docker labels";
  const hide = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSaved(
        await studioRequest("/studio/api/discovery-visibility", {
          revision,
          id: panel.id,
          hidden: true,
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
          This native content is discovered from {origin}. Its integration
          options are owned there. Studio can position, resize, stack or hide
          this panel without changing the external definition.
        </p>
        <p className="studio-note">
          Group: {panel.group}. Hiding affects only this dashboard; restore it
          later from Add widget → Hidden discovered panels.
        </p>
        <button
          className="studio-button studio-quiet"
          disabled={pending}
          onClick={onPosition}
        >
          Position & size
        </button>
        <p className="studio-note">
          <a
            href={
              panel.nativeLocator.origin === "kubernetes"
                ? "https://gethomepage.dev/configs/kubernetes/"
                : "https://gethomepage.dev/configs/docker/"
            }
            target="_blank"
            rel="noreferrer"
          >
            Native discovery configuration ↗
          </a>
        </p>
      </div>
      <footer className="studio-dialog-footer">
        <button
          className="studio-text-button"
          disabled={pending}
          onClick={hide}
        >
          {pending ? "Hiding…" : "Hide from dashboard"}
        </button>
        <span className="studio-footer-spacer" />
        <button
          className="studio-button studio-quiet"
          disabled={pending}
          onClick={onClose}
        >
          Close
        </button>
      </footer>
    </>
  );
}
