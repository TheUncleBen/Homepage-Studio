import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioIcon from "./icons";
import { formatBytes, prepareImage, UPLOAD_TYPES } from "./image-upload.mjs";
import { Segmented } from "./ui";

// Where an uploaded image is served, and how configuration names it.
export const IMAGE_REFERENCE = /^\/studio\/api\/images\/([a-f0-9]{24})$/;
export const imageReference = (id) => `/studio/api/images/${id}`;
export const imagePath = (id) => dashboardPath(imageReference(encodeURIComponent(id)));
const personalPath = (id) => dashboardPath(`/studio/api/my-images/${encodeURIComponent(id)}`);

const PLACES = {
  dashboard: {
    list: "/studio/api/images",
    add: "/studio/api/images",
    remove: "/studio/api/images/delete",
    path: imagePath,
  },
  personal: {
    list: "/studio/api/my-images",
    add: "/studio/api/my-images",
    remove: "/studio/api/my-images/delete",
    path: personalPath,
  },
};

function useImages(place, kind, enabled) {
  const [images, setImages] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return studioRequest(PLACES[place].list)
      .then((result) => setImages(result.images.filter((image) => image.kind === kind)))
      .catch((failure) => setError(failure.message));
  }, [place, kind, enabled]);
  useEffect(() => {
    load();
  }, [load]);
  return { images, error, load };
}

