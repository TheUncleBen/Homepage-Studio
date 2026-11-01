// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeIcon, IconChooser, IconField, searchIcons } from "./icon-chooser";
import { builtInIcon, builtInIconUrl, builtInIconValue } from "./icon-source.mjs";

vi.mock("components/resolvedicon", () => ({ default: ({ icon }) => <i data-icon={icon} /> }));

const INDEX = [
  ["gitea", "gitea git"],
  ["github", "github git code"],
  ["grafana", "grafana monitoring"],
  ["jellyfin", "jellyfin media"],
  ["dagster", "dagster data"],
];
const image = { id: "c".repeat(24), kind: "logo", name: "mark.svg", type: "image/svg+xml", size: 10 };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const value = String(path).endsWith("/studio-icons/index.json") ? { icons: INDEX } : { images: [image] };
      return { ok: true, status: 200, json: async () => value };
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("icon values", () => {
  it("reads built-in names and leaves other icon sets and addresses alone", () => {
    expect(builtInIcon("gitea.webp")).toEqual({ name: "gitea", format: "webp" });
    expect(builtInIcon("gitea")).toEqual({ name: "gitea", format: "png" });
    for (const other of ["mdi-server", "si-github", "sh-plex", "https://example.org/a.png", "/studio/api/images/x"])
      expect(builtInIcon(other)).toBeNull();
    expect(builtInIconValue("gitea")).toBe("gitea.webp");
  });

  it("uses a logo's light version on dark themes where one exists", () => {
    expect(builtInIconUrl("dagster", { dark: true })).toMatch(/\/webp\/dagster-light\.webp$/);
    expect(builtInIconUrl("dagster")).toMatch(/\/webp\/dagster\.webp$/);
    expect(builtInIconUrl("gitea", { dark: true })).toMatch(/\/webp\/gitea\.webp$/);
  });

  it("ranks exact and leading matches first and searches aliases", () => {
    expect(searchIcons(INDEX, "git").map(([name]) => name)).toEqual(["gitea", "github"]);
    expect(searchIcons(INDEX, "media").map(([name]) => name)).toEqual(["jellyfin"]);
    expect(searchIcons(INDEX, "github")[0][0]).toBe("github");
  });

  it("describes what an icon is in words", () => {
    expect(describeIcon("home-assistant.webp")).toBe("home assistant");
    expect(describeIcon("/studio/api/images/" + "a".repeat(24))).toBe("Uploaded logo");
    expect(describeIcon("mdi-server")).toBe("mdi-server");
  });
});

describe("icon chooser", () => {
  it("picks a built-in logo found by search", async () => {
    stubFetch();
    const onPick = vi.fn();
    render(<IconChooser value="" onPick={onPick} />);
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search logos" }), { target: { value: "graf" } });
    const grid = await screen.findByRole("radiogroup", { name: "Built-in logos" });
    expect(within(grid).getAllByRole("radio")).toHaveLength(1);
    fireEvent.click(within(grid).getByRole("radio", { name: "grafana" }));
    expect(onPick).toHaveBeenCalledWith("grafana.webp");
  });

  it("opens on the uploaded tab for an uploaded logo and stores its address", async () => {
    stubFetch();
    const onPick = vi.fn();
    render(<IconChooser value={`/studio/api/images/${image.id}`} onPick={onPick} />);
    const option = await screen.findByRole("radio", { name: "mark.svg" });
    expect(option).toHaveAttribute("aria-checked", "true");
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledWith(`/studio/api/images/${image.id}`);
  });

  it("takes another icon set's name under Other", () => {
    const onPick = vi.fn();
    render(<IconChooser value="mdi-server" onPick={onPick} />);
    const input = screen.getByLabelText("Icon name or address");
    expect(input).toHaveValue("mdi-server");
    fireEvent.change(input, { target: { value: "si-github" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenCalledWith("si-github");
  });
});

describe("icon field", () => {
  it("shows the icon, opens the chooser in place and removes the icon", async () => {
    stubFetch();
    const onChange = vi.fn();
    render(<IconField id="f" label="Icon" value="gitea.webp" onChange={onChange} />);
    expect(screen.getByText("gitea")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByRole("radio", { name: "jellyfin" }));
    expect(onChange).toHaveBeenCalledWith("jellyfin.webp");
    fireEvent.click(screen.getByRole("button", { name: "Remove Icon" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
