import { describe, expect, it } from "vitest";

import { formatValue, splitValue } from "./value-format.mjs";

describe("card value formats", () => {
  it("splits the number from its unit", () => {
    expect(splitValue("21.4%")).toEqual({ number: "21.4", unit: "%" });
    expect(splitValue("18.2 MB/s")).toEqual({ number: "18.2", unit: "MB/s" });
    expect(splitValue("84,210")).toEqual({ number: "84,210", unit: "" });
    expect(splitValue("Up")).toEqual({ number: "Up", unit: "" });
  });
  it("shortens plain numbers and leaves text alone", () => {
    expect(formatValue("84,210", "full")).toBe("84,210");
    expect(formatValue("84,210", "short")).toBe("84.2k");
    expect(formatValue("84,210", "compact")).toBe("84k");
    expect(formatValue("1,234", "short")).toBe("1,234");
    expect(formatValue("1,234", "compact")).toBe("1k");
    expect(formatValue("21.47%", "short")).toBe("21.5%");
    expect(formatValue("1200000 ms", "compact")).toBe("1M ms");
    expect(formatValue("Up", "compact")).toBe("Up");
  });
});
