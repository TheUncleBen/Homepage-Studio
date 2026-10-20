import { describe, expect, it, vi } from "vitest";

import getServiceWidget, {
  cleanServiceGroups,
  servicesFromConfig,
} from "utils/config/service-helpers";

import { resolveNativePanel } from "./native-adapter.mjs";

vi.mock("utils/config/config", () => ({
  default: () => {},
  CONF_DIR: "/studio-fixture",
  getSettings: () => ({}),
  substituteEnvironmentVars: (text) => text,
}));
vi.mock("utils/logger", () => ({
  default: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));
vi.mock("utils/config/kubernetes", () => ({ getKubeConfig: () => null }));
vi.mock("utils/kubernetes/export", () => ({ default: {} }));
vi.mock("fs", async (importOriginal) => {
  const fs = await importOriginal();
  return {
    ...fs,
    promises: {
      ...fs.promises,
      readFile: async (path, ...args) =>
        String(path) === "/studio-fixture/services.yaml"
          ? JSON.stringify([
              {
                Group: [
                  {
                    Mixed: {
                      id: "mixed",
                      widgets: [
                        {
                          type: "sonarr",
                          url: "http://array.invalid",
                          key: "fictional-array-token",
                        },
                      ],
                      widget: {
                        type: "radarr",
                        url: "http://singular.invalid",
                        key: "fictional-singular-token",
                      },
                    },
                  },
                ],
              },
            ])
          : fs.promises.readFile(path, ...args),
    },
  };
});

describe("Pinned native private-config routing", () => {
  it("routes both mixed-form widgets to their own native private options without putting keys in render data", async () => {
    const groups = cleanServiceGroups(await servicesFromConfig());
    const data = { services: groups };
    const common = { serviceId: "mixed", groupPath: ["Group"], name: "Mixed" };
    const array = resolveNativePanel(
      {
        id: "array",
        kind: "serviceWidget",
        nativeLocator: {
          ...common,
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
        id: "singular",
        kind: "serviceWidget",
        nativeLocator: {
          ...common,
          widgetIndex: 1,
          sourceKey: "widget",
          sourceIndex: 0,
          proxyIndex: -1,
          type: "radarr",
        },
      },
      data,
    );
    expect(array).not.toBeNull();
    expect(singular).not.toBeNull();
    expect(JSON.stringify(data)).not.toContain("fictional-");
    expect(
      (await getServiceWidget("Group", "Mixed", array.widget.index)).key,
    ).toBe("fictional-array-token");
    expect(
      (await getServiceWidget("Group", "Mixed", singular.widget.index)).key,
    ).toBe("fictional-singular-token");
  });
});
