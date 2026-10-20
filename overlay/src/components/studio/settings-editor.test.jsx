// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SnapshotEditor } from "./settings-editor";

afterEach(() => vi.unstubAllGlobals());

describe("Snapshot restoration reload handoff", () => {
  it.each([
    [
      "changed script",
      "window.fixture = 'current';",
      "window.fixture = 'restored';",
      true,
    ],
    ["removed script", "window.fixture = 'current';", "", true],
    [
      "unchanged script",
      "window.fixture = 'same';",
      "window.fixture = 'same';",
      false,
    ],
  ])(
    "compares actual current and restored JavaScript for a %s",
    async (_, currentJs, restoredJs, reload) => {
      const state = { revision: "current-revision", customJs: currentJs };
      const restored = { revision: "restored-revision", customJs: restoredJs };
      const fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => restored,
      }));
      vi.stubGlobal("fetch", fetch);
      const onSaved = vi.fn();
      render(
        <SnapshotEditor
          state={state}
          backups={[
            {
              id: "snapshot-fixture",
              createdAt: "2026-10-20T12:00:00Z",
              // Snapshot trigger metadata is not a comparison with the current files.
              changedFiles: ["services.yaml"],
            },
          ]}
          onSaved={onSaved}
          onClose={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /services\.yaml/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "Restore selected snapshot" }),
      );

      await waitFor(() =>
        expect(onSaved).toHaveBeenCalledWith(restored, {
          customJsChanged: reload,
        }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe("/__studio/api/restore");
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        revision: "current-revision",
        backupId: "snapshot-fixture",
      });
    },
  );
});
