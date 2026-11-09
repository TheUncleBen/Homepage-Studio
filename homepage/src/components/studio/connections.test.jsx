// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConfigForm from "./config-form";
import { ConnectionsEditor, connectionPlaceholder, withConnection, withoutConnection } from "./connections";

const ID = "ABCDEF0123456789";
const MINE = "0123456789ABCDEF";
const router = { id: ID, name: "Router", url: "https://router.example.org", has: { key: true }, usedBy: ["Router"] };
const media = { id: MINE, name: "Media", url: "https://media.example.org", has: { key: true, password: false } };
const fields = [
  { key: "type", type: "string" },
  { key: "url", label: "URL", type: "string" },
  { key: "key", label: "API key", type: "string", sensitive: true },
  { key: "fields", label: "Fields", type: "string" },
];

function stub({ dashboard = [router], mine = [media], authEnabled = true, fail } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      const body = options?.body ? JSON.parse(options.body) : undefined;
      const where = String(path);
      calls.push({ path: where, body });
      let value;
      let status = 200;
      if (where.endsWith("/studio/api/access"))
        value = authEnabled ? { authEnabled: true, level: "admin", user: { username: "sam" } } : { authEnabled: false };
      else if (fail && where.endsWith(fail.path) && body) [status, value] = [fail.status, fail.value];
      else if (where.endsWith("/my-connections/use")) value = { connection: { ...media } };
      else if (where.endsWith("/my-connections") && body) value = { connection: { ...media, id: MINE } };
      else if (where.endsWith("/my-connections")) value = { connections: mine };
      else if (where.endsWith("/connections") && body?.action === "add")
        value = {
          connection: { id: "1111111111111111", name: body.name, url: body.url, has: { key: Boolean(body.key) } },
        };
      else if (where.endsWith("/connections") && body) value = { removed: true };
      else value = { connections: dashboard };
      return { ok: status < 400, status, json: async () => value };
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

function Form({ initial, onChange, testable }) {
  const [value, setValue] = useState(initial);
  return (
    <ConfigForm
      value={value}
      fields={fields}
      connections
      testable={testable}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
const mount = (initial, onChange = vi.fn(), testable = false) => {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Form initial={initial} onChange={onChange} testable={testable} />
    </SWRConfig>,
  );
  return onChange;
};

describe("placeholders", () => {
  it("points a widget at a connection and back", () => {
    const value = withConnection({ type: "x", url: "https://a.example.org", key: "k", fields: "a" }, router, [
      "url",
      "key",
    ]);
    expect(value).toEqual({
      type: "x",
      url: connectionPlaceholder(ID, "url"),
      key: connectionPlaceholder(ID, "key"),
      fields: "a",
    });
    expect(withoutConnection(value)).toEqual({ type: "x", fields: "a" });
    // A secret the connection doesn't have is left out.
    expect(withConnection({}, { ...router, has: {} }, ["url", "key"])).toEqual({
      url: connectionPlaceholder(ID, "url"),
    });
  });
});

describe("widget dialog connection", () => {
  it("uses a saved connection and hides the address and key rows", async () => {
    stub();
    const onChange = mount({ type: "x", url: "https://typed.example.org", key: "typed" });
    fireEvent.click(await screen.findByRole("radio", { name: "Saved connection" }));
    expect(screen.queryByLabelText("URL")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Connection" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Router/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: "x",
        url: connectionPlaceholder(ID, "url"),
        key: connectionPlaceholder(ID, "key"),
      }),
    );
    expect(await screen.findByText(/router\.example\.org · Used by 1 widget$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Enter here" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "x" });
    expect(screen.getByLabelText("URL")).toBeTruthy();
  });

  it("copies a personal connection to the dashboard before using it", async () => {
    const calls = stub();
    const onChange = mount({ type: "x", url: connectionPlaceholder(ID, "url") });
    const select = await screen.findByRole("combobox", { name: "Connection" });
    fireEvent.click(select);
    // A personal connection is marked "Just me" in the list.
    fireEvent.click(await screen.findByRole("option", { name: /^Media.*Just me/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: "x",
        url: connectionPlaceholder(MINE, "url"),
        key: connectionPlaceholder(MINE, "key"),
      }),
    );
    expect(calls.find((call) => call.path.endsWith("/my-connections/use")).body).toEqual({ id: MINE });
  });

  it("is hidden while nothing is saved, and saves typed settings as a connection", async () => {
    const calls = stub({ dashboard: [], mine: [], authEnabled: false });
    const onChange = mount({ type: "x", url: "https://nas.example.org", key: "secret" });
    fireEvent.click(await screen.findByRole("button", { name: "Save as a connection…" }));
    expect(screen.queryByRole("radio", { name: "Saved connection" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Just me" })).toBeNull();
    expect(screen.getByLabelText("Name").value).toBe("nas.example.org");
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: "x",
        url: connectionPlaceholder("1111111111111111", "url"),
        key: connectionPlaceholder("1111111111111111", "key"),
      }),
    );
    expect(calls.find((call) => call.body?.action === "add").body).toEqual({
      action: "add",
      name: "nas.example.org",
      url: "https://nas.example.org",
      key: "secret",
    });
    expect(screen.queryByLabelText("API key")).toBeNull();
  });
});

describe("saved connections in dashboard settings", () => {
  it("lists both places and explains a connection still in use", async () => {
    stub({
      fail: {
        path: "/studio/api/connections",
        status: 409,
        value: {
          error: "Widgets still use this connection.",
          code: "CONNECTION_IN_USE",
          details: { usedBy: ["Router"] },
        },
      },
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConnectionsEditor onClose={() => {}} />
      </SWRConfig>,
    );
    expect(await screen.findByText(/key saved · Used by 1 widget/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Change Media" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Router" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Router is still used by Router. Change those widgets first.",
    );
  });

  it("changes a connection without sending the saved key back", async () => {
    const calls = stub();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConnectionsEditor onClose={() => {}} />
      </SWRConfig>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Change Router" }));
    const form = screen.getByRole("form", { name: "Change Router" });
    expect(within(form).getByLabelText("Key").placeholder).toBe("Saved. Type to replace it.");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Main router" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((call) => call.body?.action === "update")).toBe(true));
    expect(calls.find((call) => call.body?.action === "update").body).toEqual({
      action: "update",
      id: ID,
      name: "Main router",
      url: "https://router.example.org",
    });
  });
});

describe("Test connection", () => {
  it("shows once there is an address, sends the dialog's widget and reads out the result", async () => {
    const calls = stub({
      fail: {
        path: "/connection-test",
        status: 200,
        value: { ok: false, kind: "key", message: "The service refused the key or login. Check them." },
      },
    });
    mount({ type: "sonarr", url: "https://tv.example.org", key: "k" }, vi.fn(), true);
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The service refused the key or login.");
    expect(calls.find((call) => call.path.endsWith("/studio/api/connection-test")).body).toEqual({
      widget: { type: "sonarr", url: "https://tv.example.org", key: "k" },
    });
  });

  it("is not offered without an address", () => {
    stub();
    mount({ type: "sonarr", url: "" }, vi.fn(), true);
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });

  it("is not offered where the widget can't be tested", () => {
    stub();
    mount({ type: "sonarr", url: "https://tv.example.org" });
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });
});
