import { describe, expect, it, vi } from "vitest";

import { downNote } from "./studio-card";

vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => key }) }));

describe("a down card's note", () => {
  it("reads as one phrase for no answer or an HTTP code", () => {
    expect(downNote({ state: "down" }, "12:48")).toBe("No answer since 12:48");
    expect(downNote({ state: "down", text: "Error" }, "12:48")).toBe("No answer since 12:48");
    expect(downNote({ state: "down", code: 502 }, "12:48")).toBe("Answered 502 since 12:48");
  });

  it("keeps a reason sentence apart from the time", () => {
    expect(downNote({ state: "down", text: "Name not found · check the address" }, "12:48")).toBe(
      "Name not found · check the address · since 12:48",
    );
    expect(downNote({ state: "down", text: "The certificate has expired" })).toBe("The certificate has expired");
  });
});
