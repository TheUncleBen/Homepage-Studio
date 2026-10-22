import { Head, Html, Main, NextScript } from "next/document";

import { dashboardContext, dashboardPath } from "components/studio/dashboard-path.mjs";

export default function Document() {
  const dashboard = dashboardContext();
  return (
    <Html>
      <Head>
        <meta name="studio-dashboard-id" content={dashboard.id} />
        <meta name="studio-dashboard-base" content={dashboard.basePath} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-config" content={dashboardPath("/browserconfig.xml", dashboard.basePath)} />
        <link
          rel="manifest"
          href={dashboardPath("/site.webmanifest?v=4", dashboard.basePath)}
          crossOrigin="use-credentials"
        />
        <link rel="preload" href={dashboardPath("/api/config/custom.css", dashboard.basePath)} as="style" />
        <link rel="stylesheet" href={dashboardPath("/api/config/custom.css", dashboard.basePath)} /> {}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
