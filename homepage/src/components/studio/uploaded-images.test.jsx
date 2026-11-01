// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadedImages } from "./uploaded-images";

const ours = { id: "a".repeat(24), kind: "logo", name: "ours.svg", type: "image/svg+xml", size: 10 };
const mine = { id: "b".repeat(24), kind: "logo", name: "mine.svg", type: "image/svg+xml", size: 10 };

function mount({ authEnabled = true } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      const body = options?.body ? JSON.parse(options.body) : undefined;
      calls.push({ path: String(path), body });
      let value;
      if (String(path).endsWith("/studio/api/access"))
        value = authEnabled
          ? { authEnabled: true, level: "arrange", user: { username: "sam" } }
          : { authEnabled: false };
      else if (String(path).endsWith("/studio/api/my-images/use")) value = { image: { ...mine } };
      else if (String(path).endsWith("/studio/api/my-images") && body)
        value = { image: { ...mine, id: "c".repeat(24) } };
      else if (String(path).endsWith("/studio/api/my-images")) value = { images: [mine] };
      else if (String(path).endsWith("/studio/api/images") && body) value = { image: { ...ours, id: "d".repeat(24) } };
      else value = { images: [ours] };
      return { ok: true, status: 200, json: async () => value };
    }),
  );
  const onPick = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <UploadedImages kind="logo" value={null} onPick={onPick} />
    </SWRConfig>,
  );
  return { calls, onPick };
}
afterEach(() => vi.unstubAllGlobals());

const svgFile = () => new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "new.svg", { type: "image/svg+xml" });

describe("uploads in two places", () => {
  it("shows this dashboard's and your own, and copies yours in when used", async () => {
    const { calls, onPick } = mount();
    const yours = await screen.findByRole("radiogroup", { name: "Your logos" });
    expect(screen.getByRole("radiogroup", { name: "Uploaded logos" })).toBeTruthy();
    fireEvent.click(within(yours).getByRole("radio", { name: "mine.svg" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(mine.id));
    expect(calls.find((call) => call.path.endsWith("/my-images/use")).body).toEqual({ id: mine.id });
  });

  it("asks who can reuse a new upload and saves it to your account", async () => {
    const { calls, onPick } = mount();
    await screen.findByRole("radiogroup", { name: "Your logos" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [svgFile()] } });
    const place = await screen.findByRole("group", { name: "Who can reuse it?" });
    fireEvent.click(within(place).getByRole("radio", { name: "Just me" }));
    expect(screen.getByText(/Only you see it in the library/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and use" }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const saved = calls.find((call) => call.path.endsWith("/studio/api/my-images") && call.body);
    expect(saved.body).toMatchObject({ kind: "logo", name: "new.svg" });
    expect(calls.some((call) => call.path.endsWith("/my-images/use"))).toBe(true);
  });

  it("without sign-in there is one place, so an upload is saved straight away", async () => {
    const { calls, onPick } = mount({ authEnabled: false });
    await screen.findByRole("radiogroup", { name: "Uploaded logos" });
    expect(screen.queryByRole("region", { name: "Just me" })).toBeNull();
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [svgFile()] } });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("d".repeat(24)));
    expect(screen.queryByRole("group", { name: "Who can reuse it?" })).toBeNull();
    expect(calls.some((call) => call.path.includes("my-images"))).toBe(false);
  });
});
