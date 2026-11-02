// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LogoEditor from "./logo-editor";

// The browser's canvas isn't in jsdom; the shrinking itself is the image
// library's, so here it stands in with a fixed result.
vi.mock("./image-upload.mjs", async (original) => ({
  ...(await original()),
  prepareImage: vi.fn(async (file) => ({
    image: "data:image/webp;base64,AAAA",
    before: file.size,
    after: 150 * 1024,
    width: 512,
    height: 512,
  })),
}));

afterEach(() => vi.unstubAllGlobals());

const reply = (status, value) => ({
  ok: status < 400,
  status,
  json: async () => value,
  text: async () => JSON.stringify(value),
});

describe("dashboard logo", () => {
  it("shows the Studio logo until one is uploaded, and saves an upload at once", async () => {
    const fetch = vi.fn(async () => reply(200, { logo: { type: "image/png", version: "abc" } }));
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn(async () => {});
    const { container } = render(<LogoEditor logo={null} onChange={onChange} />);
    expect(container.querySelector("img").getAttribute("src")).toBe("/studio/brand/logo.svg");
    expect(screen.queryByRole("button", { name: "Use the Studio logo" })).not.toBeInTheDocument();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Logo saved."));
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe("/studio/api/logo");
    expect(JSON.parse(options.body).image).toMatch(/^data:image\/png;base64,/);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shrinks a big picture instead of refusing it, and says what it did", async () => {
    const fetch = vi.fn(async () => reply(200, { logo: { type: "image/webp", version: "def" } }));
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn(async () => {});
    const { container } = render(<LogoEditor logo={null} onChange={onChange} />);
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [big] } });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Logo saved. Shrunk from 3.0 MB to 150 KB (512 × 512)."),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ image: "data:image/webp;base64,AAAA" });
  });

  it("refuses an SVG over 256 KiB without sending it, and resets to the Studio logo", async () => {
    const fetch = vi.fn(async () => reply(200, { logo: null }));
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn(async () => {});
    const { container } = render(<LogoEditor logo={{ type: "image/png", version: "abc" }} onChange={onChange} />);
    expect(container.querySelector("img").getAttribute("src")).toBe("/studio/logo?v=abc");
    const big = new File([new Uint8Array(256 * 1024 + 1)], "big.svg", { type: "image/svg+xml" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [big] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("SVG logos are limited to 256 KiB.");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use the Studio logo" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Back to the Studio logo."));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ reset: true });
  });
});
