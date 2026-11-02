// The languages Homepage ships translations for (public/locales). Shared by
// the controller (personal preferences) and the dashboard (translations).
export const LANGUAGES = Object.freeze([
  "af",
  "ar",
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "eo",
  "es",
  "eu",
  "fi",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lv",
  "ms",
  "nb-NO",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "te",
  "th",
  "tr",
  "uk",
  "vi",
  "yue",
  "zh-Hans",
  "zh-Hant",
]);

// A dashboard's own language, as Homepage reads settings.language.
export function dashboardLanguage(settings) {
  const raw = typeof settings?.language === "string" ? settings.language : "";
  if (raw.toLowerCase() === "zh-cn") return "zh-Hans";
  return raw || "en";
}

// A viewer's own language from the controller's header, when it is one of ours.
export const viewerLanguage = (value) => (typeof value === "string" && LANGUAGES.includes(value) ? value : null);
