import { useTranslation } from "next-i18next/pages";
import Head from "next/head";
import Script from "next/script";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";

import { studioRequest } from "components/studio/api.mjs";
import { appearanceStyles, appearanceTokens } from "components/studio/appearance.mjs";
import StudioBoard from "components/studio/board";
import { dashboardContext, dashboardPath } from "components/studio/dashboard-path.mjs";
import { PreferencesContext, viewedSettings } from "components/studio/preferences";
import useSystemTheme from "components/studio/use-system-theme";
import { withPageAuth } from "utils/auth";
import { getDashboardData } from "utils/config/dashboard";
import { readPlatformDefaults } from "utils/config/platform";
import { ColorContext } from "utils/contexts/color";
import { SettingsContext } from "utils/contexts/settings";
import { StudioRevisionContext } from "utils/contexts/studio-revision";
import { ThemeContext } from "utils/contexts/theme";

export const getServerSideProps = withPageAuth(async ({ res } = {}) => {
  const data = await getDashboardData();
  if (data.initialSettings?.disableIndexing) res?.setHeader("X-Robots-Tag", "noindex, nofollow");
  return {
    props: { ...data, platformRevision: readPlatformDefaults()?.revision ?? null, studioDashboard: dashboardContext() },
  };
});

export default function HomepageStudio(props) {
  // Native children such as Quick Launch read their original SWR keys during
  // SSR. Keep Homepage's sanitized fallback available to the whole page.
  return (
    <SWRConfig value={{ fallback: props.fallback }}>
      <StudioDashboard {...props} />
    </SWRConfig>
  );
}

