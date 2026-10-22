import { useTranslation } from "next-i18next/pages";
import Head from "next/head";
import Script from "next/script";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";

import QuickLaunch from "components/quicklaunch";
import { studioRequest } from "components/studio/api.mjs";
import { appearanceStyles, appearanceTokens } from "components/studio/appearance.mjs";
import StudioBoard from "components/studio/board";
import { dashboardContext, dashboardPath } from "components/studio/dashboard-path.mjs";
import { flattenServices } from "components/studio/native-adapter.mjs";
import useSystemTheme from "components/studio/use-system-theme";
import { withPageAuth } from "utils/auth";
import { getDashboardData } from "utils/config/dashboard";
import { ColorContext } from "utils/contexts/color";
import { SettingsContext } from "utils/contexts/settings";
import { StudioRevisionContext } from "utils/contexts/studio-revision";
import { ThemeContext } from "utils/contexts/theme";

export const getServerSideProps = withPageAuth(async ({ res } = {}) => {
  const data = await getDashboardData();
  if (data.initialSettings?.disableIndexing) res?.setHeader("X-Robots-Tag", "noindex, nofollow");
  return { props: { ...data, studioDashboard: dashboardContext() } };
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

function StudioDashboard({ initialSettings, fallback, studioDashboard = { id: "default", basePath: "" } }) {
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
    },
    refreshInterval: 30000,
  });
  const [searching, setSearching] = useState(false);
  const [interactionBlocked, setInteractionBlocked] = useState(true);
  const [searchString, setSearchString] = useState("");
  const [assetsVersion, setAssetsVersion] = useState(0);
  const systemDark = useSystemTheme();
  const settings = data?.settings || initialSettings;
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
  const searchItems = useMemo(
    () =>
      [
        ...(data?.bookmarks || []).flatMap((group) => group.bookmarks),
        ...flattenServices(data?.services).map((entry) => entry.service),
      ].filter((item) => item?.href),
    [data],
  );
  useEffect(() => {
    setSettings(settings);
    setTheme(displayMode);
    setColor(settings.color || "slate");
    document.documentElement.classList.toggle("font-plex", settings.font === "plex");
    document.documentElement.classList.toggle("font-plex-data", settings.font === "plex-data");
    const language = settings.language?.toLowerCase() === "zh-cn" ? "zh-Hans" : settings.language || "en";
    if (i18n.changeLanguage && i18n.language !== language) i18n.changeLanguage(language);
  }, [settings, displayMode, setSettings, setTheme, setColor, i18n]);
  const reportInteractionBlocked = useCallback((blocked) => {
    setInteractionBlocked(blocked);
    if (blocked) setSearching(false);
  }, []);
  const changeSearching = useCallback(
    (next) => {
      setSearching((current) => (interactionBlocked ? false : typeof next === "function" ? next(current) : next));
    },
    [interactionBlocked],
  );
  useEffect(() => {
    const key = (event) => {
      if (interactionBlocked) return;
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
        setSearchString(event.key === " " ? "" : event.key);
        setSearching(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [interactionBlocked]);
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
        <title>{settings.title || "Homepage Studio"}</title>
        <meta name="description" content={settings.description || "Your personal Homepage dashboard"} />
        <link rel="icon" href={settings.favicon || "/homepage.ico"} />
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
      <StudioBoard
        dashboard={studioDashboard}
        nativeData={data}
        settings={settings}
        onNativeChange={refresh}
        onInteractionBlocked={reportInteractionBlocked}
        overlayOpen={searching && !interactionBlocked}
        onSearch={() => {
          if (!interactionBlocked) setSearching(true);
        }}
      />
      <div className="studio-quicklaunch" inert={interactionBlocked} aria-hidden={interactionBlocked || undefined}>
        <QuickLaunch
          servicesAndBookmarks={searchItems}
          searchString={searchString}
          setSearchString={setSearchString}
          isOpen={searching && !interactionBlocked}
          setSearching={changeSearching}
        />
      </div>
    </StudioRevisionContext.Provider>
  );
}
