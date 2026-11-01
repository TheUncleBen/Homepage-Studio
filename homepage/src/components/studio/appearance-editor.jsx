import { useEffect, useRef, useState } from "react";

import {
  ACCENT_PRESETS,
  appearanceConfig,
  appearanceTokens,
  applyPlatformDefaults,
  BASES,
  DEFAULT_ACCENT,
  DEFAULT_BASE,
  hexColor,
} from "./appearance.mjs";
import { BUILT_IN_LOOK, readLook, setOverride } from "./look.mjs";
import LogoEditor from "./logo-editor";
import { Group, Row, Segmented } from "./ui";
import useSystemTheme from "./use-system-theme";

// What a dashboard gets when it sets nothing: the platform defaults from
// Administration → Appearance, or the built-in Graphite and eggplant.
function platformDefaults(platform) {
  return {
    mode: ["dark", "light", "system"].includes(platform?.mode) ? platform.mode : "dark",
    accent: hexColor(platform?.accent) || DEFAULT_ACCENT,
    base: Object.hasOwn(BASES, platform?.base) ? platform.base : DEFAULT_BASE,
  };
}

// Rule 2: a dashboard stores a row only while it differs from the platform
// default; choosing the default's value removes the key. There is no
// separate "Default" choice.
export default function AppearanceEditor({ settings, platform, logo, onLogoChange, onChange, onValidity }) {
  const fallback = platformDefaults(platform);
  const effective = applyPlatformDefaults(settings, platform);
  const appearance = appearanceConfig(effective);
  const [accentText, setAccentText] = useState(appearance.accent);
  const lastTheme = useRef(settings.studioTheme);
  const colorInput = useRef(null);
  const systemDark = useSystemTheme();
  const valid = Boolean(hexColor(accentText));
  useEffect(() => {
    onValidity?.(valid);
  }, [valid, onValidity]);
  useEffect(() => {
    if (lastTheme.current !== settings.studioTheme) {
      lastTheme.current = settings.studioTheme;
      setAccentText(appearance.accent);
    }
  }, [appearance.accent, settings.studioTheme]);

  const change = (next) => {
    const current = settings.studioTheme;
    const original = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const studioTheme = { ...original, ...next };
    for (const [key, value] of Object.entries(next)) if (value === undefined) delete studioTheme[key];
    const updated = { ...settings, studioTheme };
    if (Object.hasOwn(next, "mode")) {
      if (next.mode === "system" || next.mode === undefined) delete updated.theme;
      else updated.theme = next.mode;
    }
    if (!Object.keys(studioTheme).length) delete updated.studioTheme;
    lastTheme.current = updated.studioTheme;
    onChange(updated);
  };
  const own = (key, value) => change({ [key]: value === fallback[key] ? undefined : value });
  const pickAccent = (color) => {
    setAccentText(color);
    own("accent", color);
  };
  const rawCard = settings.studioTheme?.card;
  const card = readLook(rawCard);
  const cardLook = { ...BUILT_IN_LOOK, ...card };
  const setCard = (key, value) => change({ card: setOverride(card, key, value, BUILT_IN_LOOK) });
  const preview = appearanceTokens(effective, systemDark);
  const previewStyle = Object.fromEntries(
    Object.entries(preview.tokens).map(([key, value]) => [`--studio-${key}`, value]),
  );
  const custom = !ACCENT_PRESETS.some((preset) => preset.color === appearance.accent);
  return (
    <section className="studio-appearance" aria-label="Appearance">
      <div className="studio-appearance-layout">
        <div className="studio-appearance-groups">
          <Group
            title="Appearance"
            info="Rows you leave alone follow the look an administrator sets for every dashboard. Choosing that same value again follows it again."
          >
            <Row label="Mode">
              <Segmented
                label="Display mode"
                value={appearance.mode}
                onChange={(next) => own("mode", next)}
                options={[
                  ["system", "Follow device"],
                  ["dark", "Dark"],
                  ["light", "Light"],
                ]}
              />
            </Row>
            <Row label="Base" stacked info="The page, cards and lines. Each base has a dark and a light version.">
              <div className="studio-swatches studio-base-swatches" role="radiogroup" aria-label="Base">
                {Object.entries(BASES).map(([id, base]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    className="studio-base-swatch"
                    aria-checked={appearance.base === id}
                    style={{
                      "--swatch-page": base[preview.mode].bg,
                      "--swatch-card": base[preview.mode].raised,
                      "--swatch-line": base[preview.mode]["line-strong"],
                    }}
                    onClick={() => own("base", id)}
                  >
                    <span aria-hidden="true" />
                    {base.name}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent" stacked info="Buttons, links and focus rings. Any colour works; Studio fits it to stay readable.">
              <div className="studio-swatches" role="group" aria-label="Accent">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="studio-swatch"
                    aria-pressed={appearance.accent === preset.color}
                    aria-label={preset.name}
                    title={preset.name}
                    style={{ "--swatch": preset.color }}
                    onClick={() => pickAccent(preset.color)}
                  >
                    <span aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  className="studio-swatch studio-swatch-custom"
                  aria-pressed={custom}
                  aria-label="Custom"
                  title="Custom"
                  style={{ "--swatch": custom ? appearance.accent : "transparent" }}
                  onClick={() => colorInput.current?.click()}
                >
                  <span aria-hidden="true" />
                </button>
                <input
                  ref={colorInput}
                  type="color"
                  className="studio-color-well"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={appearance.accent}
                  onChange={(event) => pickAccent(event.target.value)}
                />
              </div>
              <div className="studio-hex">
                <input
                  id="studio-accent-text"
                  aria-label="Accent color"
                  value={accentText}
                  maxLength={7}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? "studio-accent-error" : undefined}
                  onChange={(event) => {
                    setAccentText(event.target.value);
                    const color = hexColor(event.target.value);
                    if (color) own("accent", color);
                  }}
                />
                {!valid && (
                  <span id="studio-accent-error" className="studio-field-error">
                    Use a hex color such as #b299be.
                  </span>
                )}
              </div>
            </Row>
          </Group>
          <Group
            title="Cards"
            info="Every widget starts with these. A widget that changes one in its own settings keeps its value; setting it back to the same value follows these again."
          >
            <Row label="Layout">
              <Segmented
                label="Card layout"
                value={cardLook.layout}
                onChange={(value) => setCard("layout", value)}
                options={[
                  ["hero", "Hero"],
                  ["quiet", "Quiet"],
                ]}
              />
            </Row>
            <Row label="Fill">
              <Segmented
                label="Card fill"
                value={["plain", "tint", "solid"].includes(cardLook.fill) ? cardLook.fill : "plain"}
                onChange={(value) => setCard("fill", value)}
                options={[
                  ["plain", "Plain"],
                  ["tint", "Tint"],
                  ["solid", "Solid"],
                ]}
              />
            </Row>
            {(cardLook.fill === "tint" || cardLook.fill === "solid") && (
              <div className="studio-row-dependent">
                <Row label="Strength">
                  <Segmented
                    label="Fill strength"
                    value={cardLook.strength}
                    onChange={(value) => setCard("strength", value)}
                    options={[
                      ["soft", "Soft"],
                      ["medium", "Medium"],
                      ["strong", "Strong"],
                    ]}
                  />
                </Row>
              </div>
            )}
            <Row label="Edge">
              <Segmented
                label="Card edge"
                value={cardLook.edge}
                onChange={(value) => setCard("edge", value)}
                options={[
                  ["line", "Line"],
                  ["shadow", "Shadow"],
                  ["both", "Both"],
                  ["none", "None"],
                ]}
              />
            </Row>
            <Row label="Corners">
              <Segmented
                label="Card corners"
                value={cardLook.corners}
                onChange={(value) => setCard("corners", value)}
                options={[
                  ["square", "Square"],
                  ["default", "Default"],
                  ["round", "Round"],
                ]}
              />
            </Row>
            <Row label="Numbers">
              <Segmented
                label="Number font"
                value={cardLook.numbers}
                onChange={(value) => setCard("numbers", value)}
                options={[
                  ["sans", "Regular"],
                  ["mono", "Monospaced"],
                ]}
              />
            </Row>
          </Group>
        </div>
        <div className="studio-appearance-preview" style={previewStyle} aria-label="Appearance preview">
          <strong>{settings.title || "Your dashboard"}</strong>
          <div aria-hidden="true" className="studio-appearance-preview-panels">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>
              <i />
              <i />
            </span>
          </div>
          <span className="studio-appearance-preview-action">Add a widget</span>
        </div>
      </div>
      {onLogoChange && <LogoEditor logo={logo} onChange={onLogoChange} />}
    </section>
  );
}
