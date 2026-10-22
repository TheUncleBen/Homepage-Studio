import { withPageAuth } from "utils/auth";
import { getSettings } from "utils/config/config";
import themes from "utils/styles/themes";

async function getProps({ res }) {
  const settings = getSettings();

  const palette = themes[settings.color] || themes.slate;
  const color = palette[settings.theme === "light" ? "light" : "dark"];

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
    <msapplication>
        <tile>
            <square150x150logo src="/mstile-150x150.png?v=2"/>
            <TileColor>${color}</TileColor>
        </tile>
    </msapplication>
</browserconfig>`;

  res.setHeader("Content-Type", "text/xml");
  res.setHeader("Cache-Control", "no-store");
  res.write(xml);
  res.end();

  return {
    props: {},
  };
}

export default function BrowserConfig() {}

export const getServerSideProps = withPageAuth(getProps);
