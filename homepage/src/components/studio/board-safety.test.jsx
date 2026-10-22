// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";

vi.mock("./native-panel", async () => {
  const { resolveNativePanel } = await import("./native-adapter.mjs");
  return {
    default: ({ panel, data }) => (
      <>
        <input aria-label={`Native state ${panel.id}`} defaultValue="retained" />
        <output data-testid={`native-value-${panel.id}`}>
          {resolveNativePanel(panel, data)?.widget?.options?.fixtureValue}
        </output>
      </>
    ),
  };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

const CONFIG_A = "a".repeat(64);
const CONFIG_B = "b".repeat(64);
const board = {
  version: 2,
  columns: 12,
  panels: [
    {
      id: "clock",
      title: "Clock",
      group: "Information",
      kind: "informationWidget",
      rect: { x: 0, y: 0, w: 4, h: 3 },
    },
    {
      id: "search",
      title: "Search",
      group: "Information",
      kind: "informationWidget",
      rect: { x: 4, y: 0, w: 4, h: 3 },
    },
  ],
  stacks: [],
};
const initialState = {
  revision: "before",
  configurationRevision: CONFIG_A,
  board,
  settingsConfig: { title: "My dashboard" },
  servicesYaml: "[]\n",
  widgetsYaml: "[]\n",
  settingsYaml: "title: My dashboard\n",
  services: [],
  infoWidgets: [
    { id: "clock", type: "datetime", config: { locale: "en-US" } },
    { id: "search", type: "search", config: { provider: "duckduckgo" } },
  ],
};
const catalog = {
  info: [
    {
      type: "datetime",
      name: "Clock",
      fields: [{ key: "locale", label: "Locale", type: "string" }],
    },
  ],
  service: [],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function sameTypeChange() {
  const initial = structuredClone(initialState);
  initial.board.panels.forEach((panel, index) => {
    panel.nativeLocator = { type: "datetime", index };
  });
  initial.infoWidgets[1] = {
    id: "search",
    type: "datetime",
    config: { locale: "en-GB" },
  };
  const native = {
    configurationRevision: CONFIG_A,
    widgets: [
      { type: "datetime", options: { index: 0, fixtureValue: "FIRST widget" } },
      {
        type: "datetime",
        options: { index: 1, fixtureValue: "SECOND widget" },
      },
    ],
  };
  const updated = {
    ...initial,
    revision: "deleted-first",
    configurationRevision: CONFIG_B,
    board: {
      ...initial.board,
      panels: [
        {
          ...initial.board.panels[1],
          nativeLocator: { type: "datetime", index: 0 },
        },
      ],
    },
    infoWidgets: [initial.infoWidgets[1]],
  };
  const newNative = {
    configurationRevision: CONFIG_B,
    widgets: [
      {
        type: "datetime",
        options: { index: 0, fixtureValue: "SECOND widget" },
      },
    ],
  };
  return { initial, native, updated, newNative };
}

async function mountBoard({
  write,
  refresh = vi.fn().mockResolvedValue(undefined),
  initial = initialState,
  native = { configurationRevision: CONFIG_A },
  interactions = vi.fn(),
  backups = [],
  firstBoardRead,
  dashboards,
  onNavigateDashboard,
} = {}) {
  let state = structuredClone(initial);
  let publishNative;
  let pollBoard;
  const writer =
    write ||
    vi.fn(async (_, body) => ({
      ...state,
      revision: "after",
      ...(body.board ? { board: body.board } : {}),
    }));
  const fetch = vi.fn(async (path, options) => {
    let value;
    if (options?.method === "POST") {
      value = await writer(path, JSON.parse(options.body));
      if (path !== "/__studio/api/dashboards") state = value;
    } else if (path === "/__studio/catalog.json") value = catalog;
    else if (path === "/__studio/api/backups") value = backups;
    else if (path === "/__studio/api/dashboards") value = dashboards;
    else {
      if (firstBoardRead && path === "/__studio/api/board") await firstBoardRead;
      value = state;
    }
    return { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetch);
  function NativeDataHarness() {
    const [data, setData] = useState(native);
    const { mutate } = useSWRConfig();
    publishNative = setData;
    pollBoard = () => mutate("/__studio/api/board");
    return (
      <StudioBoard
        nativeData={data}
        settings={{ title: "My dashboard" }}
        onNativeChange={async () => {
          const updated = await refresh();
          if (updated) setData(updated);
          return updated || data;
        }}
        onSearch={vi.fn()}
        onInteractionBlocked={interactions}
        onNavigateDashboard={onNavigateDashboard}
      />
    );
  }
  const view = render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      <NativeDataHarness />
    </SWRConfig>,
  );
  if (!firstBoardRead)
    await waitFor(() => expect(screen.getByText("Edit dashboard", { selector: "button" })).toBeEnabled());
  return {
    ...view,
    writer,
    fetch,
    refresh,
    interactions,
    publishNative,
    pollBoard,
    setBackend: (next) => {
      state = next;
    },
  };
}

async function openSettings() {
  fireEvent.click(screen.getByLabelText("Dashboard settings"));
  const title = await screen.findByLabelText(/Dashboard title/);
  return title.closest("dialog");
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Native board save and draft safety", () => {
  it("accepts unchanged position settings without creating a draft or leaving the dialog open", async () => {
    await mountBoard();
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard", exact: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Clock", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Position & size", exact: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply to arrangement", exact: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved arrangement", { exact: true })).not.toBeInTheDocument();
  });
  it("moves a projected mobile row upward from the keyboard while retaining the native input", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(354);
    try {
      await mountBoard();
      const input = screen.getByLabelText("Native state search");
      expect(input.closest("section").style.top).toBe("264px");
      fireEvent.click(screen.getByRole("button", { name: "Edit dashboard", exact: true }));
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Move Search. Use arrow keys; Shift and arrow keys resize." }),
        { key: "ArrowUp" },
      );
      expect(input.closest("section").style.top).toBe("0px");
      expect(screen.getByLabelText("Native state search")).toBe(input);
      expect(screen.getByText("Unsaved arrangement", { exact: true })).toBeInTheDocument();
    } finally {
      width.mockRestore();
    }
  });
  it.each(["pointercancel", "blur", "pointerdown"])(
    "reverts an immediate %s even before the moved draft has committed",
    async (eventType) => {
      await mountBoard();
      fireEvent.click(screen.getByRole("button", { name: "Edit dashboard", exact: true }));
      const handle = screen.getByRole("button", { name: "Move Clock. Use arrow keys; Shift and arrow keys resize." });
      const pointerEvent = (type, y) =>
        Object.assign(new Event(type, { bubbles: true }), {
          pointerId: 1,
          button: 0,
          isPrimary: true,
          clientX: 100,
          clientY: y,
        });
      fireEvent(handle, pointerEvent("pointerdown", 100));
      act(() => {
        window.dispatchEvent(pointerEvent("pointermove", 364));
        window.dispatchEvent(
          Object.assign(pointerEvent(eventType, 364), { pointerId: eventType === "pointerdown" ? 2 : 1 }),
        );
      });
      expect(screen.queryByText("Unsaved arrangement", { exact: true })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Native state clock").closest("section").style.top).toBe("0px");
    },
  );
  it("protects departure during snapshot restoration even though no editor draft is dirty", async () => {
    const gate = deferred();
    const writer = vi.fn(() => gate.promise);
    await mountBoard({
      write: writer,
      backups: [{ id: "snapshot-one", createdAt: "2026-10-22T12:00:00Z", changedFiles: ["settings.yaml"] }],
    });
    const settings = await openSettings();
    fireEvent.click(within(settings).getByRole("button", { name: /Snapshots & restore/ }));
    const snapshot = await screen.findByRole("button", { name: /settings.yaml/ });
    fireEvent.click(snapshot);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Restore selected snapshot", exact: true }));
    await waitFor(() => expect(writer).toHaveBeenCalledTimes(1));
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await act(async () => gate.resolve({ ...initialState, revision: "restored" }));
  });

  it("clears a saved dashboard draft synchronously before navigating its current address", async () => {
    const dashboard = { id: "default", name: "Main", slug: "", archived: false };
    const registry = { version: 1, revision: "registry-before", dashboards: [dashboard] };
    const savedDashboard = { ...dashboard, slug: "admin" };
    const onNavigateDashboard = vi.fn(() => {
      const leaving = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leaving);
      expect(leaving.defaultPrevented, "A committed registry change must not prompt as an unsaved draft").toBe(false);
    });
    await mountBoard({
      dashboards: registry,
      onNavigateDashboard,
      write: vi.fn(async () => ({
        registry: { ...registry, revision: "registry-after", dashboards: [savedDashboard] },
        dashboard: savedDashboard,
      })),
    });
    const settings = await openSettings();
    fireEvent.click(within(settings).getByRole("button", { name: /Manage dashboards/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Main", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Address slug", exact: true }), {
      target: { value: "admin" },
    });
    const drafting = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(drafting);
    expect(drafting.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard", exact: true }));
    await waitFor(() => expect(onNavigateDashboard).toHaveBeenCalledWith("/admin"));
  });

  it("keeps startup controls unavailable until the first board response, then opens settings on the first enabled click", async () => {
    const gate = deferred();
    const { fetch, writer, interactions } = await mountBoard({
      firstBoardRead: gate.promise,
    });
    const settings = screen.getByLabelText("Dashboard settings");
    expect(settings).toBeDisabled();
    expect(screen.getByLabelText("Quick Launch")).toBeDisabled();
    expect(screen.getByText("Edit dashboard", { selector: "button" })).toBeDisabled();
    expect(screen.getByText("Add widget", { selector: "button" })).toBeDisabled();
    expect(interactions).toHaveBeenLastCalledWith(true);
    fireEvent.click(settings);
    expect(fetch.mock.calls.some(([path]) => path === "/__studio/api/state")).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => gate.resolve());
    await waitFor(() => expect(settings).toBeEnabled());
    expect(interactions).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText("Native state clock")).toBeVisible();
    fireEvent.click(settings);
    expect(await screen.findByLabelText(/Dashboard title/)).toHaveValue("My dashboard");
    expect(fetch.mock.calls.filter(([path]) => path === "/__studio/api/state")).toHaveLength(1);
    expect(writer).not.toHaveBeenCalled();
  });

  it("freezes arrangement controls throughout the write and retains native input identity", async () => {
    const gate = deferred();
    const write = vi.fn(() => gate.promise);
    await mountBoard({ write });
    const native = screen.getByLabelText("Native state clock");
    fireEvent.change(native, { target: { value: "working state" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    const handle = screen.getByRole("button", { name: /^Move Clock\./ });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Clock" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const submitted = write.mock.calls[0][1].board;
    const position = native.closest("section").style.cssText;
    expect(handle).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Create stack/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Position & size" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Clock" })).toBeDisabled();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: /^Create stack/ }));
    expect(native.closest("section").style.cssText).toBe(position);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => gate.resolve({ ...initialState, board: submitted, revision: "after" }));
    await waitFor(() => expect(screen.getByText("Arrangement saved")).toBeInTheDocument());
    expect(screen.queryByText("Unsaved arrangement")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Native state clock")).toBe(native);
    expect(native).toHaveValue("working state");
    expect(handle).toBeEnabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("retains an arrangement draft and re-enables controls when the write fails", async () => {
    const gate = deferred();
    await mountBoard({ write: vi.fn(() => gate.promise) });
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    const handle = screen.getByRole("button", { name: /^Move Clock\./ });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    const position = screen.getByLabelText("Native state clock").closest("section").style.cssText;
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await act(async () => gate.reject(new Error("Fixture writer unavailable")));
    expect(await screen.findByText("Fixture writer unavailable")).toBeInTheDocument();
    expect(screen.getByText("Unsaved arrangement")).toBeInTheDocument();
    expect(handle).toBeEnabled();
    expect(screen.getByLabelText("Native state clock").closest("section").style.cssText).toBe(position);
  });

  // This complete modal workflow has a local jsdom CPU budget; application
  // timing and the suite's default timeout are unchanged. See VERIFICATION.md.
  it("protects a dirty editor on close, Escape, file switching and page departure without discarding invalid YAML", async () => {
    await mountBoard();
    const dialog = await openSettings();
    const editor = within(dialog);
    const title = editor.getByRole("textbox", { name: "Dashboard title" });
    const close = editor.getByRole("button", { name: "Close dialog" });
    fireEvent.change(title, { target: { value: "Still drafting" } });
    title.focus();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(editor.getByRole("button", { name: /Configuration files/ }));
    expect(editor.getByText("Discard unsaved changes?")).toBeInTheDocument();
    const keepEditing = editor.getByRole("button", { name: "Keep editing" });
    expect(keepEditing).toHaveFocus();
    fireEvent.click(keepEditing);
    expect(title).toHaveValue("Still drafting");
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: "My dashboard" } });
    const save = editor.getByRole("button", { name: "Save settings" });
    fireEvent.click(editor.getByRole("button", { name: "Advanced YAML" }));
    const yaml = editor.getByLabelText("Item configuration YAML");
    fireEvent.change(yaml, { target: { value: "title: [unfinished" } });
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(editor.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(yaml).toHaveValue("title: [unfinished");
    // Cyclic YAML cannot cross the JSON save protocol. Keep it as an invalid
    // local draft, with dismissal still guarded and the original text intact.
    fireEvent.change(yaml, {
      target: { value: "title: My dashboard\nx-extra: &loop\n  self: *loop\n" },
    });
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.click(close);
    fireEvent.click(editor.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const afterDiscard = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterDiscard);
    expect(afterDiscard.defaultPrevented).toBe(false);
  }, 15000);

  it("keeps a pending native write modal and fields locked, then reports a committed save separately from a refresh outage", async () => {
    const gate = deferred();
    const write = vi.fn(() => gate.promise);
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("Fixture native refresh unavailable"))
      .mockResolvedValue({ configurationRevision: CONFIG_B });
    await mountBoard({ write, refresh });
    const dialog = await openSettings();
    const title = screen.getByRole("textbox", { name: "Dashboard title" });
    fireEvent.change(title, { target: { value: "Committed title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(title).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Configuration files/ })).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toBeInTheDocument();
    await act(async () =>
      gate.resolve({
        ...initialState,
        revision: "committed",
        configurationRevision: CONFIG_B,
        settingsConfig: { title: "Committed title" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    expect(screen.queryByText("This change could not be saved")).not.toBeInTheDocument();
    expect(await screen.findByText(/Your changes were saved, but widget data could not refresh/)).toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh widgets" }));
    await waitFor(() =>
      expect(screen.queryByText(/Your changes were saved, but widget data could not refresh/)).not.toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Move Clock\./ }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1].revision).toBe("committed");
  });

  it("guards native widget and position drafts, while Apply explicitly transfers a draft to the arrangement", async () => {
    await mountBoard();
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Clock" }));
    const locale = await screen.findByRole("textbox", { name: "Locale" });
    fireEvent.change(locale, { target: { value: "en-GB" } });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(locale).toHaveValue("en-GB");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Clock" }));
    fireEvent.click(screen.getByRole("button", { name: "Position & size" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Row" }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to arrangement" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved arrangement")).toBeInTheDocument();
  });

  it("reloads a conflicting snapshot from the mounted board without repeating the restore", async () => {
    const conflict = Object.assign(new Error("Fixture revision changed"), {
      status: 409,
    });
    const write = vi.fn().mockRejectedValue(conflict);
    const { setBackend, pollBoard } = await mountBoard({
      write,
      backups: [
        {
          id: "fixture-snapshot",
          createdAt: "2026-10-21T12:00:00Z",
          changedFiles: ["services.yaml"],
        },
      ],
    });
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: /Snapshots & restore/ }));
    fireEvent.click(await screen.findByRole("button", { name: /services\.yaml/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore selected snapshot" }));
    await screen.findByText("Another change was saved");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1].revision).toBe("before");
    setBackend({
      ...initialState,
      revision: "external-change",
      configurationRevision: CONFIG_B,
    });
    await act(async () => pollBoard());
    // The retry is mounted through StudioBoard; direct SnapshotEditor tests
    // cannot prove that this callback exists or bypasses the stale-data lock.
    fireEvent.click(screen.getByRole("button", { name: "Reload current configuration" }));
    const snapshot = await screen.findByRole("button", {
      name: /services\.yaml/,
    });
    expect(screen.queryByText("Another change was saved")).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "Restore selected snapshot" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1].revision).toBe("external-change");
  });

  it.each(["failed response", "mismatched revision"])(
    "never pairs reindexed same-type widgets with old native data after a committed delete (%s)",
    async (failure) => {
      const { initial, native, updated: committed, newNative } = sameTypeChange();
      const write = vi.fn().mockResolvedValue(committed);
      const refresh = vi.fn();
      if (failure === "failed response") refresh.mockRejectedValueOnce(new Error("Fixture native refresh unavailable"));
      else refresh.mockResolvedValueOnce(native);
      refresh.mockResolvedValue(newNative);
      await mountBoard({ initial, native, write, refresh });
      const survivor = screen.getByTestId("native-value-search");
      const survivorInput = screen.getByLabelText("Native state search");
      fireEvent.change(survivorInput, {
        target: { value: "retained through refresh" },
      });
      expect(survivor).toHaveTextContent("SECOND widget");
      fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Clock" }));
      fireEvent.click(await screen.findByRole("button", { name: "Delete", exact: true }));
      fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
      await screen.findByText(/Your changes were saved, but widget data could not refresh/);
      expect(survivor).toHaveTextContent("SECOND widget");
      expect(survivor.closest(".studio-native-content")).toHaveAttribute("inert");
      expect(survivor.closest(".studio-native-content")).toHaveAttribute("aria-hidden", "true");
      expect(survivor).not.toBeVisible();
      expect(screen.getByRole("button", { name: "Edit Search" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Dashboard settings" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Quick Launch" })).toBeDisabled();
      expect(write).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Refresh widgets" }));
      await waitFor(() => expect(survivor).toBeVisible());
      expect(survivor).toHaveTextContent("SECOND widget");
      expect(screen.queryByTestId("native-value-clock")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Native state search")).toBe(survivorInput);
      expect(survivorInput).toHaveValue("retained through refresh");
      expect(screen.getByRole("button", { name: "Edit Search" })).toBeEnabled();
      expect(write).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["board first", "native data first"])(
    "only renders matching snapshots when independent polls arrive %s",
    async (order) => {
      const fixture = sameTypeChange();
      const { publishNative, pollBoard, setBackend, writer, interactions } = await mountBoard(fixture);
      const survivor = screen.getByTestId("native-value-search");
      const survivorInput = screen.getByLabelText("Native state search");
      fireEvent.change(survivorInput, {
        target: { value: "independent poll state" },
      });
      expect(interactions).toHaveBeenLastCalledWith(false);
      setBackend(fixture.updated);
      if (order === "board first") await act(async () => pollBoard());
      else act(() => publishNative(fixture.newNative));
      expect(survivor).toHaveTextContent("SECOND widget");
      expect(survivor).not.toBeVisible();
      expect(survivor.closest(".studio-native-content")).toHaveAttribute("inert");
      expect(screen.getByRole("button", { name: "Edit dashboard" })).toBeDisabled();
      expect(interactions).toHaveBeenLastCalledWith(true);
      if (order === "board first") act(() => publishNative(fixture.newNative));
      else await act(async () => pollBoard());
      expect(survivor).toBeVisible();
      expect(survivor).toHaveTextContent("SECOND widget");
      expect(screen.getByLabelText("Native state search")).toBe(survivorInput);
      expect(survivorInput).toHaveValue("independent poll state");
      expect(screen.queryByTestId("native-value-clock")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit dashboard" })).toBeEnabled();
      expect(interactions).toHaveBeenLastCalledWith(false);
      expect(writer).not.toHaveBeenCalled();
    },
  );

  it("pins an arrangement draft to its original native revision when both poll results advance", async () => {
    const fixture = sameTypeChange();
    const refresh = vi.fn().mockResolvedValue(fixture.newNative);
    const { publishNative, pollBoard, setBackend, writer } = await mountBoard({
      ...fixture,
      refresh,
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Move Search\./ }), {
      key: "ArrowDown",
    });
    const survivor = screen.getByTestId("native-value-search");
    const position = survivor.closest("section").style.cssText;
    setBackend(fixture.updated);
    await act(async () => pollBoard());
    act(() => publishNative(fixture.newNative));
    expect(screen.getByText("Another change was saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save arrangement" })).toBeDisabled();
    expect(survivor.closest("section").style.cssText).toBe(position);
    expect(survivor).toHaveTextContent("SECOND widget");
    expect(survivor).not.toBeVisible();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(writer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload current configuration" }));
    await waitFor(() => expect(survivor).toBeVisible());
    expect(screen.queryByText("Another change was saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved arrangement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("native-value-clock")).not.toBeInTheDocument();
    expect(survivor).toHaveTextContent("SECOND widget");
    expect(writer).not.toHaveBeenCalled();
  });

  it("preserves a position dialog draft's original revision when it is applied after an external native change", async () => {
    const { publishNative, pollBoard, setBackend, writer } = await mountBoard();
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Clock" }));
    fireEvent.click(screen.getByRole("button", { name: "Position & size" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Row" }), {
      target: { value: "5" },
    });
    setBackend({
      ...initialState,
      revision: "external-native-change",
      configurationRevision: CONFIG_B,
    });
    await act(async () => pollBoard());
    expect(screen.getByRole("button", { name: "Apply to arrangement" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Row" })).toHaveValue(5);
    act(() => publishNative({ configurationRevision: CONFIG_B }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to arrangement" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Another change was saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save arrangement" })).toBeDisabled();
    expect(screen.getByLabelText("Native state clock").closest("section")).toHaveStyle({ top: "440px" });
    expect(writer).not.toHaveBeenCalled();
  });

  it("keeps native content live after a layout-only poll but saves the draft against its original writer revision", async () => {
    const conflict = Object.assign(new Error("Fixture layout changed"), {
      status: 409,
    });
    const write = vi.fn().mockRejectedValue(conflict);
    const { setBackend, pollBoard } = await mountBoard({ write });
    fireEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Move Clock\./ }), {
      key: "ArrowDown",
    });
    const native = screen.getByLabelText("Native state clock");
    const position = native.closest("section").style.cssText;
    setBackend({ ...initialState, revision: "external-layout-change" });
    await act(async () => pollBoard());
    expect(native).toBeVisible();
    expect(native.closest(".studio-native-content")).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await screen.findByText("Another change was saved");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1].revision).toBe("before");
    expect(native.closest("section").style.cssText).toBe(position);
    expect(screen.getByText("Unsaved arrangement")).toBeInTheDocument();
  });

  it.each([null, undefined])(
    "treats missing native fingerprints (%s) as unpaired instead of matching absent values",
    async (configurationRevision) => {
      const { publishNative, pollBoard, setBackend, writer } = await mountBoard();
      setBackend({ ...initialState, configurationRevision });
      await act(async () => pollBoard());
      act(() => publishNative({ configurationRevision }));
      expect(screen.getByRole("button", { name: "Edit dashboard" })).toBeDisabled();
      expect(screen.getByLabelText("Native state clock").closest(".studio-native-content")).toHaveAttribute("inert");
      expect(screen.getByText("Waiting for matching widget data.")).toBeInTheDocument();
      expect(writer).not.toHaveBeenCalled();
    },
  );

  it("keeps Quick Launch named when responsive styles hide its text", async () => {
    await mountBoard();
    const search = screen.getByRole("button", { name: "Quick Launch" });
    search.querySelector("span").style.display = "none";
    search.querySelector("kbd").style.display = "none";
    expect(search).toHaveAccessibleName("Quick Launch");
  });
});
