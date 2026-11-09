// @vitest-environment jsdom
// The Logs block only asks for logs, and only draws, for someone this
// dashboard lets read its logs, never with sign-in off (security review I3).
import { render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let access;
vi.mock("./api.mjs", () => ({
  studioRequest: vi.fn(async (path) => {
    calls.push(path);
    if (path === "/studio/api/access") return access;
    return {};
  }),
  deploymentRequest: vi.fn(async (path) => {
    calls.push(path);
    return {
      events: [
        { id: "1", ts: 1, severity: 3, source_type: "widget", message: "<img src=x onerror=alert(1)>" },
        { id: "2", ts: 2, severity: 4, source_type: "browser", actor: "sam", message: "Svc: did not answer" },
      ],
    };
  }),
}));
vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock("components/services/widget/block", () => ({
  default: ({ label, value }) => (
    <span>
      {label} {value}
    </span>
  ),
}));

const { CardBlocks } = await import("./card-values");

const card = { id: "panel-1", blocks: [{ id: "b1", type: "logs" }] };
const draw = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CardBlocks card={card} />
    </SWRConfig>,
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Logs block gate", () => {
  beforeEach(() => calls.splice(0));
  for (const [name, value] of [
    ["sign-in off", { authEnabled: false, dashboard: { id: "default" } }],
    [
      "no logs grant",
      { authEnabled: true, dashboard: { id: "default" }, operations: { monitoring: true, logs: false } },
    ],
    ["access not loaded / failed", undefined],
  ])
    it(`${name}: no block and no logs request`, async () => {
      access = value;
      const { container } = draw();
      await settle();
      expect(container.querySelector('[data-type="logs"]')).toBeNull();
      expect(calls.some((path) => path.includes("/ops/"))).toBe(false);
    });
  it("logs grant: asks for this dashboard's lines for this widget only, drawn as text", async () => {
    access = { authEnabled: true, dashboard: { id: "dash-a" }, operations: { logs: true } };
    const { container } = draw();
    await settle();
    await settle();
    const asked = calls.find((path) => path.includes("/ops/logs/search"));
    const query = new URLSearchParams(asked.split("?")[1]);
    expect(query.get("dashboard")).toBe("dash-a");
    expect(query.get("q")).toBe("panel:panel-1");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    // A browser's report says whose browser sent it; Studio's own lines don't.
    const lines = container.querySelectorAll(".studio-log-line");
    expect(lines[0].querySelector(".studio-log-source")).toBeNull();
    expect(lines[1].querySelector(".studio-log-source").textContent).toBe("sam's browser");
  });
});
