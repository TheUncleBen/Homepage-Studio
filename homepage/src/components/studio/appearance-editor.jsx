import { useEffect, useRef, useState } from "react";

import {
  ACCENT_PRESETS,
  appearanceConfig,
  appearanceTokens,
  hexColor,
} from "./appearance.mjs";
import useSystemTheme from "./use-system-theme";

export default function AppearanceEditor({ settings, onChange, onValidity }) {
  const appearance = appearanceConfig(settings);
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
    const updated = { ...settings, studioTheme: { ...original, ...next } };
    if (next.mode === "system") delete updated.theme;
    else if (next.mode) updated.theme = next.mode;
    lastTheme.current = updated.studioTheme;
    onChange(updated);
  };
  const pickAccent = (color) => {
    setAccentText(color);
    change({ accent: color });
  };
  const preview = appearanceTokens(settings, systemDark);
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
              value={appearance.mode}
              onChange={(event) => change({ mode: event.target.value })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Follow device</option>
            </select>
          </div>
          <div className="studio-field">
            <label htmlFor="studio-accent-text">Accent color</label>
            <div className="studio-color-input">
              <input
                type="color"
                aria-label="Choose accent color"
                value={appearance.accent}
                onChange={(event) => pickAccent(event.target.value)}
              />
              <input
                id="studio-accent-text"
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
                aria-pressed={appearance.accent === preset.color}
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
      <p className="studio-note">
        Background images and native widget colors are available below. For
        finer control, edit custom.css in Configuration files.
      </p>
    </section>
  );
}
