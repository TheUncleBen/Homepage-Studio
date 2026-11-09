// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardLookContext } from "./card-look";
import NativePanel from "./native-panel";

vi.mock("components/widgets/widget", () => ({ default: () => <div>native widget</div> }));
vi.mock("./preferences", () => ({ usePreferences: () => ({}), withDisplayPreferences: (widget) => widget }));

function renderResources(options) {
  const panel = { id: "info-1", kind: "informationWidget", nativeLocator: { type: "resources", index: 0 } };
  const data = { widgets: [{ type: "resources", options: { index: 0, ...options } }] };
  return render(
    <CardLookContext.Provider value={{ header: "name" }}>
      <NativePanel panel={panel} data={data} />
    </CardLookContext.Provider>,
  );
}

describe("Resources card", () => {
  it("says how to fill it when nothing is chosen, instead of drawing an empty card", () => {
    renderResources({});
    expect(screen.getByText("Nothing chosen to show")).toBeInTheDocument();
    expect(screen.queryByText("native widget")).not.toBeInTheDocument();
  });

  it("draws the readings once one is chosen", () => {
    renderResources({ cpu: true });
    expect(screen.getByText("native widget")).toBeInTheDocument();
    renderResources({ disk: ["/"] });
    expect(screen.getAllByText("native widget")).toHaveLength(2);
  });
});
