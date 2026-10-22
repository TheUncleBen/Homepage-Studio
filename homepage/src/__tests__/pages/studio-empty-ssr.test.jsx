// @vitest-environment node
// Exercise the real file readers, page, native Quick Launch and SWR fallback.
// Do not mock those boundaries: missing page-level fallback is an SSR failure.
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import cache from "memory-cache";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emptyFiles = {
  "services.yaml": "[]\n",
  "widgets.yaml": "[]\n",
  "bookmarks.yaml": "[]\n",
  "settings.yaml": "{}\n",
  "docker.yaml": "{}\n",
  "kubernetes.yaml": "{}\n",
  "proxmox.yaml": "{}\n",
  "custom.css": "",
  "custom.js": "",
};
let directory;
let nativeImports;
let nativeModules;
beforeEach(async () => {
  nativeImports = null;
  nativeModules = null;
  vi.resetModules();
  cache.clear();
  directory = await mkdtemp(join(tmpdir(), "homepage-studio-empty-ssr-"));
  await Promise.all(
    Object.entries(emptyFiles).map(([name, text]) =>
      writeFile(join(directory, name), text),
    ),
  );
  vi.stubEnv("HOMEPAGE_CONFIG_DIR", directory);
  vi.stubEnv("LOG_TARGETS", "stdout");
  // Cold transforms of the real application belong to bounded setup, not the
  // render/assertion timeout. Keep the fixture alive until those imports settle.
  nativeImports = (async () => {
    const { default: App } = await import("pages/_app");
    const { default: Page, getServerSideProps } = await import("pages/index");
    const { SWRConfig } = await import("swr");
    return { App, Page, getServerSideProps, SWRConfig };
  })();
  nativeModules = await nativeImports;
}, 30000);
afterEach(async () => {
  // A timed-out setup does not cancel dynamic imports. Drain them before an
  // env/directory reset can make native initialization install sample files.
  await nativeImports?.catch(() => {});
  cache.clear();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
}, 30000);

async function renderPage() {
  const { App, Page, getServerSideProps, SWRConfig } = nativeModules;
  const { props } = await getServerSideProps({
    req: { headers: { host: "127.0.0.1:3000" } },
    res: { setHeader() {} },
  });
  const html = renderToString(
    <SWRConfig value={{ provider: () => new Map() }}>
      <App Component={Page} pageProps={props} />
    </SWRConfig>,
  );
  return { props, html };
}

function expectServerControlsUnavailable(html) {
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  for (const label of ["Dashboard settings", "Quick Launch"])
    expect(
      buttons.find((button) => button.includes(`aria-label="${label}"`)),
    ).toContain('disabled=""');
  const quickLaunch = html.match(
    /<div\b[^>]*class="studio-quicklaunch"[^>]*>/,
  )?.[0];
  expect(quickLaunch).toContain('inert=""');
  expect(quickLaunch).toContain('aria-hidden="true"');
}

describe("Studio real native server render", () => {
  it("renders with exactly nine empty native files and a fresh SWR cache without installing samples", async () => {
    const { props, html } = await renderPage();
    expect(props.initialSettings).toEqual({});
    expect(props.fallback["/api/widgets"]).toEqual([]);
    expect(props.fallback["/api/services"]).toEqual([]);
    expect(props.fallback["/api/bookmarks"]).toEqual([]);
    expect(html).toContain('class="studio-app"');
    expect(html).toContain("Quick Launch");
    expectServerControlsUnavailable(html);
    expect(html).not.toContain("data-panel-id");
    expect((await readdir(directory)).sort()).toEqual(
      Object.keys(emptyFiles).sort(),
    );
    await Promise.all(
      Object.entries(emptyFiles).map(async ([name, text]) =>
        expect(await readFile(join(directory, name), "utf8")).toBe(text),
      ),
    );
  });

  it("keeps persisted native widgets and sanitized source data in the SSR fallback", async () => {
    await writeFile(
      join(directory, "widgets.yaml"),
      JSON.stringify([
        { search: { provider: "duckduckgo", target: "_blank" } },
        { greeting: { text: "Persisted greeting" } },
      ]),
    );
    await writeFile(
      join(directory, "settings.yaml"),
      JSON.stringify({
        title: "Persisted Studio",
        quicklaunch: { mobileButtonPosition: "bottom-right" },
        providers: { weatherapi: "fictional-provider-secret" },
      }),
    );
    await writeFile(
      join(directory, "services.yaml"),
      JSON.stringify([
        {
          Media: [
            {
              Library: {
                href: "https://example.test/",
                widget: {
                  type: "sonarr",
                  url: "http://fixture.invalid",
                  key: "fictional-service-secret",
                },
              },
            },
          ],
        },
      ]),
    );
    await writeFile(
      join(directory, "bookmarks.yaml"),
      JSON.stringify([
        { Links: [{ Docs: [{ href: "https://docs.example.test/" }] }] },
      ]),
    );
    const { props, html } = await renderPage();
    expect(props.fallback["/api/widgets"].map((widget) => widget.type)).toEqual(
      ["search", "greeting"],
    );
    expect(props.fallback["/api/widgets"][0].options.provider).toBe(
      "duckduckgo",
    );
    expect(props.fallback["/api/widgets"][1].options.text).toBe(
      "Persisted greeting",
    );
    expect(props.fallback["/api/services"][0].services[0].widgets[0].type).toBe(
      "sonarr",
    );
    expect(props.fallback["/api/bookmarks"][0].bookmarks[0].href).toBe(
      "https://docs.example.test/",
    );
    expect(props.initialSettings).toEqual({
      title: "Persisted Studio",
      quicklaunch: { mobileButtonPosition: "bottom-right" },
    });
    expect(JSON.stringify(props) + html).not.toContain(
      "fictional-provider-secret",
    );
    expect(JSON.stringify(props) + html).not.toContain(
      "fictional-service-secret",
    );
    expect(html).toContain('class="studio-app"');
    expect(html).toContain("Quick Launch");
    expectServerControlsUnavailable(html);
  });
});