function StudioDashboard({
  initialSettings,
  fallback,
  platformRevision = null,
  studioDashboard = { id: "default", basePath: "" },
  studioMode = "live",
}) {
  const { i18n } = useTranslation();
  const { setSettings } = useContext(SettingsContext);
  const { setTheme } = useContext(ThemeContext);
  const { setColor } = useContext(ColorContext);
  const { mutate: mutateNative } = useSWRConfig();
  const { data, error, mutate } = useSWR("/api/studio/data", studioRequest, {
    fallbackData: {
      settings: initialSettings,
      services: fallback["/api/services"],
      widgets: fallback["/api/widgets"],
      bookmarks: fallback["/api/bookmarks"],
      protocolVersion: 1,
      platformRevision,
    },
    refreshInterval: 30000,
  });
  // The viewer's own preferences (Account › Preferences); defaults without sign-in.
  const { data: personal } = useSWR("/studio/api/preferences", studioRequest, { revalidateOnFocus: true });
  const preferences = useMemo(() => personal?.preferences || {}, [personal]);
  const [searching, setSearching] = useState(false);
  const [interactionBlocked, setInteractionBlocked] = useState(true);
  const [searchString, setSearchString] = useState("");
  const [assetsVersion, setAssetsVersion] = useState(0);
  // Saving the default look in Administration tells this browser's open
  // dashboards at once; other devices see it on their next refresh.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const channel = new BroadcastChannel("studio-platform");
    channel.onmessage = () => mutate();
    return () => channel.close();
  }, [mutate]);
  const systemDark = useSystemTheme();
  const settings = viewedSettings(data?.settings || initialSettings, preferences, studioMode !== "live");
  const displayMode = appearanceTokens(settings, systemDark).mode;
  const background = settings.background;
  const backgroundImage = typeof background === "string" ? background : background?.image;
  const backgroundOpacity =
    typeof background === "object" && background?.opacity !== undefined
      ? 1 - Number(background.opacity) / 100
      : Number(settings.backgroundOpacity ?? 0);
  const blur = {
    none: "0",
    sm: "4px",
    "": "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    "2xl": "40px",
    "3xl": "64px",
  };
  useEffect(() => {
    setSettings(settings);
    setTheme(displayMode);
    setColor(settings.color || "slate");
    document.documentElement.classList.toggle("font-plex", settings.font === "plex");
    document.documentElement.classList.toggle("font-plex-data", settings.font === "plex-data");
    const language = settings.language?.toLowerCase() === "zh-cn" ? "zh-Hans" : settings.language || "en";
    if (i18n.changeLanguage && i18n.language !== language) i18n.changeLanguage(language);
  }, [settings, displayMode, setSettings, setTheme, setColor, i18n]);
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.motion === "reduced" || preferences.motion === "full") root.dataset.motion = preferences.motion;
    else delete root.dataset.motion;
  }, [preferences.motion]);
  const reportInteractionBlocked = useCallback((blocked) => {
    setInteractionBlocked(blocked);
    if (blocked) setSearching(false);
  }, []);
  useEffect(() => {
    const key = (event) => {
      // The dashboard claims page keys (1-9, [ ], ?) before this runs. Search
      // is for viewing; while editing, letters are the widget shortcuts.
      if (interactionBlocked || event.defaultPrevented || studioMode !== "live") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching((value) => !value);
      } else if (
        event.target === document.body &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setSearchString(event.key === " " || event.key === "/" ? "" : event.key);
        setSearching(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [interactionBlocked, studioMode]);
  const refresh = async () => {
    await studioRequest("/api/revalidate");
    const updated = await mutate();
    await Promise.all([
      mutateNative("/api/services", updated.services, { revalidate: false }),
      mutateNative("/api/widgets", updated.widgets, { revalidate: false }),
      mutateNative("/api/bookmarks", updated.bookmarks, { revalidate: false }),
    ]);
    setAssetsVersion((value) => value + 1);
    return updated;
  };
  return (
    <StudioRevisionContext.Provider value={data?.configurationRevision || null}>
      {backgroundImage && (
        <div
          className="studio-native-background"
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(rgba(18, 16, 21, ${Math.max(0, Math.min(1, backgroundOpacity))}), rgba(18, 16, 21, ${Math.max(0, Math.min(1, backgroundOpacity))})), url(${JSON.stringify(backgroundImage)})`,
            filter:
              typeof background === "object"
                ? [
                    background.blur !== undefined && `blur(${blur[background.blur] || "8px"})`,
                    background.saturate !== undefined && `saturate(${Number(background.saturate)}%)`,
                    background.brightness !== undefined && `brightness(${Number(background.brightness)}%)`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                : undefined,
          }}
        />
      )}
      <Head>
        <meta name="studio-dashboard-id" content={studioDashboard.id} />
        <meta name="studio-dashboard-base" content={studioDashboard.basePath} />
        {settings.disableIndexing && <meta name="robots" content="noindex, nofollow" />}
        <style
          key="studio-appearance"
          data-studio-appearance
          dangerouslySetInnerHTML={{ __html: appearanceStyles(settings) }}
        />
        <title>{settings.title || "Dashboard"}</title>
        <meta name="description" content={settings.description || "Your personal Homepage dashboard"} />
        <link rel="icon" href={settings.favicon || dashboardPath("/studio/logo", studioDashboard.basePath)} />
        <link rel="apple-touch-icon" href="/studio/brand/apple-touch-icon.png" />
        {/* The platform CSS from Administration loads first; this dashboard's
            own custom.css adds to it. A dashboard can switch it off. */}
        {settings.studioTheme?.platformCss !== false && (
          <link
            rel="stylesheet"
            href={`/studio/platform.css${data?.platformRevision ? `?v=${encodeURIComponent(data.platformRevision)}` : ""}`}
          />
        )}
        <link
          rel="stylesheet"
          href={dashboardPath(`/api/config/custom.css?v=${assetsVersion}`, studioDashboard.basePath)}
        />
      </Head>
      <Script src={dashboardPath("/api/config/custom.js", studioDashboard.basePath)} strategy="afterInteractive" />
      {error && (
        <div className="studio-native-error" role="status">
          Native widget data is temporarily unavailable. Retry the widget refresh when the renderer is available.
        </div>
      )}
      <PreferencesContext.Provider value={preferences}>
        <StudioBoard
          dashboard={studioDashboard}
          mode={studioMode}
          nativeData={data}
          settings={settings}
          onNativeChange={refresh}
          onInteractionBlocked={reportInteractionBlocked}
          overlayOpen={searching && !interactionBlocked}
          onSearch={() => {
            if (!interactionBlocked) {
              setSearchString("");
              setSearching(true);
            }
          }}
          search={{
            open: searching && !interactionBlocked,
            query: searchString,
            onQuery: setSearchString,
            onClose: () => {
              setSearching(false);
              setSearchString("");
            },
          }}
        />
      </PreferencesContext.Provider>
    </StudioRevisionContext.Provider>
  );
}
