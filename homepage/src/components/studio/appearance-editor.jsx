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
import useSystemTheme from "./use-system-theme";

const MODE_LABELS = { dark: "Dark", light: "Light", system: "Follow device" };

// Each setting either follows the platform default from Administration →
// Appearance or is this dashboard's own; changing one doesn't touch others.
export default function AppearanceEditor({ settings, platform, logo, onLogoChange, onChange, onValidity }) {
  const own = ownAppearance(settings);
  const effective = applyPlatformDefaults(settings, platform);
  const appearance = appearanceConfig(effective);
  const [accentText, setAccentText] = useState(appearance.accent);
  const lastTheme = useRef(settings.studioTheme);
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
    const original =
      current && typeof current === "object" && !Array.isArray(current)
        ? current
        : {};
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
    Object.entries(preview.tokens).map(([key, value]) => [
      `--studio-${key}`,
      value,
    ]),
  );

  return (
    <section
      className="studio-appearance"
      aria-labelledby="studio-appearance-heading"
    >
      <h3 id="studio-appearance-heading">Appearance</h3>
      <p className="studio-note">
        Choose a look for this dashboard. Changes apply when you save settings.
      </p>
      <div className="studio-appearance-layout">
        <div className="studio-appearance-controls">
          <div className="studio-field">
            <label htmlFor="studio-display-mode">Display mode</label>
            <select
              id="studio-display-mode"
              value={own.mode ? appearance.mode : "platform"}
              onChange={(event) =>
                change({ mode: event.target.value === "platform" ? undefined : event.target.value })
              }
            >
              <option value="platform">Platform default ({platformMode})</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Follow device</option>
            </select>
          </div>
          <label className="studio-checkbox-field">
            <input
              type="checkbox"
              checked={!own.accent}
              onChange={(event) => {
                if (event.target.checked) {
                  setAccentText(platformAccent);
                  change({ accent: undefined });
                } else pickAccent(appearance.accent);
              }}
            />
            <span>Use the platform accent color ({platformAccent})</span>
          </label>
          <div className="studio-field">
            <label htmlFor="studio-accent-text">Accent color</label>
            <div className="studio-color-input">
              <input
                type="color"
                aria-label="Choose accent color"
                value={appearance.accent}
                disabled={!own.accent}
                onChange={(event) => pickAccent(event.target.value)}
              />
              <input
                id="studio-accent-text"
                disabled={!own.accent}
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
            </div>
            {!valid && (
              <span id="studio-accent-error" className="studio-field-error">
                Use a hex color such as #b299be.
              </span>
            )}
          </div>
          <div className="studio-accent-presets" aria-label="Accent presets">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                disabled={!own.accent}
                aria-pressed={own.accent && appearance.accent === preset.color}
                onClick={() => pickAccent(preset.color)}
              >
                <span aria-hidden="true" style={{ background: preset.color }} />
                {preset.name}
              </button>
            ))}
          </div>
        </div>
        <div
          className="studio-appearance-preview"
          style={previewStyle}
          aria-label="Appearance preview"
        >
          <span className="studio-eyebrow">Your dashboard</span>
          <strong>Homepage Studio</strong>
          <span className="studio-appearance-preview-note">
            Your links, widgets and services.
          </span>
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
      <p className="studio-note">
        {platform?.background
          ? "Without a background of its own, this dashboard uses the platform background. "
          : ""}
        Background images and native widget colors are in this dashboard&apos;s settings. For finer control, an
        administrator can edit custom.css in Configuration files.
      </p>
    </section>
  );
}
