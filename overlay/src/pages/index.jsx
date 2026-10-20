import { useTranslation } from "next-i18next/pages";
import Head from "next/head";
import Script from "next/script";
import { useContext, useEffect, useMemo, useState } from "react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";

import QuickLaunch from "components/quicklaunch";
import { studioRequest } from "components/studio/api.mjs";
import StudioBoard from "components/studio/board";
import { flattenServices } from "components/studio/native-adapter.mjs";
import { withPageAuth } from "utils/auth";
import { getDashboardData } from "utils/config/dashboard";
import { ColorContext } from "utils/contexts/color";
import { SettingsContext } from "utils/contexts/settings";
import { StudioRevisionContext } from "utils/contexts/studio-revision";
import { ThemeContext } from "utils/contexts/theme";

export const getServerSideProps = withPageAuth(async () => ({
  props: await getDashboardData(),
}));

export default function HomepageStudio(props) {
  // Native children such as Quick Launch read their original SWR keys during
  // SSR. Keep Homepage's sanitized fallback available to the whole page.
  return (
    <SWRConfig value={{ fallback: props.fallback }}>
      <StudioDashboard {...props} />
    </SWRConfig>
  );
}

function StudioDashboard({ initialSettings, fallback }) {
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
  const [searchString, setSearchString] = useState("");
  const [assetsVersion, setAssetsVersion] = useState(0);
  const settings = data?.settings || initialSettings;
  const background = settings.background;
  const backgroundImage =
    typeof background === "string" ? background : background?.image;
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
    setTheme(settings.theme || "dark");
    setColor(settings.color || "slate");
    document.documentElement.classList.toggle(
      "font-plex",
      settings.font === "plex",
    );
    document.documentElement.classList.toggle(
      "font-plex-data",
      settings.font === "plex-data",
    );
    const language =
      settings.language?.toLowerCase() === "zh-cn"
        ? "zh-Hans"
        : settings.language || "en";
    if (i18n.changeLanguage && i18n.language !== language)
      i18n.changeLanguage(language);
  }, [settings, setSettings, setTheme, setColor, i18n]);
  useEffect(() => {
    const key = (event) => {
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
  }, []);
  const refresh = async () => {
    await studioRequest("/api/revalidate");
    const updated = await mutate();
    await Promise.all([
      mutateNative("/api/services", updated.services, { revalidate: false }),
      mutateNative("/api/widgets", updated.widgets, { revalidate: false }),
      mutateNative("/api/bookmarks", updated.bookmarks, { revalidate: false }),
    ]);
    setAssetsVersion((value) => value + 1);
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
                    background.blur !== undefined &&
                      `blur(${blur[background.blur] || "8px"})`,
                    background.saturate !== undefined &&
                      `saturate(${Number(background.saturate)}%)`,
                    background.brightness !== undefined &&
                      `brightness(${Number(background.brightness)}%)`,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                : undefined,
          }}
        />
      )}
      <Head>
        <title>{settings.title || "Homepage Studio"}</title>
        <meta
          name="description"
          content={settings.description || "Your personal Homepage dashboard"}
        />
        <link rel="icon" href={settings.favicon || "/favicon.ico"} />
        <link
          rel="stylesheet"
          href={`/api/config/custom.css?v=${assetsVersion}`}
        />
      </Head>
      <Script src="/api/config/custom.js" strategy="afterInteractive" />
      {error && (
        <div className="studio-native-error" role="status">
          Native widget data is temporarily unavailable. The board remains
          editable.
        </div>
      )}
      <StudioBoard
        nativeData={data}
        settings={settings}
        onNativeChange={refresh}
        onSearch={() => setSearching(true)}
      />
      <QuickLaunch
        servicesAndBookmarks={searchItems}
        searchString={searchString}
        setSearchString={setSearchString}
        isOpen={searching}
        setSearching={setSearching}
      />
    </StudioRevisionContext.Provider>
  );
}
