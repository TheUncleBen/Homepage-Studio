// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import WidgetDefaults from "./widget-defaults";

function Draft({ initial, onChange, pageCount }) {
  const [settings, setSettings] = useState(initial);
  return (
    <WidgetDefaults
      settings={settings}
      pageCount={pageCount}
      onChange={(next) => {
        setSettings(next);
        onChange(next);
      }}
    />
  );
}
const pick = (group, name) =>
  fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name }));

describe("dashboard widget defaults", () => {
  it("stores a default only while it differs from the built-in one", () => {
    const onChange = vi.fn();
    render(<Draft initial={{ title: "Lab" }} onChange={onChange} />);
    pick("Refresh", "1 min");
    expect(onChange).toHaveBeenLastCalledWith({ title: "Lab", studioDefaults: { refresh: "1m" } });
    pick("On phones", "Hide");
    expect(onChange.mock.lastCall[0].studioDefaults).toEqual({ refresh: "1m", phones: "hide" });
    pick("Refresh", "Auto");
    pick("On phones", "Show");
    expect(onChange).toHaveBeenLastCalledWith({ title: "Lab" });
  });

  it("writes link targets to Homepage's own target setting", () => {
    const onChange = vi.fn();
    render(<Draft initial={{}} onChange={onChange} />);
    pick("Links open in", "Same tab");
    expect(onChange).toHaveBeenLastCalledWith({ target: "_self" });
    pick("Links open in", "New tab");
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("asks which page to open on only with two or more pages", () => {
    const onChange = vi.fn();
    const { unmount } = render(<Draft initial={{}} onChange={onChange} pageCount={1} />);
    expect(screen.queryByRole("radiogroup", { name: "Opens on" })).toBeNull();
    unmount();
    render(<Draft initial={{}} onChange={onChange} pageCount={3} />);
    pick("Opens on", "Last page viewed");
    expect(onChange).toHaveBeenLastCalledWith({ studioDefaults: { opensOn: "last" } });
    pick("Opens on", "First page");
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("keeps status colours and background updates sparse", () => {
    const onChange = vi.fn();
    render(<Draft initial={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Problem colour"), { target: { value: "#ff8800" } });
    expect(onChange).toHaveBeenLastCalledWith({ studioDefaults: { statusColours: { problem: "#ff8800" } } });
    pick("Background updates", "Keep updating");
    expect(onChange.mock.lastCall[0].studioDefaults).toEqual({
      statusColours: { problem: "#ff8800" },
      updates: "keep",
    });
    fireEvent.change(screen.getByLabelText("Problem colour"), { target: { value: "#e5604f" } });
    pick("Background updates", "Pause when hidden");
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
