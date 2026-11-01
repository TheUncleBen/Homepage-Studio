import { useState } from "react";

import { ABSTRACT, builtInFamily, PATTERNS, scenePath, SCENES, themedSvg } from "./backgrounds.mjs";
import { dashboardPath } from "./dashboard-path.mjs";
import { Row, Segmented, Switch } from "./ui";

// Which built-in families a fill offers: Picture shows scenes (and uploads),
// Pattern shows the abstract designs and patterns.
export const FILL_FAMILIES = {
  picture: ["scene"],
  pattern: ["abstract", "pattern"],
  page: ["scene", "abstract", "pattern"],
};
const FAMILY_LABEL = { scene: "Scenes", abstract: "Abstract", pattern: "Patterns" };
const FAMILY_ITEMS = { scene: SCENES, abstract: ABSTRACT, pattern: PATTERNS };

export function backgroundName(background) {
  if (!background?.id) return null;
  if (background.source !== "builtin") return "Uploaded image";
  const family = builtInFamily(background.id);
  return family ? FAMILY_ITEMS[family].find((item) => item.id === background.id)?.name : null;
}

function thumbStyle(family, id, tokens) {
  if (family === "scene")
    return { backgroundImage: `url("${dashboardPath(scenePath(id, true))}")`, backgroundSize: "cover" };
  const url = themedSvg(id, tokens);
  return { backgroundImage: `url("${url}")`, backgroundSize: family === "pattern" ? "auto" : "cover" };
}

// The built-in backgrounds for one fill, by family. Scenes can be narrowed
// to the ones that suit a dark or a light theme.
export function BackgroundGrid({ fill, value, tokens, onPick }) {
  const families = FILL_FAMILIES[fill] || [];
  const current = value?.source === "builtin" ? builtInFamily(value.id) : null;
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
              onClick={() => onPick(item.id)}
            >
              <span className="studio-background-thumb" style={thumbStyle(family, item.id, tokens)} />
              <span className="studio-background-name">{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Click or drag on the thumbnail to choose the point that stays in view;
// double-click centres it again.
function FocusPicker({ background, tokens, onChange }) {
  const family = builtInFamily(background.id) || "upload";
  const style =
    family === "upload"
      ? {
          backgroundImage: `url("${dashboardPath(`/studio/api/images/${encodeURIComponent(background.id)}`)}")`,
          backgroundSize: "cover",
        }
      : thumbStyle(family, background.id, tokens);
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
  const family = builtInFamily(background.id) || "upload";
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
          onPick={(id) => store({ ...(chosen?.id === id ? chosen : {}), source: "builtin", id })}
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
            onPick={(id) => onChange({ ...(value?.id === id ? value : {}), source: "builtin", id })}
          />
        </Row>
      )}
      {value && <BackgroundAdjust background={value} tokens={tokens} onChange={onChange} />}
    </>
  );
}
