import { describe, expect, it, vi } from "vitest";

import { appearanceTokens } from "components/studio/appearance.mjs";

const { getSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("utils/config/config", () => ({
  getSettings,
}));

import BrowserConfig, { getServerSideProps } from "pages/browserconfig.xml.jsx";

function createMockRes() {
  return {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
}

describe("pages/browserconfig.xml", () => {
  it("writes a browserconfig xml response using the Studio base colour", async () => {
    getSettings.mockReturnValueOnce({ color: "red", theme: "dark", studioTheme: { base: "forest" } });
    const res = createMockRes();

    await getServerSideProps({ res });

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/xml");
    expect(res.end).toHaveBeenCalled();

    const xml = res.write.mock.calls[0][0];
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(xml).toContain('<square150x150logo src="/mstile-150x150.png?v=2"/>');
    expect(xml).toContain(
      `<TileColor>${appearanceTokens({ studioTheme: { base: "forest" } }, true).tokens.bg}</TileColor>`,
    );
  });

  it("exports a placeholder component", () => {
    expect(BrowserConfig()).toBeUndefined();
  });
});
