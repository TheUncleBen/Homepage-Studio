import { afterEach, describe, expect, it, vi } from "vitest";

import { studioRequest } from "./api.mjs";

afterEach(() => vi.unstubAllGlobals());
describe("Studio request boundary", () => {
  it("rejects oversized UTF-8 saves before sending and retains server conflict details", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      studioRequest("/__studio/api/save", { customCss: "界".repeat(700000) }),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Another editor saved", revision: "new" }),
    });
    await expect(
      studioRequest("/__studio/api/board", { revision: "old", board: {} }),
    ).rejects.toMatchObject({ status: 409, details: { revision: "new" } });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      method: "POST",
      headers: { "x-studio-request": "1" },
    });
  });
  it("reports unreadable responses without pretending a save succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("HTML");
        },
      })),
    );
    await expect(studioRequest("/__studio/api/state")).rejects.toThrow(
      /unreadable response/,
    );
  });
});
