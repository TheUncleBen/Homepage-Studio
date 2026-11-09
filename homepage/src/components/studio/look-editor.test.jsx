// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { withoutHiddenOn } from "./board";
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
  it("lets an integration widget pick its logo and write its description (owner T8/T30, 65f724c)", () => {
    const onIcon = vi.fn();
    const onDescription = vi.fn();
    renderEditor({
      look: { header: "logo-name" },
      identity: { icon: "", description: "", onIcon, onDescription },
    });
    expect(screen.getByText("No logo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    expect(screen.getByRole("radio", { name: "Uploaded" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Description text"), { target: { value: "Edge firewall" } });
    expect(onDescription).toHaveBeenCalledWith("Edge firewall");
  });

  it("hides the logo picker when the header draws no logo", () => {
    renderEditor({
      look: { header: "name" },
      identity: { icon: "", description: "", onIcon: vi.fn(), onDescription: vi.fn() },
    });
    expect(screen.queryByText("No logo")).toBeNull();
  });

  it("shows integration sections and hides colour rows until a fill needs them", () => {
    renderEditor();
    for (const name of ["Header", "Text", "Look", "Status", "Each value", "Behaviour"])
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Strength" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Colour" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Refresh" })).toBeTruthy();
    // One page: no page picker.
    expect(screen.queryByRole("combobox", { name: "Page" })).toBeNull();
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
    expect(screen.queryByRole("heading", { name: "Each value" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Numbers font" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "On click" })).toBeTruthy();
  });

  it("leaves out the logo header and link choices on an information widget", () => {
    renderEditor({ kind: "informationWidget", fields: [] });
    expect(screen.queryByRole("radiogroup", { name: "Header" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "On click" })).toBeNull();
  });

  it("offers a page picker with two or more pages", () => {
    const { onPage } = renderEditor({
      pages: [
        { id: "home", name: "Home" },
        { id: "media", name: "Media" },
      ],
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Page" }));
    fireEvent.click(screen.getByRole("option", { name: "Media" }));
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

describe("each value's own settings", () => {
  it("lists the widget's values in its order and stores nothing until something changes", () => {
    const rows = arrangeValues(fields, []);
    expect(rows.map((row) => row.field)).toEqual(["users", "failed", "logins"]);
    expect(storedValues(rows, [])).toBeUndefined();
  });

  it("stores only the values with a change, each with only what changed", () => {
    const rows = arrangeValues(fields, [{ field: "failed", label: "Failed sign-ins" }]);
    expect(rows[1]).toMatchObject({ name: "Failed sign-ins", label: "Failed" });
    rows[2] = { ...rows[2], format: "short" };
    expect(storedValues(rows, [])).toEqual([
      { field: "failed", label: "Failed sign-ins" },
      { field: "logins", format: "short" },
    ]);
  });

  it("keeps the settings of a value the widget isn't drawing right now", () => {
    const kept = [{ field: "gone", label: "Old" }];
    expect(storedValues(arrangeValues(fields, kept), kept)).toEqual(kept);
  });

  it("renames a value from its row", () => {
    const { onLook } = renderEditor();
    fireEvent.change(screen.getByLabelText("Name shown for Logins"), { target: { value: "Sign-ins" } });
    expect(onLook).toHaveBeenLastCalledWith({ values: [{ field: "logins", label: "Sign-ins" }] });
  });
});

describe("show on each layout", () => {
  const board = {
    version: 3,
    columns: 24,
    panels: [
      { id: "a", rect: { x: 0, y: 0, w: 6, h: 2 }, behaviour: { showOn: "desktop+tablet" } },
      { id: "b", rect: { x: 6, y: 0, w: 6, h: 2 } },
      { id: "c", rect: { x: 0, y: 2, w: 6, h: 2 }, behaviour: { showOn: "tablet" } },
    ],
    stacks: [{ id: "s", panelIds: ["a", "c"], rect: { x: 0, y: 2, w: 6, h: 2 } }],
  };
  it("drops widgets a layout leaves out and keeps the rest of a stack", () => {
    const phone = withoutHiddenOn(board, {}, "phone");
    expect(phone.panels.map((panel) => panel.id)).toEqual(["b"]);
    expect(phone.stacks).toEqual([]);
    const desktop = withoutHiddenOn(board, {}, "desktop");
    expect(desktop.panels.map((panel) => panel.id)).toEqual(["a", "b"]);
    expect(desktop.stacks[0].panelIds).toEqual(["a"]);
    expect(withoutHiddenOn(board, {}, "tablet")).toBe(board);
  });
  it("follows the dashboard default", () => {
    const shown = withoutHiddenOn(board, { studioDefaults: { showOn: "phone" } }, "phone");
    expect(shown.panels.map((panel) => panel.id)).toEqual(["b"]);
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

describe("saved looks", () => {
  it("is always shown where looks can be saved; saving waits for a changed look", () => {
    renderEditor({ look: {}, savedLooks: [], onSavedLooks: vi.fn() });
    expect(screen.getByText("Saved looks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "None picked" }));
    expect(screen.getByText(/No saved looks yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save this look…" })).toBeDisabled();
  });

  it("names this widget's look without its values, and applies a saved look keeping them", () => {
    const onSavedLooks = vi.fn();
    const values = [{ field: "users", hero: true }];
    const { onLook } = renderEditor({
      look: { fill: "solid", corners: "round", values },
      savedLooks: [{ id: "n", name: "Night", look: { edge: "none" } }],
      onSavedLooks,
    });
    const toggle = screen.getByRole("button", { name: "None picked" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save this look…" }));
    const input = screen.getByRole("textbox", { name: "Name for this look" });
    fireEvent.change(input, { target: { value: "night" } });
    expect(screen.getByText("That name is taken.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Bold" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSavedLooks).toHaveBeenCalledWith([
      { id: "n", name: "Night", look: { edge: "none" } },
      expect.objectContaining({ name: "Bold", look: { fill: "solid", corners: "round" } }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(onLook).toHaveBeenCalledWith({ edge: "none", values });
  });

  it("keeps what the widget shows (blocks and size layouts) when a saved look is applied", () => {
    const blocks = [{ id: "p", type: "pie", values: ["users", "failed"] }];
    const sizes = { wide: { arrange: "row" } };
    const { onLook } = renderEditor({
      look: { fill: "solid", blocks, sizes, arrange: "col" },
      savedLooks: [{ id: "n", name: "Night", look: { edge: "none" } }],
      onSavedLooks: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "None picked" }));
    fireEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(onLook).toHaveBeenCalledWith({ edge: "none", blocks, sizes, arrange: "col" });
  });

  it("searches, and manages saved looks in one place: rename, update, delete", async () => {
    const onSavedLooks = vi.fn();
    const change = vi.fn(async () => ({}));
    const onUpdateLookUsers = vi.fn();
    const saved = ["Night", "Day", "Hexagon", "Quiet blue"].map((name, index) => ({
      id: `l${index}`,
      name,
      look: { edge: index % 2 ? "line" : "none" },
    }));
    renderEditor({
      look: { fill: "tint" },
      savedLooks: saved,
      onSavedLooks,
      personalLooks: {
        available: true,
        looks: [{ id: "m1", name: "Mine", scope: "me", look: { corners: "round" } }],
        change,
      },
      lookUsage: () => 2,
      onUpdateLookUsers,
    });
    fireEvent.click(screen.getByRole("button", { name: "None picked" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search saved looks" }), { target: { value: "hex" } });
    expect(
      within(screen.getByRole("list", { name: "Saved looks" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["HexagonThis dashboard"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search saved looks" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Manage saved looks" }));
    const manage = screen.getByRole("list", { name: "Manage saved looks" });
    fireEvent.click(within(manage).getAllByRole("button", { name: "Rename" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "New name for Night" }), { target: { value: "Midnight" } });
    fireEvent.click(within(manage).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSavedLooks).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "l0", name: "Midnight" })]),
      ),
    );
    // Update makes it this widget's look, and asks about the widgets using it.
    fireEvent.click(within(manage).getAllByRole("button", { name: "Update" })[1]);
    await waitFor(() =>
      expect(onSavedLooks).toHaveBeenLastCalledWith(
        expect.arrayContaining([{ id: "l1", name: "Day", look: { fill: "tint" } }]),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 other widgets on this dashboard use “Day”. Update them too?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Update them" }));
    expect(onUpdateLookUsers).toHaveBeenCalledWith({ edge: "line" }, { fill: "tint" });
    // A Just me look is changed on the account at once.
    fireEvent.click(screen.getByRole("button", { name: "Delete saved look Mine" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith({ action: "delete", kind: "look", scope: "me", id: "m1" }));
  });
});

describe("status address", () => {
  it("asks for the address the check uses, and only while a check is on", () => {
    const onChange = vi.fn();
    const address = { web: "", ping: "", href: "https://nas.example.org/ui", onChange };
    renderEditor({ kind: "service", statusAddress: address });
    const input = screen.getByLabelText("Address");
    expect(input.placeholder).toBe("https://nas.example.org/ui");
    fireEvent.change(input, { target: { value: "https://nas.example.org/health" } });
    expect(onChange).toHaveBeenCalledWith("web", "https://nas.example.org/health");
  });

  it("suggests the link's host for Ping", () => {
    const address = { web: "", ping: "", href: "https://nas.example.org/ui", onChange: vi.fn() };
    renderEditor({ kind: "service", statusAddress: address, behaviour: { status: "ping" } });
    expect(screen.getByLabelText("Address").placeholder).toBe("nas.example.org");
  });

  it("shows the Connection address as derived and checks it before saving", async () => {
    const onCheck = vi.fn(async () => ({ ok: true, message: "Up · 42 ms" }));
    const address = {
      web: "",
      ping: "",
      href: "",
      fallback: { address: "https://pf.example.org", from: "Connection" },
      onChange: vi.fn(),
      onCheck,
    };
    renderEditor({ kind: "serviceWidget", statusAddress: address });
    expect(screen.getByLabelText("Address").placeholder).toBe("https://pf.example.org");
    expect(screen.getByText("From the Connection")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(onCheck).toHaveBeenCalledWith("web", "https://pf.example.org");
    expect(await screen.findByText("Up · 42 ms")).toBeTruthy();
  });

  it("never shows a saved connection's placeholder as text", () => {
    const address = {
      web: "",
      ping: "",
      fallback: { address: "{{STUDIO_CONNECTION_0123456789ABCDEF_URL}}", from: "Connection" },
      onChange: vi.fn(),
    };
    renderEditor({ kind: "serviceWidget", statusAddress: address });
    expect(screen.getByLabelText("Address").placeholder).toBe("The saved connection's address");
  });
});

describe("Docker container (option audit against 6a93f66)", () => {
  it("edits an integration widget's Docker server and container, even with no status check", () => {
    const onChange = vi.fn();
    renderEditor({
      kind: "serviceWidget",
      behaviour: { status: "off" },
      docker: { server: "my-docker", container: "", onChange },
    });
    expect(screen.getByLabelText("Docker server").value).toBe("my-docker");
    fireEvent.change(screen.getByLabelText("Docker container"), { target: { value: "jellyfin" } });
    expect(onChange).toHaveBeenCalledWith("container", "jellyfin");
  });
});

describe("exact colour", () => {
  it("offers it only for a custom colour, and hides Strength for an exact solid", () => {
    const { onLook } = renderEditor({ look: { fill: "solid", colour: "#ffff00" } });
    expect(screen.getByRole("radiogroup", { name: "Strength" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Use my exact colour" }));
    expect(onLook).toHaveBeenLastCalledWith({ fill: "solid", colour: "#ffff00", colourFit: "exact" });
  });

  it("warns when text can't reach 4.5:1 on the exact colour", () => {
    renderEditor({ look: { fill: "solid", colour: "#777777", colourFit: "exact" } });
    expect(screen.queryByRole("radiogroup", { name: "Strength" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/reaches only/);
  });

  it("is not offered when the colour comes from the logo", () => {
    renderEditor({ look: { fill: "solid" } });
    expect(screen.queryByRole("switch", { name: "Use my exact colour" })).toBeNull();
  });
});

describe("chart colours and colour rules", () => {
  it("shows each line's colour as drawn and stores only a changed one (Rule 2)", () => {
    const { onLook } = renderEditor({
      chartFields: [
        { field: "users", format: "number" },
        { field: "failed", format: "number" },
      ],
    });
    const colour = screen.getByRole("textbox", { name: "Chart colour for Users" });
    expect(colour.value).toBe("#5aa9e6");
    expect(screen.getByRole("textbox", { name: "Chart colour for Failed" }).value).toBe("#e0a03b");
    // A value Studio can't collect as a number has no chart colour.
    expect(screen.queryByRole("textbox", { name: "Chart colour for Logins" })).toBeNull();
    fireEvent.change(colour, { target: { value: "#112233" } });
    expect(onLook.mock.calls.at(-1)[0].values[0]).toEqual({ field: "users", colour: "#112233" });
    // Picking the colour it already draws in stores nothing.
    fireEvent.change(screen.getByRole("textbox", { name: "Chart colour for Failed" }), {
      target: { value: "#e0a03b" },
    });
    expect(onLook).toHaveBeenCalledTimes(1);
  });

  it("edits a value's colour rules", () => {
    const { onLook } = renderEditor();
    fireEvent.click(screen.getAllByRole("button", { name: "Rules" })[0]);
    fireEvent.change(screen.getByLabelText("Warning from"), { target: { value: "70" } });
    expect(onLook.mock.calls.at(-1)[0].values[0]).toEqual({ field: "users", rules: { warn: 70 } });
  });
});

describe("status check and the blocks that use it", () => {
  it("says which blocks stay empty while the check is off", () => {
    renderEditor({
      kind: "service",
      fields: [],
      look: { blocks: [{ id: "s", type: "status" }] },
      behaviour: { status: "off" },
    });
    expect(screen.getByRole("status").textContent).toMatch(/Status history in Show needs this check/);
  });

  it("asks nothing more of a service tile's check", () => {
    const { onLook, onBehaviour } = renderEditor({
      kind: "service",
      fields: [],
      look: { blocks: [{ id: "s", type: "status" }] },
    });
    fireEvent.click(radio("Check by", "Off"));
    expect(onBehaviour).toHaveBeenLastCalledWith({ status: "off" });
    // The block stays: turning the check back on fills it again.
    expect(onLook).not.toHaveBeenCalled();
  });
});

describe("header, text and sizes", () => {
  it("sets the header, text and alignment for every size", () => {
    const { onLook } = renderEditor();
    fireEvent.click(radio("Header sits", "Beside"));
    expect(onLook).toHaveBeenLastCalledWith({ headerAt: "left" });
    fireEvent.click(radio("Text", "Fixed"));
    expect(onLook).toHaveBeenLastCalledWith({ text: "fixed" });
    fireEvent.click(radio("Smallest text", "Large"));
    expect(onLook).toHaveBeenLastCalledWith({ textSize: "large" });
  });

  it("gives one size its own header and tags it, with a way back to All sizes", () => {
    const onScope = vi.fn();
    const { onLook } = renderEditor({ scope: "wide", onScope, look: { sizes: { wide: { header: "name" } } } });
    expect(screen.getAllByText("this size").length).toBe(1);
    expect(radio("Header", "Name")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio("Header", "Logo and name"));
    // Back to what All sizes has: the size's own setting goes.
    expect(onLook).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Use All sizes here" }));
    expect(onLook).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: /^Small/ }));
    expect(onScope).toHaveBeenCalledWith("small");
  });

  it("says what Auto picked and the text scale now", () => {
    renderEditor({ onScope: vi.fn(), fit: { pick: { inline: true }, scale: 1.25, sizeClass: "wide" } });
    expect(radio("Header sits", /Auto/).textContent).toBe("Auto · beside");
    expect(screen.getByText("Now at 125%.")).toBeTruthy();
  });
});
