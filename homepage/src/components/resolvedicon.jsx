import Image from "next/image";
import { useContext, useState } from "react";

import { useCardTheme } from "components/studio/card-look";
import { dashboardPath } from "components/studio/dashboard-path.mjs";
import { builtInIcon, builtInIconCdnUrl, builtInIconUrl } from "components/studio/icon-source.mjs";
import { SettingsContext } from "utils/contexts/settings";
import { ThemeContext } from "utils/contexts/theme";

const iconSetURLs = {
  mdi: "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/",
  si: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/",
};

export default function ResolvedIcon({ icon, width = 32, height = 32, alt = "logo" }) {
  const { settings } = useContext(SettingsContext);
  const { theme } = useContext(ThemeContext);
  // Studio's own light or dark mode decides which version of a logo shows.
  const { mode } = useCardTheme();

  // direct or relative URLs; Studio uploads live under the dashboard's address
  if (icon.startsWith("http") || icon.startsWith("/")) {
    return (
      <Image
        src={icon.startsWith("/studio/api/images/") ? dashboardPath(icon) : icon}
        width={width}
        height={height}
        style={{
          width,
          height,
          objectFit: "contain",
          maxHeight: "100%",
          maxWidth: "100%",
        }}
        alt={alt}
      />
    );
  }

  // check mdi- or si- prefixed icons
  const prefix = icon.split("-")[0];

  if (prefix === "sh") {
    const iconName = icon.replace("sh-", "").replace(".svg", "").replace(".png", "").replace(".webp", "");

    let extension;
    if (icon.endsWith(".svg")) {
      extension = "svg";
    } else if (icon.endsWith(".webp")) {
      extension = "webp";
    } else {
      extension = "png";
    }

    return (
      <Image
        src={`https://cdn.jsdelivr.net/gh/selfhst/icons@main/${extension}/${iconName}.${extension}`}
        width={width}
        height={height}
        style={{
          width,
          height,
          objectFit: "contain",
          maxHeight: "100%",
          maxWidth: "100%",
        }}
        alt={alt}
      />
    );
  }

  if (prefix in iconSetURLs) {
    // default to theme setting
    let iconName = icon.replace(`${prefix}-`, "").replace(".svg", "");
    let iconColor =
      settings.iconStyle === "theme"
        ? `rgb(var(--color-${theme === "dark" ? 300 : 900}) / var(--tw-text-opacity, 1))`
        : "linear-gradient(180deg, rgb(var(--color-logo-start)), rgb(var(--color-logo-stop)))";

    // use custom hex color if provided
    const colorMatches = icon.match(/[#][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]$/i);
    if (colorMatches?.length) {
      iconName = icon.replace(`${prefix}-`, "").replace(".svg", "").replace(`-${colorMatches[0]}`, "");
      iconColor = `${colorMatches[0]}`;
    }

    const iconSource = `${iconSetURLs[prefix]}${iconName}.svg`;

    return (
      <div
        style={{
          width,
          height,
          maxWidth: "100%",
          maxHeight: "100%",
          background: `${iconColor}`,
          mask: `url(${iconSource}) no-repeat center / contain`,
          WebkitMask: `url(${iconSource}) no-repeat center / contain`,
        }}
      />
    );
  }

  // fallback to dashboard-icons (Studio's built-in logos)
  const builtIn = builtInIcon(icon);
  if (!builtIn) return null;
  return <BuiltInLogo key={icon} builtIn={builtIn} dark={mode === "dark"} width={width} height={height} alt={alt} />;
}

// The offline copy, or the project's CDN for a name newer than the pinned set.
function BuiltInLogo({ builtIn, dark, width, height, alt }) {
  const [offline, setOffline] = useState(true);
  return (
    <Image
      src={offline ? builtInIconUrl(builtIn.name, { dark }) : builtInIconCdnUrl(builtIn.name, builtIn)}
      onError={offline ? () => setOffline(false) : undefined}
      width={width}
      height={height}
      style={{
        width,
        height,
        objectFit: "contain",
        maxHeight: "100%",
        maxWidth: "100%",
      }}
      alt={alt}
    />
  );
}
