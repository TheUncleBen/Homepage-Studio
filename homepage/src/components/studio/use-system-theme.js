import { useEffect, useState } from "react";

// The SSR shell has its own media query; this keeps native React widgets and
// the settings preview in sync with subsequent device scheme changes.
export default function useSystemTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setDark(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  return dark;
}
