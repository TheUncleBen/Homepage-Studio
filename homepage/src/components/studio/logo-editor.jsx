import { useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import { formatBytes, prepareImage } from "./image-upload.mjs";
import { STUDIO_LOGO } from "./top-bar";
import { Group } from "./ui";

const MAX_BYTES = 256 * 1024;
const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

// The dashboard's own logo: next to its name in the top bar and its browser
// tab icon. It saves at once, apart from the other settings on this page.
export default function LogoEditor({ logo, onChange }) {
  const input = useRef(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);
  const source = logo ? dashboardPath(`/studio/logo?v=${logo.version}`) : STUDIO_LOGO;
  const send = async (body, done) => {
    setPending(true);
    setMessage(null);
    try {
      await studioRequest("/studio/api/logo", body);
      await onChange();
      setMessage({ kind: "ok", text: done });
    } catch (error) {
      setMessage({ kind: "error", text: error.message || "The logo could not be saved." });
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  // Big pictures are shrunk to 512 px instead of being refused (approved
  // board 19); an SVG is sent as it is, so it still has to fit the limit.
  const pick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size <= MAX_BYTES) {
      await send({ image: await readAsDataUrl(file) }, "Logo saved.");
      return;
    }
    let prepared = null;
    if (file.type !== "image/svg+xml") {
      try {
        prepared = await prepareImage(file, "logo");
      } catch {
        prepared = null;
      }
    }
    if (!prepared || prepared.after > MAX_BYTES) {
      setMessage({
        kind: "error",
        text:
          file.type === "image/svg+xml"
            ? "SVG logos are limited to 256 KiB. Use a smaller SVG, or a PNG."
            : "This picture could not be shrunk to 256 KiB. Try a PNG or JPEG.",
      });
      input.current.value = "";
      return;
    }
    await send(
      { image: prepared.image },
      `Logo saved. Shrunk from ${formatBytes(prepared.before)} to ${formatBytes(prepared.after)} (${prepared.width}\u00a0×\u00a0${prepared.height}).`,
    );
  };
  return (
    <Group
      title="Logo"
      info="PNG, SVG, WebP or JPEG. Square, 512 × 512 px or larger. Big pictures are shrunk for you. Shown next to this dashboard's name and as its tab icon; it saves straight away."
    >
      <div className="studio-logo-row">
        <img src={source} alt="" width={44} height={44} className="studio-logo-preview" />
        <span className="studio-logo-name">{logo ? "Your logo" : "Studio logo"}</span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={pick}
        />
        {logo && (
          <button
            type="button"
            className="studio-pill-button"
            disabled={pending}
            onClick={() => send({ reset: true }, "Back to the Studio logo.")}
          >
            Use the Studio logo
          </button>
        )}
        <button
          type="button"
          className="studio-pill-button studio-pill-accent"
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? "Saving…" : logo ? "Change" : "Upload"}
        </button>
      </div>
      {message && (
        <p
          className={message.kind === "error" ? "studio-field-error studio-group-message" : "studio-group-message"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </Group>
  );
}