function ImageGrid({ label, images, place, kind, value, busy, onPick, onRemove }) {
  return (
    <div className="studio-background-grid" role="radiogroup" aria-label={label}>
      {images.map((image) => (
        <div key={image.id} className="studio-background-uploaded">
          <button
            type="button"
            role="radio"
            aria-checked={place === "dashboard" && value === image.id}
            className="studio-background-option"
            disabled={busy}
            onClick={() => onPick(image)}
          >
            <span
              className={`studio-background-thumb studio-uploaded-${kind}`}
              style={{ backgroundImage: `url("${PLACES[place].path(image.id)}")` }}
            />
            <span className="studio-background-name">{image.name}</span>
          </button>
          <button
            type="button"
            className="studio-icon-button studio-background-remove"
            aria-label={`Remove ${image.name}`}
            disabled={busy}
            onClick={() => onRemove(image)}
          >
            <StudioIcon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Uploads of one kind (logos or backgrounds), in up to two places:
// - This dashboard: anyone who can edit it can reuse them.
// - Just me (with Studio sign-in): only you see them, on any dashboard you
//   can edit. Using one copies it into this dashboard.
// Pictures are shrunk (backgrounds to 2560 px, logos to 512 px) and saved as
// WebP before they are sent; SVG goes as it is.
export function UploadedImages({ kind, value, onPick }) {
  const { data: access } = useSWR("/studio/api/access", studioRequest);
  const personal = Boolean(access?.authEnabled && access.user);
  const dashboard = useImages("dashboard", kind, true);
  const mine = useImages("personal", kind, personal);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [pending, setPending] = useState(null);
  const input = useRef(null);
  const run = async (task) => {
    setBusy(true);
    setStatus(null);
    try {
      await task();
    } catch (error) {
      // The request error carries the server's reply: { error, code, details }.
      if (error.details?.code === "IMAGE_IN_USE")
        setConfirm({ image: error.image, usedIn: error.details.details?.usedIn || [] });
      else setStatus({ error: error.message });
    } finally {
      setBusy(false);
    }
  };
  // A personal image is copied into the dashboard before it is used.
  const use = (image, place) =>
    run(async () => {
      if (place === "dashboard") return onPick(image.id);
      const { image: copy } = await studioRequest("/studio/api/my-images/use", { id: image.id });
      await dashboard.load();
      onPick(copy.id);
    });
  const store = async (prepared, place) => {
    const { image } = await studioRequest(PLACES[place].add, { kind, name: prepared.name, image: prepared.image });
    setPending(null);
    setStatus({ note: prepared.note });
    if (place === "personal") {
      await mine.load();
      const { image: copy } = await studioRequest("/studio/api/my-images/use", { id: image.id });
      await dashboard.load();
      onPick(copy.id);
    } else {
      await dashboard.load();
      onPick(image.id);
    }
  };
  const save = (prepared, place) => run(() => store(prepared, place));
  const choose = (file) =>
    run(async () => {
      if (!file) return;
      try {
        const prepared = await prepareImage(file, kind);
        const note =
          prepared.after < prepared.before
            ? `${file.name}: ${formatBytes(prepared.before)}, shrunk to ${formatBytes(prepared.after)}`
            : `${file.name}: ${formatBytes(prepared.after)}`;
        const ready = { ...prepared, name: file.name, note };
        // With only one place there is nothing to ask.
        if (personal) setPending({ ...ready, place: "dashboard" });
        else await store(ready, "dashboard");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  const remove = (image, place, confirmed = false) =>
    run(async () => {
      try {
        await studioRequest(PLACES[place].remove, {
          id: image.id,
          ...(place === "dashboard" && confirmed ? { confirm: true } : {}),
        });
      } catch (error) {
        error.image = image;
        throw error;
      }
      setConfirm(null);
      await (place === "dashboard" ? dashboard : mine).load();
    });
  const error = dashboard.error || mine.error;
  return (
    <div className="studio-uploaded">
      <div className="studio-inline-actions">
        <button
          type="button"
          className="studio-button"
          disabled={busy || Boolean(pending)}
          onClick={() => input.current?.click()}
        >
          {busy ? "Working…" : "Upload"}
        </button>
        <span className="studio-muted">PNG, JPEG, WebP or SVG. Big pictures are shrunk for you.</span>
        <input
          ref={input}
          type="file"
          hidden
          accept={UPLOAD_TYPES.join(",")}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      {pending && (
        <div className="studio-upload-place" role="group" aria-label="Who can reuse it?">
          <p className="studio-note">{pending.note}</p>
          <Segmented
            label="Who can reuse it?"
            value={pending.place}
            onChange={(place) => setPending({ ...pending, place })}
            options={[
              ["personal", "Just me"],
              ["dashboard", "This dashboard"],
            ]}
          />
          <p className="studio-muted">
            {pending.place === "personal"
              ? "Saved to your account. Only you see it in the library, on any dashboard you can edit."
              : "Saved with this dashboard. Anyone who can edit it can reuse it. It never appears on other dashboards."}
          </p>
          <div className="studio-inline-actions">
            <button type="button" className="studio-button studio-quiet" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="studio-button studio-primary"
              disabled={busy}
              onClick={() => save(pending, pending.place)}
            >
              Save and use
            </button>
          </div>
        </div>
      )}
      {status?.note && (
        <p className="studio-note" role="status">
          {status.note}
        </p>
      )}
      {(status?.error || error) && (
        <p className="studio-field-error" role="alert">
          {status?.error || error}
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
            <button
              type="button"
              className="studio-button studio-danger"
              onClick={() => remove(confirm.image, "dashboard", true)}
            >
              Remove anyway
            </button>
          </div>
        </div>
      )}
      <section className="studio-uploaded-place" aria-label="This dashboard">
        {personal && (
          <h4 className="studio-uploaded-heading">
            This dashboard <span className="studio-muted">anyone who can edit it sees these</span>
          </h4>
        )}
        {dashboard.images?.length === 0 && <p className="studio-muted">Nothing uploaded yet.</p>}
        {dashboard.images?.length > 0 && (
          <ImageGrid
            label={kind === "logo" ? "Uploaded logos" : "Uploaded"}
            images={dashboard.images}
            place="dashboard"
            kind={kind}
            value={value}
            busy={busy}
            onPick={(image) => use(image, "dashboard")}
            onRemove={(image) => remove(image, "dashboard")}
          />
        )}
      </section>
      {personal && (
        <section className="studio-uploaded-place" aria-label="Just me">
          <h4 className="studio-uploaded-heading">
            Just me <span className="studio-muted">only you see these, on dashboards you edit</span>
          </h4>
          {mine.images?.length === 0 && <p className="studio-muted">Nothing saved to your account yet.</p>}
          {mine.images?.length > 0 && (
            <ImageGrid
              label={kind === "logo" ? "Your logos" : "Your pictures"}
              images={mine.images}
              place="personal"
              kind={kind}
              value={value}
              busy={busy}
              onPick={(image) => use(image, "personal")}
              onRemove={(image) => remove(image, "personal")}
            />
          )}
        </section>
      )}
    </div>
  );
}
