import { useEffect, useRef, useState } from "react";

import { studioRequest } from "./api.mjs";
import { ABSTRACT, builtInFamily, PATTERNS, scenePath, SCENES, themedSvg } from "./backgrounds.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import StudioIcon from "./icons";
import { formatBytes, prepareImage, UPLOAD_TYPES } from "./image-upload.mjs";
import { Row, Segmented, Switch } from "./ui";

// Which families a fill offers: Picture shows scenes and uploads, Pattern
// the abstract designs and patterns, and a page any of them.
export const FILL_FAMILIES = {
  picture: ["scene", "upload"],
  pattern: ["abstract", "pattern"],
  page: ["scene", "upload", "abstract", "pattern"],
};
const FAMILY_LABEL = { scene: "Scenes", upload: "Uploaded", abstract: "Abstract", pattern: "Patterns" };
const FAMILY_ITEMS = { scene: SCENES, abstract: ABSTRACT, pattern: PATTERNS };
export const imagePath = (id) => dashboardPath(`/studio/api/images/${encodeURIComponent(id)}`);

export function backgroundName(background) {
  if (!background?.id) return null;
  if (background.source !== "builtin") return "Uploaded picture";
  const family = builtInFamily(background.id);
  return family ? FAMILY_ITEMS[family].find((item) => item.id === background.id)?.name : null;
}

export const familyOf = (background) =>
  background?.source === "library" ? "upload" : background?.source === "builtin" ? builtInFamily(background.id) : null;

function thumbStyle(family, id, tokens) {
  if (family === "upload") return { backgroundImage: `url("${imagePath(id)}")`, backgroundSize: "cover" };
  if (family === "scene")
    return { backgroundImage: `url("${dashboardPath(scenePath(id, true))}")`, backgroundSize: "cover" };
  const url = themedSvg(id, tokens);
  return { backgroundImage: `url("${url}")`, backgroundSize: family === "pattern" ? "auto" : "cover" };
}

