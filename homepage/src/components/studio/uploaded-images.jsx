import { useCallback, useEffect, useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioIcon from "./icons";
import { formatBytes, prepareImage, UPLOAD_TYPES } from "./image-upload.mjs";

// Where an uploaded image is served, and how configuration names it.
export const IMAGE_REFERENCE = /^\/studio\/api\/images\/([a-f0-9]{24})$/;
export const imageReference = (id) => `/studio/api/images/${id}`;
export const imagePath = (id) => dashboardPath(imageReference(encodeURIComponent(id)));

// This dashboard's uploads of one kind (logos or backgrounds), with Upload
// and Remove. Pictures are shrunk (backgrounds to 2560 px, logos to 512 px)
// and saved as WebP before they are sent; SVG goes as it is.
export function UploadedImages({ kind, value, onPick }) {
  const [images, setImages] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const input = useRef(null);
  const load = useCallback(
    () =>
      studioRequest("/studio/api/images")
        .then((result) => setImages(result.images.filter((image) => image.kind === kind)))
        .catch((error) => setStatus({ error: error.message })),
    [kind],
  );
  useEffect(() => {
    load();
  }, [load]);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const prepared = await prepareImage(file, kind);
      const { image } = await studioRequest("/studio/api/images", {
        kind,
        name: file.name,
        image: prepared.image,
      });
      setStatus({
        note:
          prepared.after < prepared.before
            ? `${file.name}: ${formatBytes(prepared.before)}, shrunk to ${formatBytes(prepared.after)}`
            : `${file.name} added`,
      });
      await load();
      onPick(image.id);
    } catch (error) {
      setStatus({ error: error.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (image, confirmed = false) => {
    setBusy(true);
    setStatus(null);
    try {
      await studioRequest("/studio/api/images/delete", { id: image.id, ...(confirmed ? { confirm: true } : {}) });
      setConfirm(null);
      await load();
    } catch (error) {
      // The request error carries the server's reply: { error, code, details }.
      if (error.details?.code === "IMAGE_IN_USE") setConfirm({ image, usedIn: error.details.details?.usedIn || [] });
      else setStatus({ error: error.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="studio-uploaded">
      <div className="studio-inline-actions">
        <button type="button" className="studio-button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Working…" : "Upload"}
        </button>
        <span className="studio-muted">PNG, JPEG, WebP or SVG. Anyone who can edit this dashboard can reuse it.</span>
        <input
          ref={input}
          type="file"
          hidden
          accept={UPLOAD_TYPES.join(",")}
          onChange={(event) => upload(event.target.files?.[0])}
        />
      </div>
      {status?.note && (
        <p className="studio-note" role="status">
          {status.note}
        </p>
      )}
      {status?.error && (
        <p className="studio-field-error" role="alert">
          {status.error}
        </p>
      )}
      {confirm && (
        <div className="studio-delete-confirm" role="alert">
          <strong>{confirm.image.name} is still in use</strong>
          <ul>
            {confirm.usedIn.map((place, index) => (
              <li key={index}>{place.name}</li>
            ))}
          </ul>
          <p>Removing it leaves those with the dashboard&apos;s default style.</p>
          <div className="studio-inline-actions">
            <button type="button" className="studio-button studio-quiet" onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button type="button" className="studio-button studio-danger" onClick={() => remove(confirm.image, true)}>
              Remove anyway
            </button>
          </div>
        </div>
      )}
      {images?.length === 0 && <p className="studio-muted">Nothing uploaded yet.</p>}
      {images?.length > 0 && (
        <div
          className="studio-background-grid"
          role="radiogroup"
          aria-label={kind === "logo" ? "Uploaded logos" : "Uploaded"}
        >
          {images.map((image) => (
            <div key={image.id} className="studio-background-uploaded">
              <button
                type="button"
                role="radio"
                aria-checked={value === image.id}
                className="studio-background-option"
                onClick={() => onPick(image.id)}
              >
                <span
                  className={`studio-background-thumb studio-uploaded-${kind}`}
                  style={{ backgroundImage: `url("${imagePath(image.id)}")` }}
                />
                <span className="studio-background-name">{image.name}</span>
              </button>
              <button
                type="button"
                className="studio-icon-button studio-background-remove"
                aria-label={`Remove ${image.name}`}
                disabled={busy}
                onClick={() => remove(image)}
              >
                <StudioIcon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
