import { useEffect, useRef, useState } from "react";

import {
  ACCENT_PRESETS,
  appearanceConfig,
  appearanceTokens,
  applyPlatformDefaults,
  hexColor,
  ownAppearance,
} from "./appearance.mjs";
import LogoEditor from "./logo-editor";
import { Group, Row, Segmented } from "./ui";
import useSystemTheme from "./use-system-theme";

const MODE_LABELS = { dark: "Dark", light: "Light", system: "Auto" };

// Each setting either follows the platform default from Administration →
// Appearance or is this dashboard's own; changing one doesn't touch others.
export default function AppearanceEditor({
  settings,
  platform,
  logo,
  onLogoChange,
  onChange,
  onValidity,
  saveLabel = "Save settings",
}) {
  const own = ownAppearance(settings);
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
  const platformMode = MODE_LABELS[platform?.mode] || "Dark";
  const platformAccent = hexColor(platform?.accent) || "#b299be";
  const pickAccent = (color) => {
    setAccentText(color);
    change({ accent: color });
  };
  const preview = appearanceTokens(effective, systemDark);
  const previewStyle = Object.fromEntries(
    Object.entries(preview.tokens).map(([key, value]) => [`--studio-${key}`, value]),
  );

  const custom = own.accent && !ACCENT_PRESETS.some((preset) => preset.color === appearance.accent);
  return (
    <section className="studio-appearance" aria-label="Appearance">
      <div className="studio-appearance-layout">
        <Group
          title="Appearance"
          info={`Default follows the look an administrator sets for every dashboard (${platformMode}, ${platformAccent}). Changes apply when you choose ${saveLabel}.`}
        >
          <Row label="Mode">
            <Segmented
              label="Display mode"
              value={own.mode ? appearance.mode : "platform"}
              onChange={(next) => change({ mode: next === "platform" ? undefined : next })}
              options={[
                ["platform", "Default"],
                ["dark", "Dark"],
                ["light", "Light"],
                ["system", "Auto"],
              ]}
            />
          </Row>
          <Row label="Accent" stacked>
            <div className="studio-swatches" role="group" aria-label="Accent">
              <button
                type="button"
                className="studio-swatch studio-swatch-default"
                aria-pressed={!own.accent}
                aria-label={`Default (${platformAccent})`}
                title={`Default (${platformAccent})`}
                style={{ "--swatch": platformAccent }}
                onClick={() => {
                  setAccentText(platformAccent);
                  change({ accent: undefined });
                }}
              >
                <span aria-hidden="true" />
              </button>
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="studio-swatch"
                  aria-pressed={Boolean(own.accent) && appearance.accent === preset.color}
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
            {own.accent && (
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
                    if (color) change({ accent: color });
                  }}
                />
                {!valid && (
                  <span id="studio-accent-error" className="studio-field-error">
                    Use a hex color such as #b299be.
                  </span>
                )}
              </div>
            )}
          </Row>
        </Group>
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