// This dashboard's uploaded backgrounds, with Upload and Remove. Pictures
// are shrunk to 2560 px and saved as WebP before they are sent.
function UploadedBackgrounds({ value, onPick }) {
  const [images, setImages] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const input = useRef(null);
  const load = () =>
    studioRequest("/studio/api/images")
      .then((result) => setImages(result.images.filter((image) => image.kind === "background")))
      .catch((error) => setStatus({ error: error.message }));
  useEffect(() => {
    load();
  }, []);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const prepared = await prepareImage(file, "background");
      const { image } = await studioRequest("/studio/api/images", {
        kind: "background",
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
      onPick(image.id, "library");
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
        <div className="studio-background-grid" role="radiogroup" aria-label="Uploaded">
          {images.map((image) => (
            <div key={image.id} className="studio-background-uploaded">
              <button
                type="button"
                role="radio"
                aria-checked={value?.source === "library" && value.id === image.id}
                className="studio-background-option"
                onClick={() => onPick(image.id, "library")}
              >
                <span className="studio-background-thumb" style={thumbStyle("upload", image.id)} />
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

// The backgrounds for one fill, by family. Scenes can be narrowed to the ones
// that suit a dark or a light theme.
export function BackgroundGrid({ fill, value, tokens, onPick }) {
  const families = FILL_FAMILIES[fill] || [];
  const current = familyOf(value);
  const [family, setFamily] = useState(families.includes(current) ? current : families[0]);
  const [suits, setSuits] = useState("all");
  const items = (FAMILY_ITEMS[family] || []).filter(
    (item) => family !== "scene" || suits === "all" || item.suits === suits || item.suits === "both",
  );
  return (
    <div className="studio-background-grid-holder">
      <div className="studio-background-filters">
        {families.length > 1 && (
          <Segmented
            label="Kind of background"
            value={family}
            onChange={setFamily}
            options={families.map((key) => [key, FAMILY_LABEL[key]])}
          />
        )}
        {family === "scene" && (
          <Segmented
            label="Suits"
            value={suits}
            onChange={setSuits}
            options={[
              ["all", "All"],
              ["dark", "Dark"],
              ["light", "Light"],
            ]}
          />
        )}
      </div>
      {family === "upload" ? (
        <UploadedBackgrounds value={value} onPick={onPick} />
      ) : (
        <div className="studio-background-grid" role="radiogroup" aria-label={FAMILY_LABEL[family]}>
          {items.map((item) => {
            const chosen = value?.source === "builtin" && value.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className="studio-background-option"
                onClick={() => onPick(item.id, "builtin")}
              >
                <span className="studio-background-thumb" style={thumbStyle(family, item.id, tokens)} />
                <span className="studio-background-name">{item.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Click or drag on the thumbnail to choose the point that stays in view;
// double-click centres it again.
function FocusPicker({ background, tokens, onChange }) {
  const family = familyOf(background) || "upload";
  const style = thumbStyle(family, background.id, tokens);
  const [x, y] = background.focus || [50, 50];
  const place = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fx = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
    const fy = Math.round(Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100)));
    onChange(fx === 50 && fy === 50 ? undefined : [fx, fy]);
  };
  return (
    <div
      className="studio-focus-picker"
      style={style}
      role="slider"
      tabIndex={0}
      aria-label="Focus point"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={x}
      aria-valuetext={`${x}% across, ${y}% down`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        place(event);
      }}
      onPointerMove={(event) => event.buttons && place(event)}
      onDoubleClick={() => onChange(undefined)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
          event.key
        ];
        if (!move) return;
        event.preventDefault();
        const next = [Math.min(100, Math.max(0, x + move[0])), Math.min(100, Math.max(0, y + move[1]))];
        onChange(next[0] === 50 && next[1] === 50 ? undefined : next);
      }}
    >
      <span className="studio-focus-dot" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
    </div>
  );
}

const BLUR_STEPS = { off: 0, soft: 4, strong: 10 };

// How the chosen background sits in its card: fit, focus point, shade, blur
// and Match theme. Each value is stored only when it differs from the
// default for that background.
export function BackgroundAdjust({ background, tokens, onChange }) {
  const family = familyOf(background) || "upload";
  const raster = family === "scene" || family === "upload";
  const tiledByDefault = family === "pattern";
  const set = (key, value, fallback) => {
    const next = { ...background };
    if (value === undefined || value === fallback) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const blur = Object.entries(BLUR_STEPS).find(([, px]) => px === (background.blur || 0))?.[0] || "soft";
  const fitOptions = tiledByDefault
    ? [
        ["tile", "Tile"],
        ["fill", "Fill"],
      ]
    : [
        ["fill", "Fill"],
        ["fit", "Fit"],
      ];
  const fitValue = background.fit || (tiledByDefault ? "tile" : "fill");
  return (
    <>
      <Row label="Fit">
        <Segmented
          label="Fit"
          value={fitValue}
          onChange={(value) => set("fit", value, tiledByDefault ? "tile" : "fill")}
          options={fitOptions}
        />
      </Row>
      {fitValue !== "tile" && (
        <Row
          label="Focus"
          stacked
          info="Drag the point that should stay in view on small cards and phones. Double-click to centre it."
        >
          <FocusPicker background={background} tokens={tokens} onChange={(value) => set("focus", value)} />
        </Row>
      )}
      <Row label="Shade" info="Auto shades the picture just enough to keep every label readable (4.5:1).">
        <Segmented
          label="Shade"
          value={background.shade || "auto"}
          onChange={(value) => set("shade", value, "auto")}
          options={[
            ["auto", "Auto"],
            ["light", "Light"],
            ["medium", "Medium"],
            ["strong", "Strong"],
          ]}
        />
      </Row>
      <Row label="Blur">
        <Segmented
          label="Blur"
          value={blur}
          onChange={(value) => set("blur", BLUR_STEPS[value], 0)}
          options={[
            ["off", "Off"],
            ["soft", "Soft"],
            ["strong", "Strong"],
          ]}
        />
      </Row>
      {raster && (
        <Row
          label="Match theme"
          info="Repaints the picture in two of the theme's own colours, and again whenever the theme changes."
        >
          <Switch
            label="Match theme"
            checked={Boolean(background.matchTheme)}
            onChange={(on) => set("matchTheme", on || undefined)}
          />
        </Row>
      )}
    </>
  );
}

// A page's own background. Left alone, the page follows the dashboard's page
// background (Appearance); choosing that same background again follows it
// again (Rule 2), and None turns it off for this page only.
export function PageBackgroundEditor({ page, dashboardBackground, tokens, onApply, onClose }) {
  const [value, setValue] = useState(page.background);
  const effective = value ?? dashboardBackground ?? null;
  const chosen = effective?.source === "builtin" || effective?.source === "library" ? effective : null;
  const store = (next) =>
    setValue(JSON.stringify(next ?? null) === JSON.stringify(dashboardBackground ?? null) ? undefined : next);
  return (
    <>
      <div className="studio-dialog-body">
        <p className="studio-note">
          {value === undefined
            ? dashboardBackground
              ? "This page uses the dashboard's page background."
              : "This page has no background."
            : "This page has its own background."}
        </p>
        <div className="studio-inline-actions">
          <button
            type="button"
            className="studio-button studio-quiet"
            aria-pressed={!chosen}
            onClick={() => store(dashboardBackground ? { source: "none" } : undefined)}
          >
            None
          </button>
        </div>
        <BackgroundGrid
          fill="page"
          value={chosen}
          tokens={tokens}
          onPick={(id, source) => store({ ...(chosen?.id === id ? chosen : {}), source, id })}
        />
        {chosen && (
          <div className="studio-group-body studio-background-adjust">
            <BackgroundAdjust background={chosen} tokens={tokens} onChange={store} />
          </div>
        )}
      </div>
      <footer className="studio-dialog-footer">
        <span className="studio-footer-spacer" />
        <button type="button" className="studio-button studio-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="studio-button studio-primary"
          disabled={JSON.stringify(value ?? null) === JSON.stringify(page.background ?? null)}
          onClick={() => onApply(value)}
        >
          Apply to arrangement
        </button>
      </footer>
    </>
  );
}

// One background setting in a form: its name, and Choose to open the
// built-in backgrounds and the adjust rows below it.
export function BackgroundField({ label, fill, value, tokens, onChange, allowNone = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const name = backgroundName(value);
  return (
    <>
      <Row label={label}>
        <div className="studio-inline-actions">
          <span className="studio-row-value">{name || "None"}</span>
          {allowNone && value && (
            <button type="button" className="studio-button studio-quiet" onClick={() => onChange(undefined)}>
              Remove
            </button>
          )}
          <button
            type="button"
            className="studio-button studio-quiet"
            aria-expanded={open}
            onClick={() => setOpen((shown) => !shown)}
          >
            {open ? "Done" : "Choose"}
          </button>
        </div>
      </Row>
      {open && (
        <Row label="" stacked>
          <BackgroundGrid
            fill={fill}
            value={value}
            tokens={tokens}
            onPick={(id, source) => onChange({ ...(value?.id === id ? value : {}), source, id })}
          />
        </Row>
      )}
      {value && <BackgroundAdjust background={value} tokens={tokens} onChange={onChange} />}
    </>
  );
}
