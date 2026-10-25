import { useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
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
  const pick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setMessage({ kind: "error", text: "Logos are limited to 256 KiB. Use a smaller image." });
      input.current.value = "";
      return;
    }
    await send({ image: await readAsDataUrl(file) }, "Logo saved.");
  };
  return (
    <Group
      title="Logo"
      info="Shown next to this dashboard's name and as its browser tab icon. PNG, JPEG, WebP or SVG up to 256 KiB; square works best. It saves straight away."
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
