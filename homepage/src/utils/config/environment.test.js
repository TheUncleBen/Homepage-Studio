import { describe, expect, it, vi } from "vitest";

import { resolveEnvironmentVariables } from "./environment.mjs";

describe("shared native environment resolution", () => {
  it("retains native insertion-order substitution and literal dollar values", () => {
    const variables = [
      ["HOMEPAGE_VAR_FIRST", "{{HOMEPAGE_VAR_SECOND}}"],
      ["HOMEPAGE_VAR_SECOND", "$&-$1-$$"],
      ["OTHER_HOMEPAGE_VAR_THIRD", "must-not-replace"],
    ];
    expect(resolveEnvironmentVariables("{{HOMEPAGE_VAR_FIRST}} {{OTHER_HOMEPAGE_VAR_THIRD}}", variables, vi.fn())).toBe(
      "$&-$1-$$ {{OTHER_HOMEPAGE_VAR_THIRD}}",
    );
  });

  it("does not access secret files when there are no placeholders", () => {
    const readFile = vi.fn(() => {
      throw new Error("Must not read");
    });
    expect(resolveEnvironmentVariables("disableIndexing: true", [["HOMEPAGE_FILE_SECRET", "/secret"]], readFile)).toBe(
      "disableIndexing: true",
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it("uses the caller's file reader and matches native reads even for unused file placeholders", () => {
    const readFile = vi.fn((file, encoding) => {
      expect(encoding).toBe("utf8");
      return file === "/index-policy" ? "true" : "unused";
    });
    const result = resolveEnvironmentVariables(
      "disableIndexing: {{HOMEPAGE_FILE_POLICY}}",
      [
        ["HOMEPAGE_FILE_POLICY", "/index-policy"],
        ["HOMEPAGE_FILE_OTHER", "/other"],
      ],
      readFile,
    );
    expect(result).toBe("disableIndexing: true");
    expect(readFile.mock.calls).toEqual([
      ["/index-policy", "utf8"],
      ["/other", "utf8"],
    ]);
  });

  it("propagates file failures so native and deployment indexing readers can fail closed", () => {
    expect(() =>
      resolveEnvironmentVariables("{{HOMEPAGE_FILE_MISSING}}", [["HOMEPAGE_FILE_MISSING", "/missing"]], () => {
        throw new Error("missing file");
      }),
    ).toThrow("missing file");
  });

  it("guards input and prospective UTF-8 expansion before allocating the replaced string", () => {
    expect(() => resolveEnvironmentVariables("éé", [], vi.fn(), { maxBytes: 3 })).toThrow(/size limit/);
    const token = "{{HOMEPAGE_FILE_BIG}}";
    const text = token.repeat(100);
    const replace = vi.spyOn(String.prototype, "replaceAll");
    try {
      expect(() =>
        resolveEnvironmentVariables(text, [["HOMEPAGE_FILE_BIG", "/secret"]], () => "é".repeat(1024), {
          maxBytes: 4096,
        }),
      ).toThrow(/size limit/);
      expect(replace).not.toHaveBeenCalled();
    } finally {
      replace.mockRestore();
    }
  });

  it("keeps native ordering, shrinking replacements and unused file reads within the bounded mode", () => {
    const read = vi.fn(() => "x".repeat(5000));
    const variables = [
      ["HOMEPAGE_VAR_FIRST", "{{HOMEPAGE_VAR_SECOND}}"],
      ["HOMEPAGE_VAR_SECOND", "é"],
      ["HOMEPAGE_FILE_UNUSED", "/unused"],
    ];
    expect(resolveEnvironmentVariables("{{HOMEPAGE_VAR_FIRST}}", variables, read, { maxBytes: 32 })).toBe("é");
    expect(read).toHaveBeenCalledWith("/unused", "utf8");
    expect(
      resolveEnvironmentVariables("{{HOMEPAGE_VAR_FIRST}}", [["HOMEPAGE_VAR_FIRST", "x".repeat(10000)]], vi.fn())
        .length,
    ).toBe(10000);
  });
});
