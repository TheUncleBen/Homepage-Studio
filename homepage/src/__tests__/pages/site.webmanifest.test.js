import { afterEach, describe, expect, it, vi } from "vitest";

import themes from "utils/styles/themes";

const { checkAndCopyConfig, getSettings } = vi.hoisted(() => ({
  checkAndCopyConfig: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("utils/config/config", () => ({
  default: checkAndCopyConfig,
  getSettings,
}));

import Webmanifest, { getServerSideProps } from "pages/site.webmanifest.jsx";

function createMockRes() {
  return {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
}

describe("pages/site.webmanifest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes a manifest json response and triggers a settings config check", async () => {
    getSettings.mockReturnValueOnce({
      title: "My Homepage",
      startUrl: "/start",
      color: "slate",
      theme: "dark",
      pwa: {
        icons: [{ src: "/i.png", sizes: "1x1", type: "image/png" }],
        shortcuts: [{ name: "One", url: "/one" }],
      },
    });

    const res = createMockRes();

    await getServerSideProps({ res });

    expect(checkAndCopyConfig).toHaveBeenCalledWith("settings.yaml");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/manifest+json");
    expect(res.end).toHaveBeenCalled();

    const manifest = JSON.parse(res.write.mock.calls[0][0]);
    expect(manifest.name).toBe("My Homepage");
    expect(manifest.short_name).toBe("My Homepage");
    expect(manifest.start_url).toBe("/start");
    expect(manifest.icons).toEqual([{ src: "/i.png", sizes: "1x1", type: "image/png" }]);
    expect(manifest.shortcuts).toEqual([{ name: "One", url: "/one" }]);
    expect(manifest.theme_color).toBe(themes.slate.dark);
    expect(manifest.background_color).toBe(themes.slate.dark);
  });

  it("uses sensible defaults when no settings are provided", async () => {
    getSettings.mockReturnValueOnce({});

    const res = createMockRes();

    await getServerSideProps({ res });

    const manifest = JSON.parse(res.write.mock.calls[0][0]);
    expect(manifest.name).toBe("Homepage");
    expect(manifest.short_name).toBe("Homepage");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe(themes.slate.dark);
    expect(manifest.background_color).toBe(themes.slate.dark);

    // Default icon set is used when pwa.icons is not set.
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: expect.stringContaining("/studio/brand/icon-192.png") }),
        expect.objectContaining({ src: expect.stringContaining("/studio/brand/icon-512.png") }),
      ]),
    );
  });

  it("respects provided pwa.icons even when it is an empty array", async () => {
    getSettings.mockReturnValueOnce({
      pwa: { icons: [] },
    });

    const res = createMockRes();

    await getServerSideProps({ res });

    const manifest = JSON.parse(res.write.mock.calls[0][0]);
    expect(manifest.icons).toEqual([]);
  });

  it("exports a placeholder component", () => {
    expect(Webmanifest()).toBeNull();
  });

  it("isolates installed dashboard identity and scope while keeping shared icons at the root", async () => {
    const id = "10d16ad0-34be-4cb8-a459-7365f2aaab71";
    vi.stubEnv("STUDIO_DASHBOARD_ID", id);
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/family");
    getSettings.mockReturnValueOnce({
      title: "Family",
      pwa: {
        shortcuts: [
          { name: "Home", url: "/" },
          { name: "Weather", url: "/weather" },
        ],
      },
    });
    const res = createMockRes();
    await getServerSideProps({ res });
    const manifest = JSON.parse(res.write.mock.calls[0][0]);
    expect(manifest.id).toBe(`/studio/install/${id}`);
    expect(manifest.scope).toBe("/family/");
    expect(manifest.start_url).toBe("/family/");
    expect(manifest.icons[0].src).toBe("/studio/brand/icon-192.png");
    expect(manifest.shortcuts.map(({ url }) => url)).toEqual(["/family/", "/family/weather"]);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");

    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/renamed");
    getSettings.mockReturnValueOnce({ title: "Family" });
    const renamedRes = createMockRes();
    await getServerSideProps({ res: renamedRes });
    const renamed = JSON.parse(renamedRes.write.mock.calls[0][0]);
    expect(renamed.id).toBe(manifest.id);
    expect(renamed.scope).toBe("/renamed/");
    expect(renamed.start_url).toBe("/renamed/");

    vi.stubEnv("STUDIO_DASHBOARD_ID", "20d16ad0-34be-4cb8-a459-7365f2aaab71");
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/work");
    getSettings.mockReturnValueOnce({ title: "Work", startUrl: "/work?tab=one" });
    const otherRes = createMockRes();
    await getServerSideProps({ res: otherRes });
    const other = JSON.parse(otherRes.write.mock.calls[0][0]);
    expect(other.id).not.toBe(manifest.id);
    expect(other.start_url).toBe("/work/?tab=one");
  });

  it("uses a valid fallback color for system or unknown theme names", async () => {
    getSettings.mockReturnValueOnce({ color: "unknown", theme: "system" });
    const res = createMockRes();
    await getServerSideProps({ res });
    expect(JSON.parse(res.write.mock.calls[0][0]).theme_color).toBe(themes.slate.dark);
  });
});
