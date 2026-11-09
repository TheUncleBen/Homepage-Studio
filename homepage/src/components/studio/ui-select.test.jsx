// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./ui";

const options = [
  ["de", "Deutsch"],
  ["en", "English"],
  ["es", "Español", "Spain"],
  ["fr", "Français"],
];

function Fixture({ onChange = () => {} }) {
  const [value, setValue] = useState("en");
  return (
    <Select
      label="Language"
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("Select (the themed list every Studio dropdown uses)", () => {
  it("opens a listbox, marks the chosen option and picks with a click", () => {
    const onChange = vi.fn();
    render(<Fixture onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Language" });
    expect(box.textContent).toBe("English");
    fireEvent.click(box);
    expect(screen.getByRole("option", { name: "English" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Español/ }).textContent).toContain("Spain");
    fireEvent.click(screen.getByRole("option", { name: "Français" }));
    expect(onChange).toHaveBeenCalledWith("fr");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves with the arrow keys and chooses with Enter", () => {
    const onChange = vi.fn();
    render(<Fixture onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Language" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("es");
  });

  it("jumps to an option by typing its first letters, like a system list", () => {
    const onChange = vi.fn();
    render(<Fixture onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Language" });
    vi.useFakeTimers({ toFake: ["Date"] });
    fireEvent.keyDown(box, { key: "f" });
    expect(onChange).toHaveBeenLastCalledWith("fr");
    // A pause starts a new search.
    vi.advanceTimersByTime(1000);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "d" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("de");
    vi.useRealTimers();
  });
});
