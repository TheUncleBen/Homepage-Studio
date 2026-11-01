// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { withoutPhoneHidden } from "./board";
import LookEditor, { arrangeValues, storedValues } from "./look-editor";
import { BUILT_IN_BEHAVIOUR, BUILT_IN_LOOK } from "./look.mjs";

vi.mock("./native-panel", () => ({ default: () => null }));
vi.mock("components/resolvedicon", () => ({ default: () => null }));

const fields = [
  { field: "users", label: "Users" },
  { field: "failed", label: "Failed" },
  { field: "logins", label: "Logins" },
];

function renderEditor(props = {}) {
  const onLook = vi.fn();
  const onBehaviour = vi.fn();
  const onPage = vi.fn();
  render(
    <LookEditor
      kind="serviceWidget"
      inheritedLook={BUILT_IN_LOOK}
      inheritedBehaviour={BUILT_IN_BEHAVIOUR}
      fields={fields}
      pages={[{ id: "home", name: "Home" }]}
      pageId="home"
      onLook={onLook}
      onBehaviour={onBehaviour}
      onPage={onPage}
      {...props}
    />,
  );
  return { onLook, onBehaviour, onPage };
}

const radio = (group, name) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

describe("widget dialog look (Rule 1: only what can apply)", () => {
  it("shows integration sections and hides colour rows until a fill needs them", () => {
    renderEditor();
    for (const name of ["Look", "Status", "Show", "Behaviour"])
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Strength" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Colour" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Refresh" })).toBeTruthy();
    // One page: no page picker.
    expect(screen.queryByLabelText("Page")).toBeNull();
  });

  it("shows colour and strength under Tint", () => {
    renderEditor({ look: { fill: "tint" } });
    expect(screen.getByRole("radiogroup", { name: "Strength" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Colour" })).toBeTruthy();
  });

  it("shows the chosen picture and its adjustments under Picture", () => {
    renderEditor({ look: { fill: "picture", background: { source: "builtin", id: "coast" } } });
    expect(screen.getByRole("radio", { name: "Coast" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radiogroup", { name: "Strength" })).toBeNull();
  });

  it("leaves out status, values, refresh and errors on a bookmark", () => {
    renderEditor({ kind: "bookmark", fields: [] });
    expect(screen.queryByRole("heading", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Layout" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "On click" })).toBeTruthy();
  });

  it("leaves out the logo header and link choices on an information widget", () => {
    renderEditor({ kind: "informationWidget", fields: [] });
    expect(screen.queryByRole("radiogroup", { name: "Header" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "On click" })).toBeNull();
  });

  it("hides Show as while status checks are off", () => {
    renderEditor({ behaviour: { status: "off" } });
    expect(screen.queryByRole("radiogroup", { name: "Show as" })).toBeNull();
  });

  it("offers a page picker with two or more pages", () => {
    const { onPage } = renderEditor({
      pages: [
        { id: "home", name: "Home" },
        { id: "media", name: "Media" },
      ],
    });
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "media" } });
    expect(onPage).toHaveBeenCalledWith("media");
  });
});

describe("widget dialog look (Rule 2: store only what differs)", () => {
  it("stores a choice that differs and removes it when the default is picked again", () => {
    const first = renderEditor();
    fireEvent.click(radio("Edge", "Shadow"));
    expect(first.onLook).toHaveBeenLastCalledWith({ edge: "shadow" });
  });

  it("removes the key when the dashboard's value is chosen", () => {
    const { onLook, onBehaviour } = renderEditor({ look: { edge: "shadow" }, behaviour: { target: "same" } });
    fireEvent.click(radio("Edge", "Line"));
    expect(onLook).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(radio("On click", "New tab"));
    expect(onBehaviour).toHaveBeenLastCalledWith(undefined);
  });
});

describe("arranging values", () => {
  it("keeps the widget's order and stores nothing until something changes", () => {
    const rows = arrangeValues(fields, []);
    expect(rows.map((row) => row.field)).toEqual(["users", "failed", "logins"]);
    expect(storedValues(rows, fields)).toBeUndefined();
  });

  it("stores the order and only the settings that differ", () => {
    const rows = arrangeValues(fields, [{ field: "failed", slot: "hero", label: "Failed sign-ins" }]);
    expect(rows.map((row) => row.field)).toEqual(["failed", "users", "logins"]);
    expect(rows[0]).toMatchObject({ slot: "hero", name: "Failed sign-ins", label: "Failed" });
    expect(storedValues(rows, fields)).toEqual([
      { field: "failed", slot: "hero", label: "Failed sign-ins" },
      { field: "users" },
      { field: "logins" },
    ]);
  });

  it("forgets values the widget no longer shows", () => {
    expect(arrangeValues(fields, [{ field: "gone", slot: "hidden" }]).map((row) => row.field)).toEqual([
      "users",
      "failed",
      "logins",
    ]);
  });

  it("moves the hero when another value becomes the hero", () => {
    const { onLook } = renderEditor({ look: { values: [{ field: "users", slot: "hero" }] } });
    fireEvent.change(screen.getByLabelText("Where Logins shows"), { target: { value: "hero" } });
    expect(onLook).toHaveBeenLastCalledWith({
      values: [{ field: "users" }, { field: "failed" }, { field: "logins", slot: "hero" }],
    });
  });
});

describe("hide on phones", () => {
  const board = {
    version: 3,
    columns: 24,
    panels: [
      { id: "a", rect: { x: 0, y: 0, w: 6, h: 2 }, behaviour: { phones: "hide" } },
      { id: "b", rect: { x: 6, y: 0, w: 6, h: 2 } },
      { id: "c", rect: { x: 0, y: 2, w: 6, h: 2 } },
    ],
    stacks: [{ id: "s", panelIds: ["a", "c"], rect: { x: 0, y: 2, w: 6, h: 2 } }],
  };
  it("drops hidden widgets and keeps the rest of a stack", () => {
    const shown = withoutPhoneHidden(board, {});
    expect(shown.panels.map((panel) => panel.id)).toEqual(["b", "c"]);
    expect(shown.stacks[0].panelIds).toEqual(["c"]);
  });
  it("follows the dashboard default", () => {
    const shown = withoutPhoneHidden(board, { studioDefaults: { phones: "hide" } });
    expect(shown.panels).toEqual([]);
    expect(shown.stacks).toEqual([]);
  });
});

describe("uploaded backgrounds", () => {
  const image = { id: "a".repeat(24), kind: "background", name: "beach.webp", type: "image/webp", size: 10 };
  function stub(handlers) {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path, options) => {
        const body = options?.body ? JSON.parse(options.body) : undefined;
        calls.push({ path, body });
        const [status, value] = handlers(path, body);
        return { ok: status < 400, status, json: async () => value };
      }),
    );
    return calls;
  }

  it("stores an uploaded picture as a library background", async () => {
    stub(() => [200, { images: [image, { ...image, id: "b".repeat(24), kind: "logo", name: "logo.png" }] }]);
    const { onLook } = renderEditor({ look: { fill: "picture" } });
    fireEvent.click(radio("Kind of background", "Uploaded"));
    // Logos are kept apart from backgrounds.
    expect(await screen.findByRole("radio", { name: "beach.webp" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "logo.png" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "beach.webp" }));
    expect(onLook).toHaveBeenLastCalledWith({ fill: "picture", background: { source: "library", id: image.id } });
    vi.unstubAllGlobals();
  });

  it("names where a picture is used before removing it", async () => {
    const calls = stub((path, body) =>
      path.endsWith("/images/delete") && !body.confirm
        ? [
            409,
            {
              error: "This image is still in use.",
              code: "IMAGE_IN_USE",
              details: { usedIn: [{ kind: "widget", name: "Pi-hole" }] },
            },
          ]
        : [200, { images: [image] }],
    );
    renderEditor({ look: { fill: "picture", background: { source: "library", id: image.id } } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove beach.webp" }));
    expect(await screen.findByText("Pi-hole")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove anyway" }));
    await waitFor(() => expect(calls.some((call) => call.body?.confirm === true)).toBe(true));
    vi.unstubAllGlobals();
  });
});
