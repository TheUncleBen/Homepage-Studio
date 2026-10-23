// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FILES } from "./api.mjs";
import { EditorDraftContext } from "./draft-guard";
import SettingsEditor, {
  FilesEditor,
  SNAPSHOT_ACTION_LABELS,
  SnapshotEditor,
  snapshotActionLabel,
  snapshotAge,
} from "./settings-editor";

afterEach(() => vi.unstubAllGlobals());

describe("Appearance settings save", () => {
  it("shares one native draft with YAML, refuses invalid colors and preserves unrelated null values", async () => {
    const saved = { revision: "next" };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => saved,
    }));
    vi.stubGlobal("fetch", fetch);
    const onSaved = vi.fn();
    render(
      <SettingsEditor
        state={{
          revision: "target",
          settingsConfig: { title: "Keep", untouched: null },
        }}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    fireEvent.change(screen.getByLabelText("Display mode"), {
      target: { value: "light" },
    });
    expect(screen.getByLabelText("Item configuration YAML").value).toContain("mode: light");
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#nothex" },
    });
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ocean", exact: true }));
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      revision: "target",
      config: {
        theme: "light",
        studioTheme: { mode: "light", accent: "#81a8c8" },
      },
    });
  });
});

const completeArchive = () => ({
  version: 1,
  files: Object.fromEntries([
    ...FILES.map(([name]) => [name, ""]),
    ["state.json", '{"version":2,"board":{"panels":[],"stacks":[]}}'],
  ]),
});
const backupFile = (content, overrides = {}) => ({
  name: "dashboard.json",
  size: 1024,
  text: async () => JSON.stringify(content),
  ...overrides,
});

