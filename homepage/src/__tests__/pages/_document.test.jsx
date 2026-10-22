import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/document", () => ({
  Html: ({ children }) => <div data-testid="html">{children}</div>,
  Head: ({ children }) => <div data-testid="head">{children}</div>,
  Main: () => <main data-testid="main" />,
  NextScript: () => <script data-testid="nextscript" />,
}));

import Document from "pages/_document.jsx";

describe("pages/_document", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("renders the PWA meta + custom css links", () => {
    const html = renderToStaticMarkup(<Document />);

    expect(html).toContain('meta name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('meta name="msapplication-config" content="/browserconfig.xml"');
    expect(html).toContain('link rel="manifest" href="/site.webmanifest?v=4"');
    expect(html).toContain('link rel="preload" href="/api/config/custom.css" as="style"');
    expect(html).toContain('link rel="stylesheet" href="/api/config/custom.css"');
    expect(html).toContain('data-testid="main"');
    expect(html).toContain('data-testid="nextscript"');
  });

  it.each([
    ["10d16ad0-34be-4cb8-a459-7365f2aaab71", "/family"],
    ["default", "/admin"],
  ])("publishes immutable %s metadata and scopes config and manifest URLs at %s", (id, basePath) => {
    vi.stubEnv("STUDIO_DASHBOARD_ID", id);
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", basePath);
    const html = renderToStaticMarkup(<Document />);
    expect(html).toContain(`meta name="studio-dashboard-id" content="${id}"`);
    expect(html).toContain(`meta name="studio-dashboard-base" content="${basePath}"`);
    expect(html).toContain(`meta name="msapplication-config" content="${basePath}/browserconfig.xml"`);
    expect(html).toContain(`href="${basePath}/site.webmanifest?v=4"`);
    expect(html).toContain(`href="${basePath}/api/config/custom.css"`);
    expect(html.indexOf('name="studio-dashboard-id"')).toBeLessThan(html.indexOf('data-testid="nextscript"'));
  });
});
