import { dashboardContext, dashboardPath } from "components/studio/dashboard-path.mjs";
import { withPageAuth } from "utils/auth";
import checkAndCopyConfig, { getSettings } from "utils/config/config";
import themes from "utils/styles/themes";

function withinScope(path, basePath) {
  const scoped = dashboardPath(path, basePath);
  return basePath &&
    typeof scoped === "string" &&
    (scoped === basePath || scoped.startsWith(`${basePath}?`) || scoped.startsWith(`${basePath}#`))
    ? `${basePath}/${scoped.slice(basePath.length)}`
    : scoped;
}

async function getProps({ res }) {
  checkAndCopyConfig("settings.yaml");
  const settings = getSettings();

  const palette = themes[settings.color] || themes.slate;
  const color = palette[settings.theme === "light" ? "light" : "dark"];
  const dashboard = dashboardContext();
  const scope = `${dashboard.basePath}/`;
  const requestedStart = withinScope(settings.startUrl || "/", dashboard.basePath);

  const pwa = settings.pwa || {};

  const manifest = {
    id: `/studio/install/${dashboard.id}`,
    name: settings.title || "Homepage",
    short_name: settings.title || "Homepage",
    icons: pwa.icons || [
      {
        src: "/studio/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/studio/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    shortcuts: Array.isArray(pwa.shortcuts)
      ? pwa.shortcuts.map((shortcut) => ({ ...shortcut, url: withinScope(shortcut.url, dashboard.basePath) }))
      : pwa.shortcuts,
    theme_color: color,
    background_color: color,
    display: "standalone",
    scope,
    start_url: requestedStart,
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "no-store");
  res.write(JSON.stringify(manifest));
  res.end();

  return {
    props: {},
  };
}

export default function Webmanifest() {
  return null;
}

export const getServerSideProps = withPageAuth(getProps);
