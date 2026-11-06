// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { enableClientErrors, reportClientError, resetClientErrorsForTests } from "./client-errors.mjs";

afterEach(() => {
  resetClientErrorsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser widget errors", () => {
  it("sends nothing unless sign-in turned it on", () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    reportClientError({ panel: "a", message: "Sonarr: 401" });
    vi.advanceTimersByTime(5000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends each widget's message once, in batches", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetch);
    enableClientErrors(true);
    reportClientError({ panel: "a", widget: "sonarr", message: "Sonarr: 401" });
    reportClientError({ panel: "a", widget: "sonarr", message: "Sonarr: 401" });
    reportClientError({ panel: "b", widget: "plex", message: "Plex: refused" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toMatch(/\/studio\/api\/client-errors$/);
    expect(JSON.parse(options.body).errors).toEqual([
      { panel: "a", widget: "sonarr", message: "Sonarr: 401" },
      { panel: "b", widget: "plex", message: "Plex: refused" },
    ]);
  });
});
