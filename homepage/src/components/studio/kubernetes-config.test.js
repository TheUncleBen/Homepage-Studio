import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, getKubeConfig } = vi.hoisted(() => {
  const state = { current: null };
  return { state, getKubeConfig: vi.fn(() => state.current) };
});
vi.mock("@kubernetes/client-node", () => ({
  NetworkingV1Api: class NetworkingV1Api {},
  CustomObjectsApi: class CustomObjectsApi {},
}));
vi.mock("utils/config/kubernetes", () => ({
  getKubeConfig,
  getKubernetes: () => ({ ingress: true, traefik: true, gateway: true }),
  checkCRD: async () => true,
  ANNOTATION_BASE: "gethomepage.dev",
  ANNOTATION_WIDGET_BASE: "gethomepage.dev/widget.",
  HTTPROUTE_API_GROUP: "gateway.networking.k8s.io",
  HTTPROUTE_API_VERSION: "v1",
}));
vi.mock("utils/config/config", () => ({
  substituteEnvironmentVars: (value) => value,
}));
vi.mock("utils/logger", () => ({
  default: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

function client(name) {
  const item = {
    metadata: {
      name,
      annotations: { "gethomepage.dev/href": `https://${name}.example.test` },
    },
  };
  return {
    makeApiClient: () => ({
      listIngressForAllNamespaces: async () => ({ items: [item] }),
      listClusterCustomObject: async () => ({ items: [item] }),
      getNamespacedCustomObject: async () => ({
        spec: {
          listeners: [
            { name: "web", protocol: name === "new" ? "HTTPS" : "HTTP" },
          ],
        },
      }),
    }),
  };
}
const route = {
  kind: "HTTPRoute",
  metadata: { name: "route", namespace: "fixture", annotations: {} },
  spec: {
    hostnames: ["route.example.test"],
    parentRefs: [{ name: "gateway", sectionName: "web" }],
    rules: [{ matches: [{ path: { type: "PathPrefix", value: "/" } }] }],
  },
};
const cases = [
  {
    name: "Ingress",
    load: () => import("utils/kubernetes/ingress-list"),
    read: (mod) => mod.default(),
    result: (value) => value[0]?.metadata.name,
    expected: "new",
  },
  {
    name: "Traefik",
    load: () => import("utils/kubernetes/traefik-list"),
    read: (mod) => mod.default(),
    result: (value) => value[0]?.metadata.name,
    expected: "new",
  },
  {
    name: "HTTPRoute",
    load: () => import("utils/kubernetes/httproute-list"),
    read: (mod) => mod.default(),
    result: (value) => value[0]?.metadata.name,
    expected: "new",
  },
  {
    name: "Gateway protocol",
    load: () => import("utils/kubernetes/resource-helpers"),
    read: (mod) => mod.constructedServiceFromResource(route),
    result: (value) => value.href,
    expected: "https://route.example.test/",
  },
];

beforeEach(() => {
  state.current = null;
  vi.clearAllMocks();
  vi.resetModules();
});
describe("Pinned native Kubernetes configuration refresh audit", () => {
  it.each(cases)(
    "$name supports enabling Kubernetes after module initialization",
    async ({ load, read, result, expected }) => {
      const nativeModule = await load();
      state.current = client("new");
      expect(result(await read(nativeModule))).toBe(expected);
    },
  );
  it.each(cases)(
    "$name uses the replacement Kubernetes configuration without module reload",
    async ({ load, read, result, expected }) => {
      state.current = client("old");
      const nativeModule = await load();
      await read(nativeModule);
      state.current = client("new");
      expect(result(await read(nativeModule))).toBe(expected);
    },
  );
});