describe("Portable dashboard import", () => {
  it("stages a complete archive without a request and imports only on explicit confirmation using the target revision", async () => {
    const content = completeArchive();
    const restored = {
      revision: "imported",
      customJs: "window.fixture = 'new';",
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => restored,
    }));
    vi.stubGlobal("fetch", fetch);
    const onSaved = vi.fn(),
      report = vi.fn();
    render(
      <EditorDraftContext.Provider value={report}>
        <SnapshotEditor
          state={{ revision: "current-target", customJs: "" }}
          backups={[]}
          onSaved={onSaved}
          onClose={vi.fn()}
        />
      </EditorDraftContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText("Dashboard backup file"), {
      target: { files: [backupFile(content)] },
    });
    await screen.findByText("Replace this dashboard with dashboard.json?");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import dashboard", exact: true }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(restored, { customJsChanged: true }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/__studio/api/import");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      revision: "current-target",
      archive: content,
    });
    expect(report).toHaveBeenCalledWith({ dirty: true, pending: true });
  });

  it("treats a picked but unimported backup as an unsaved draft until it is cleared", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const report = vi.fn();
    render(
      <EditorDraftContext.Provider value={report}>
        <SnapshotEditor state={{ revision: "target" }} backups={[]} onSaved={vi.fn()} onClose={vi.fn()} />
      </EditorDraftContext.Provider>,
    );
    expect(report).toHaveBeenLastCalledWith({ dirty: false, pending: false });
    fireEvent.change(screen.getByLabelText("Dashboard backup file"), {
      target: { files: [backupFile(completeArchive())] },
    });
    await screen.findByText("Replace this dashboard with dashboard.json?");
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    fireEvent.click(screen.getByRole("button", { name: "Clear selected backup", exact: true }));
    expect(report).toHaveBeenLastCalledWith({ dirty: false, pending: false });
  });

  it.each([
    ["incomplete", backupFile({ version: 1, files: { "settings.yaml": "{}" } }), /complete dashboard/],
    ["oversized", backupFile({}, { size: 40 * 1024 * 1024 + 1 }), /40 MiB/],
    [
      "unreadable",
      backupFile(
        {},
        {
          text: async () => {
            throw new Error("file read failed");
          },
        },
      ),
      /could not be read/,
    ],
  ])("rejects an %s archive before any request and clears a previous selection", async (_, file, message) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<SnapshotEditor state={{ revision: "target" }} backups={[]} onSaved={vi.fn()} onClose={vi.fn()} />);
    const chooser = screen.getByLabelText("Dashboard backup file");
    fireEvent.change(chooser, {
      target: { files: [backupFile(completeArchive())] },
    });
    await screen.findByText("Replace this dashboard with dashboard.json?");
    fireEvent.change(chooser, { target: { files: [file] } });
    await screen.findByText(message);
    expect(screen.queryByRole("button", { name: "Import dashboard", exact: true })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains a selected archive on a conflicting target revision and offers explicit reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Another change was saved",
          revision: "new-target",
        }),
      })),
    );
    const onSaved = vi.fn(),
      onReload = vi.fn();
    render(
      <SnapshotEditor
        state={{ revision: "old-target" }}
        backups={[]}
        onSaved={onSaved}
        onClose={vi.fn()}
        onReload={onReload}
      />,
    );
    fireEvent.change(screen.getByLabelText("Dashboard backup file"), {
      target: { files: [backupFile(completeArchive())] },
    });
    await screen.findByText("Replace this dashboard with dashboard.json?");
    fireEvent.click(screen.getByRole("button", { name: "Import dashboard", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another change was saved");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("Replace this dashboard with dashboard.json?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload current configuration" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("Local configuration file imports", () => {
  it("offers a focusable button for the file picker and keeps imported text local until Save", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const report = vi.fn();
    render(
      <EditorDraftContext.Provider value={report}>
        <FilesEditor state={{ revision: "before", servicesYaml: "[]\n" }} onSaved={vi.fn()} onClose={vi.fn()} />
      </EditorDraftContext.Provider>,
    );
    const chooser = screen.getByLabelText("Import configuration file");
    const open = vi.spyOn(chooser, "click");
    const button = screen.getByRole("button", {
      name: "Import into this file",
    });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    const text = "- Imported:\n    - Example:\n        href: https://example.com\n";
    fireEvent.change(chooser, {
      target: { files: [{ size: text.length, text: async () => text }] },
    });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "services.yaml" })).toHaveValue(text));
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeEnabled();
  });

  it("shows the controller's YAML line and column for a rejected save", async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "services.yaml contains invalid YAML at line 2, column 9.", code: "INVALID_YAML" }),
    }));
    vi.stubGlobal("fetch", fetch);
    render(
      <EditorDraftContext.Provider value={vi.fn()}>
        <FilesEditor state={{ revision: "before", servicesYaml: "[]\n" }} onSaved={vi.fn()} onClose={vi.fn()} />
      </EditorDraftContext.Provider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "services.yaml" }), {
      target: { value: "- Group:\n  - a: [b\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("line 2, column 9");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks draft mutation during an asynchronous file read and preserves the draft on a read failure", async () => {
    let reject;
    const reading = new Promise((_, fail) => {
      reject = fail;
    });
    const report = vi.fn();
    render(
      <EditorDraftContext.Provider value={report}>
        <FilesEditor state={{ revision: "before", servicesYaml: "[]\n" }} onSaved={vi.fn()} onClose={vi.fn()} />
      </EditorDraftContext.Provider>,
    );
    const editor = screen.getByRole("textbox", { name: "services.yaml" });
    fireEvent.change(editor, { target: { value: "# retained draft\n[]\n" } });
    fireEvent.change(screen.getByLabelText("Import configuration file"), {
      target: { files: [{ size: 1, text: () => reading }] },
    });
    expect(editor).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Configuration file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: true });
    await act(async () => reject(new Error("Fixture file could not be read")));
    expect(screen.getByText("Fixture file could not be read")).toBeInTheDocument();
    expect(editor).toHaveValue("# retained draft\n[]\n");
    expect(editor).toBeEnabled();
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
  });
});

describe("Snapshot restoration reload handoff", () => {
  it.each([
    ["changed script", "window.fixture = 'current';", "window.fixture = 'restored';", true],
    ["removed script", "window.fixture = 'current';", "", true],
    ["unchanged script", "window.fixture = 'same';", "window.fixture = 'same';", false],
  ])("compares actual current and restored JavaScript for a %s", async (_, currentJs, restoredJs, reload) => {
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
    fireEvent.click(screen.getByRole("button", { name: "Restore selected snapshot" }));

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
  });
});

