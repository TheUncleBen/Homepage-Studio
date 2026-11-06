import { createContext, useContext, useEffect, useState } from "react";

// The viewer's own preferences (Account › Preferences, server/personal.mjs).
// Only keys that differ from the default are stored, so every reader falls
// back to the default below.
export const PREFERENCE_DEFAULTS = Object.freeze({
  searchEngine: "google",
  searchSuggestions: true,
  searchDescriptions: true,
  searchAddresses: true,
  searchOpens: "same",
  mode: "dashboard",
  motion: "system",
  clock: "dashboard",
  temperature: "dashboard",
});

// Web search engines. Suggestions come through the dashboard's own server
// (native /api/search/searchSuggestion) for the engines it knows.
export const SEARCH_ENGINES = Object.freeze({
  google: { name: "Google", url: "https://www.google.com/search?q=%s", suggestions: "Google" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", suggestions: "DuckDuckGo" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s", suggestions: "Bing" },
  brave: { name: "Brave", url: "https://search.brave.com/search?q=%s", suggestions: "Brave" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q=%s" },
});

export const PreferencesContext = createContext({});

export function usePreferences() {
  const stored = useContext(PreferencesContext) || {};
  return { ...PREFERENCE_DEFAULTS, ...stored };
}

// The engine a person searches the web with: a known one, or their custom
// address (which needs %s where the search goes).
export function searchEngine(preferences) {
  if (preferences.searchEngine === "custom" && typeof preferences.searchUrl === "string")
    return { name: "your search engine", custom: true, url: preferences.searchUrl };
  return SEARCH_ENGINES[preferences.searchEngine] || SEARCH_ENGINES.google;
}

export const searchAddress = (engine, query) => engine.url.replace(/%s/g, encodeURIComponent(query));

// Settings as this viewer sees them while viewing: their light or dark
// choice wins over the dashboard's. Editing always shows the dashboard's own.
export function viewedSettings(settings, preferences, editing) {
  if (editing || !["system", "dark", "light"].includes(preferences?.mode)) return settings;
  const theme = settings?.studioTheme && typeof settings.studioTheme === "object" ? settings.studioTheme : {};
  return { ...settings, studioTheme: { ...theme, mode: preferences.mode } };
}

// Whether motion is reduced: the viewer's choice, else their device's.
export function useReducedMotion() {
  const { motion } = usePreferences();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystem(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return motion === "reduced" ? true : motion === "full" ? false : system;
}

// Clock and temperature choices applied to an information widget's options.
export function withDisplayPreferences(widget, preferences) {
  if (!widget?.options) return widget;
  const options = { ...widget.options };
  if (widget.type === "datetime" && preferences.clock !== "dashboard") {
    options.format = { ...(options.format || {}), hour12: preferences.clock === "12" };
    // hourCycle would win over hour12, so the person's choice removes it.
    delete options.format.hourCycle;
  }
  if (preferences.temperature !== "dashboard") {
    const metric = preferences.temperature === "c";
    if (["openmeteo", "openweathermap", "weatherapi", "resources", "glances"].includes(widget.type))
      options.units = metric ? "metric" : "imperial";
  }
  return { ...widget, options };
}
