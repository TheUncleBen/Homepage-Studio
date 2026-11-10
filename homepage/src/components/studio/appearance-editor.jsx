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
  parseColour,
} from "./appearance.mjs";
import { BackgroundField, familyOf, FILL_FAMILIES } from "./background-picker";
import { SPACING } from "./geometry.mjs";
import LogoEditor from "./logo-editor";
import { BUILT_IN_LOOK, readLook, setOverride } from "./look.mjs";
import { Group, Row, Segmented, Switch } from "./ui";
import useSystemTheme from "./use-system-theme";

// What a dashboard gets when it sets nothing: the platform defaults from
// Administration → Appearance, or the built-in Graphite and eggplant.
function platformDefaults(platform) {
  return {
    mode: ["dark", "light", "system"].includes(platform?.mode) ? platform.mode : "system",
    accent: hexColor(platform?.accent) || DEFAULT_ACCENT,
    base: Object.hasOwn(BASES, platform?.base) ? platform.base : DEFAULT_BASE,
  };
}

// Rule 2: a dashboard stores a row only while it differs from the platform
// default; choosing the default's value removes the key. There is no
// separate "Default" choice.
// name: the dashboard's name, as its top bar shows it.
export default function AppearanceEditor({ settings, platform, logo, name, onLogoChange, onChange, onValidity }) {
  const fallback = platformDefaults(platform);
  const effective = applyPlatformDefaults(settings, platform);
  const appearance = appearanceConfig(effective);
  const [accentText, setAccentText] = useState(appearance.accent);
  const lastTheme = useRef(settings.studioTheme);
  const colorInput = useRef(null);
  const systemDark = useSystemTheme();
  const valid = Boolean(parseColour(accentText));
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
  const pageBackground = readLook({ background: settings.studioTheme?.pageBackground }).background;
  // A background from the other kind of fill doesn't apply to it.
  const cardBackground = FILL_FAMILIES[cardLook.fill]?.includes(familyOf(card.background))
    ? card.background
    : undefined;
  const preview = appearanceTokens(effective, systemDark);
  const previewTheme = { ...preview.tokens, mode: preview.mode };
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
            <Row
              label="Accent"
              stacked
              info="Buttons, links and focus rings. Any colour works; Studio fits it to stay readable."
            >
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
                  maxLength={24}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? "studio-accent-error" : undefined}
                  onChange={(event) => {
                    setAccentText(event.target.value);
                    const color = parseColour(event.target.value);
                    if (color) own("accent", color);
                  }}
                />
                {!valid && (
                  <span id="studio-accent-error" className="studio-field-error">
                    Use hex, such as #b299be, or rgb, such as rgb(178, 153, 190).
                  </span>
                )}
              </div>
            </Row>
          </Group>
          <Group
            title="Cards"
            info="Every widget starts with these. A widget that changes one in its own settings keeps its value; setting it back to the same value follows these again."
          >
            <Row label="Fill">
              <Segmented
                label="Card fill"
                value={cardLook.fill}
                onChange={(value) => setCard("fill", value)}
                options={[
                  ["plain", "Plain"],
                  ["tint", "Tint"],
                  ["solid", "Solid"],
                  ["picture", "Picture"],
                  ["pattern", "Pattern"],
                ]}
              />
            </Row>
            {(cardLook.fill === "picture" || cardLook.fill === "pattern") && (
              <div className="studio-row-dependent">
                <BackgroundField
                  key={cardLook.fill}
                  label="Background"
                  fill={cardLook.fill}
                  value={cardBackground}
                  defaultOpen={!cardBackground}
                  tokens={previewTheme}
                  onChange={(value) => setCard("background", value)}
                />
              </div>
            )}
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
            <Row label="Spacing" info="The space between widgets.">
              <Segmented
                label="Spacing"
                value={
                  Object.hasOwn(SPACING, settings.studioTheme?.spacing ?? "") ? settings.studioTheme.spacing : "default"
                }
                onChange={(value) => change({ spacing: value === "default" ? undefined : value })}
                options={[
                  ["compact", "Compact"],
                  ["default", "Default"],
                  ["roomy", "Roomy"],
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
          <Group
            title="Page"
            info="A background for every page of this dashboard. A page can choose its own from its menu while editing."
          >
            <BackgroundField
              label="Background"
              fill="page"
              value={pageBackground}
              tokens={previewTheme}
              allowNone
              onChange={(value) =>
                // Rule 2: the administrator's default background again follows it.
                change({
                  pageBackground:
                    JSON.stringify(value ?? null) === JSON.stringify(platform?.background ?? null) ? undefined : value,
                })
              }
            />
            {pageBackground && (
              <Row label="Glass cards" info="Cards let the page background show through, softly blurred.">
                <Switch
                  label="Glass cards"
                  checked={Boolean(settings.studioTheme?.glass)}
                  onChange={(on) => change({ glass: on || undefined })}
                />
              </Row>
            )}
          </Group>
        </div>
        <div className="studio-appearance-preview" style={previewStyle} aria-label="Appearance preview">
          <span className="studio-look-preview-label" aria-hidden="true">
            Preview
          </span>
          <strong>{name || settings.title || "Your dashboard"}</strong>
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
          {/* The accent as Studio uses it: a selected tab's marker, not a
              button that looks clickable. */}
          <span className="studio-appearance-preview-tabs" aria-hidden="true">
            <span className="is-on">Home</span>
            <span>Media</span>
          </span>
        </div>
      </div>
      {onLogoChange && <LogoEditor logo={logo} onChange={onLogoChange} />}
    </section>
  );
}
