import { describe, expect, it } from "vitest";

import { patchFromDraft, resolveNativePanel } from "./native-adapter.mjs";

const data = {
  services: [
    {
      name: "Home",
      services: [],
      groups: [
        {
          name: "Media",
          services: [
            {
              name: "Library",
              widgets: [
                {
                  type: "sonarr",
                  index: 0,
                  service_group: "Media",
                  service_name: "Library",
                },
                {
                  type: "radarr",
                  index: 1,
                  service_group: "Media",
                  service_name: "Library",
                },
              ],
            },
          ],
          groups: [],
        },
      ],
    },
  ],
  widgets: [
    { type: "datetime", options: { index: 3 } },
    { type: "datetime", options: { index: 1 } },
  ],
  bookmarks: [
    { name: "Z", bookmarks: [] },
    { name: "A", bookmarks: [{ name: "Docs", href: "https://example.test" }] },
  ],
};
const base = {
  id: "safe-id",
  nativeLocator: {
    serviceId: "safe-id",
    groupPath: ["Home", "Media"],
    name: "Library",
  },
};

describe("Native render adapters", () => {
  it("keeps service links free of embedded widget copies", () => {
    const resolved = resolveNativePanel({ ...base, kind: "service" }, data);
    expect(resolved.service.widgets).toEqual([]);
    expect(resolved.service.widget).toBeUndefined();
    expect(resolved.groupName).toBe("Media");
  });
  it("maps mixed singular/array native widget order to the correct proxy index", () => {
    const array = resolveNativePanel(
      {
        ...base,
        kind: "serviceWidget",
        nativeLocator: {
          ...base.nativeLocator,
          widgetIndex: 0,
          sourceKey: "widgets",
          sourceIndex: 0,
          proxyIndex: 0,
          type: "sonarr",
        },
      },
      data,
    );
    const singular = resolveNativePanel(
      {
        ...base,
        kind: "serviceWidget",
        nativeLocator: {
          ...base.nativeLocator,
          widgetIndex: 1,
          sourceKey: "widget",
          sourceIndex: 0,
          proxyIndex: -1,
          type: "radarr",
        },
      },
      data,
    );
    expect(array.widget.index).toBe(0);
    expect(singular.widget.index).toBe(-1);
    expect(singular.widget.service_name).toBe("Library");
    expect(data.services[0].groups[0].services[0].widgets[1].index).toBe(1);
  });
  it("matches information instances by native index and bookmarks by identity after group sorting", () => {
    expect(
      resolveNativePanel(
        {
          kind: "informationWidget",
          nativeLocator: { index: 3, type: "datetime" },
        },
        data,
      ).widget.options.index,
    ).toBe(3);
    expect(
      resolveNativePanel(
        {
          kind: "bookmark",
          nativeLocator: {
            group: "A",
            name: "Docs",
            groupIndex: 0,
            bookmarkIndex: 0,
          },
        },
        data,
      ).bookmark.href,
    ).toBe("https://example.test");
  });
  it("fails closed for ambiguous/missing source matches instead of rendering another service", () => {
    const ambiguous = structuredClone(data);
    ambiguous.services[0].groups[0].services.push({
      ...ambiguous.services[0].groups[0].services[0],
    });
    expect(
      resolveNativePanel({ ...base, kind: "service" }, ambiguous),
    ).toBeNull();
    expect(
      resolveNativePanel(
        {
          ...base,
          kind: "service",
          nativeLocator: { ...base.nativeLocator, groupPath: ["Different"] },
        },
        data,
      ),
    ).toBeNull();
  });
  it("preserves unknown typed options and marks explicit deletion for native patch semantics", () => {
    expect(
      patchFromDraft(
        { key: "{{HOMEPAGE_FILE_TOKEN}}", gone: 1, unknown: { x: false } },
        {
          key: "{{HOMEPAGE_FILE_TOKEN}}",
          unknown: { x: false },
          fields: ["a", "b"],
        },
      ),
    ).toEqual({
      key: "{{HOMEPAGE_FILE_TOKEN}}",
      unknown: { x: false },
      fields: ["a", "b"],
      gone: null,
    });
  });
  it("never bypasses an ambiguous native proxy route with an exact source id or stale discovery descriptor", () => {
    const ambiguous = structuredClone(data);
    ambiguous.services[0].groups[0].services[0].id = "safe-id";
    ambiguous.services.push({
      name: "Other",
      services: [],
      groups: [
        {
          name: "Media",
          services: [{ name: "Library", id: "different-id" }],
          groups: [],
        },
      ],
    });
    expect(
      resolveNativePanel({ ...base, kind: "service" }, ambiguous),
    ).toBeNull();
    expect(
      resolveNativePanel(
        {
          ...base,
          kind: "service",
          available: false,
          nativeLocator: { ...base.nativeLocator, discovered: true },
        },
        data,
      ),
    ).toBeNull();
  });
});