describe("Snapshot action and age", () => {
  afterEach(() => vi.useRealTimers());

  it("labels every recorded action code and gives older or unknown snapshots a neutral label", () => {
    expect(snapshotActionLabel("settings-saved")).toBe("Appearance and settings saved");
    expect(snapshotActionLabel("arrangement-saved")).toBe("Arrangement saved");
    expect(snapshotActionLabel("files-saved")).toBe("Configuration files saved");
    expect(snapshotActionLabel("snapshot-restored")).toBe("Snapshot restored");
    expect(snapshotActionLabel("dashboard-imported")).toBe("Dashboard imported");
    expect(snapshotActionLabel("info-widget-deleted")).toBe("Information widget deleted");
    expect(Object.keys(SNAPSHOT_ACTION_LABELS)).toHaveLength(19);
    for (const label of Object.values(SNAPSHOT_ACTION_LABELS)) expect(label).toMatch(/^[A-Z][a-z ]+$/);
    for (const action of [undefined, null, "", "future-operation", "constructor", "toString", 7])
      expect(snapshotActionLabel(action)).toBe("Saved change");
  });

  it("formats a relative age without future wording", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const at = (seconds) => new Date(now - seconds * 1000).toISOString();
    expect(snapshotAge(at(20), now, "en")).toBe("just now");
    expect(snapshotAge(at(-120), now, "en")).toBe("just now");
    expect(snapshotAge(at(5 * 60), now, "en")).toBe("5 minutes ago");
    expect(snapshotAge(at(2 * 60 * 60 + 59), now, "en")).toBe("2 hours ago");
    expect(snapshotAge(at(30 * 60 * 60), now, "en")).toBe("yesterday");
    expect(snapshotAge(at(10 * 24 * 60 * 60), now, "en")).toBe("last week");
    expect(snapshotAge("not a time", now, "en")).toBe("");
  });

  it("shows the action and its age, keeps the exact time and files, and refreshes the age while open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    const createdAt = "2026-10-23T11:55:00.000Z";
    render(
      <SnapshotEditor
        state={{ revision: "r" }}
        backups={[
          { id: "backup-new", createdAt, changedFiles: ["settings.yaml", "state.json"], action: "settings-saved" },
          { id: "backup-old", createdAt, changedFiles: ["services.yaml"] },
        ]}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const exact = new Date(createdAt).toLocaleString();
    const fresh = screen.getByRole("button", { name: /^Appearance and settings saved, 5 minutes ago/ });
    expect(fresh).toHaveAccessibleName(
      `Appearance and settings saved, 5 minutes ago. ${exact}. settings.yaml, state.json`,
    );
    expect(fresh).toHaveTextContent("Appearance and settings saved · 5 minutes ago");
    expect(fresh).toHaveAttribute("aria-pressed", "false");
    const time = fresh.querySelector("time");
    expect(time).toHaveAttribute("dateTime", createdAt);
    expect(time).toHaveAttribute("title", exact);
    const legacy = screen.getByRole("button", { name: /^Saved change, 5 minutes ago/ });
    expect(legacy).toHaveTextContent("services.yaml");
    fireEvent.click(legacy);
    expect(legacy).toHaveAttribute("aria-pressed", "true");
    expect(fresh).toHaveAttribute("aria-pressed", "false");
    act(() => vi.advanceTimersByTime(60 * 1000));
    expect(fresh).toHaveTextContent("Appearance and settings saved · 6 minutes ago");
    expect(legacy).toHaveTextContent("Saved change · 6 minutes ago");
    expect(fresh).toHaveAccessibleName(/^Appearance and settings saved, 6 minutes ago\. /);
  });

  it.each([
    ["new", { action: "service-added" }, /^Service tile added/],
    ["older", {}, /^Saved change/],
  ])("exports and restores a %s snapshot by its ID", async (_, extra, name) => {
    const createObjectURL = vi.fn(() => "blob:snapshot");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const archive = { version: 1, before: {}, ...extra };
    const restored = { revision: "restored" };
    const fetch = vi.fn(async (target) => ({
      ok: true,
      status: 200,
      json: async () => (target.includes("backups") ? archive : restored),
    }));
    vi.stubGlobal("fetch", fetch);
    const onSaved = vi.fn();
    render(
      <SnapshotEditor
        state={{ revision: "current" }}
        backups={[{ id: "backup-1", createdAt: new Date().toISOString(), changedFiles: ["services.yaml"], ...extra }]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.click(screen.getByRole("button", { name: "Export pre-save snapshot" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toBe("/__studio/api/backups/backup-1");
    expect(JSON.parse(await createObjectURL.mock.calls[0][0].text())).toEqual(archive);
    fireEvent.click(screen.getByRole("button", { name: "Restore selected snapshot" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(restored, { customJsChanged: false }));
    expect(fetch.mock.calls[1][0]).toBe("/__studio/api/restore");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ revision: "current", backupId: "backup-1" });
    click.mockRestore();
  });
});
