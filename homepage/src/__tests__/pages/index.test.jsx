// @vitest-environment jsdom
// This replaces the stock composition tests because Studio owns the approved main-page layout.
// Native SSR/auth/config behavior and the new no-reload/independent-host contract remain tested.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateDashboardData } from "utils/config/dashboard";
import { ColorContext } from "utils/contexts/color";
import { SettingsContext } from "utils/contexts/settings";
import { ThemeContext } from "utils/contexts/theme";

const {
  state,
  i18n,
  nativeMutate,
  globalMutate,
  settingsRead,
  servicesRead,
  bookmarksRead,
  widgetsRead,
  translations,
  request,
} = vi.hoisted(() => ({
  state: {
    data: null,
    error: null,
    boardProps: null,
    quickProps: null,
    requests: [],
    mounts: 0,
    script: null,
    deferBoardReady: false,
  },
  i18n: { language: "en", changeLanguage: vi.fn() },
  nativeMutate: vi.fn(),
  globalMutate: vi.fn(),
  request: vi.fn(),
  settingsRead: vi.fn(),
  servicesRead: vi.fn(),
  bookmarksRead: vi.fn(),
  widgetsRead: vi.fn(),
  translations: vi.fn(),
}));
vi.mock("next/head", () => ({ default: ({ children }) => children }));
vi.mock("next/script", () => ({
  default: function ScriptFixture(props) {
    state.script = props;
    return null;
  },
}));
vi.mock("next-i18next/pages", () => ({
  useTranslation: () => ({ i18n, t: (key) => key }),
}));
vi.mock("next-i18next/pages/serverSideTranslations", () => ({
  serverSideTranslations: translations,
}));
vi.mock("utils/config/config", () => ({ getSettings: settingsRead }));
vi.mock("utils/config/api-response", () => ({
  servicesResponse: servicesRead,
  bookmarksResponse: bookmarksRead,
  widgetsResponse: widgetsRead,
}));
vi.mock("utils/logger", () => ({ default: () => ({ error() {} }) }));
vi.mock("components/studio/api.mjs", () => ({ studioRequest: request }));
vi.mock("swr", () => ({
  SWRConfig: ({ children }) => children,
  default: (key, _fetcher, options) => {
    state.requests.push(key);
    return {
      data: state.data || options.fallbackData,
      error: state.error,
      mutate: nativeMutate,
    };
  },
  useSWRConfig: () => ({ mutate: globalMutate }),
}));
vi.mock("components/studio/board", () => ({
  default: function BoardFixture(props) {
    state.boardProps = props;
    const { onInteractionBlocked } = props;
    useEffect(() => {
      state.mounts += 1;
    }, []);
    useEffect(() => {
      if (!state.deferBoardReady) onInteractionBlocked(false);
    }, [onInteractionBlocked]);
    return (
      <main data-testid="studio-board">
        <button onClick={props.onSearch}>Open Quick Launch</button>
        <input aria-label="Stable native fixture" />
      </main>
    );
  },
}));
vi.mock("components/quicklaunch", () => ({
  default: (props) => {
    state.quickProps = props;
    return <div data-testid="quick-launch">{props.isOpen ? "open" : "closed"}</div>;
  },
}));

beforeEach(() => {
  invalidateDashboardData();
  vi.clearAllMocks();
  state.data = null;
  state.error = null;
  state.requests = [];
  state.mounts = 0;
  state.deferBoardReady = false;
  settingsRead.mockReturnValue({
    title: "Homepage",
    providers: { private: "fixture-secret" },
    language: "en",
  });
  servicesRead.mockResolvedValue([]);
  bookmarksRead.mockResolvedValue([]);
  widgetsRead.mockResolvedValue([]);
  translations.mockImplementation(async (language) => ({
    _translations: language,
  }));
  request.mockResolvedValue({ revalidated: true });
  nativeMutate.mockImplementation(async () => state.data);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function mount(settings = { title: "Studio" }, fallback = {}, dashboard = { id: "default", basePath: "" }) {
  const { default: Page } = await import("pages/index.jsx");
  const setters = {
    setSettings: vi.fn(),
    setTheme: vi.fn(),
    setColor: vi.fn(),
  };
  const rendered = render(
    <SettingsContext.Provider value={{ settings, setSettings: setters.setSettings }}>
      <ThemeContext.Provider value={{ setTheme: setters.setTheme }}>
        <ColorContext.Provider value={{ setColor: setters.setColor }}>
          <Page initialSettings={settings} fallback={fallback} studioDashboard={dashboard} />
        </ColorContext.Provider>
      </ThemeContext.Provider>
    </SettingsContext.Provider>,
  );
  return { ...rendered, ...setters };
}

describe("Studio main page native SSR boundary", () => {
  it("uses native sanitized data and excludes private providers from page props", async () => {
    servicesRead.mockResolvedValue([{ name: "Group", services: [], groups: [] }]);
    const { getServerSideProps } = await import("pages/index.jsx");
    const result = await getServerSideProps({});
    expect(result.props.initialSettings).toEqual({
      title: "Homepage",
      language: "en",
    });
    expect(result.props.fallback["/api/services"]).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(translations).toHaveBeenCalledWith("en");
  });
  it("retains native legacy locale normalization and fallback on source errors", async () => {
    settingsRead.mockReturnValueOnce({ language: "zh-CN", providers: {} });
    const { getServerSideProps } = await import("pages/index.jsx");
    await getServerSideProps({});
    expect(translations).toHaveBeenCalledWith("zh-Hans");
    invalidateDashboardData();
    servicesRead.mockRejectedValueOnce(new Error("fixture"));
    const failed = await getServerSideProps({});
    expect(failed.props.initialSettings).toEqual({});
    expect(failed.props.fallback["/api/services"]).toEqual([]);
  });
  it("retains native allowed-host enforcement", async () => {
    const saved = process.env.HOMEPAGE_ALLOWED_HOSTS;
    process.env.HOMEPAGE_ALLOWED_HOSTS = "local.example";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { getServerSideProps } = await import("pages/index.jsx");
      expect(
        await getServerSideProps({
          req: { headers: { host: "other.example" } },
        }),
      ).toEqual({ notFound: true });
    } finally {
      process.env.HOMEPAGE_ALLOWED_HOSTS = saved;
      log.mockRestore();
    }
  });

  it("returns the worker's dashboard descriptor and indexing header from native resolved settings", async () => {
    const id = "10d16ad0-34be-4cb8-a459-7365f2aaab71";
    vi.stubGlobal("document", undefined);
    vi.stubEnv("STUDIO_DASHBOARD_ID", id);
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/family");
    settingsRead.mockReturnValueOnce({ title: "Private family", disableIndexing: true });
    const { getServerSideProps } = await import("pages/index.jsx");
    const res = { setHeader: vi.fn() };
    const result = await getServerSideProps({ res });
    expect(result.props.studioDashboard).toEqual({ id, basePath: "/family" });
    expect(res.setHeader).toHaveBeenCalledWith("X-Robots-Tag", "noindex, nofollow");
    invalidateDashboardData();
    settingsRead.mockReturnValueOnce({ disableIndexing: false });
    const publicRes = { setHeader: vi.fn() };
    await getServerSideProps({ res: publicRes });
    expect(publicRes.setHeader).not.toHaveBeenCalled();
  });
});

describe("Studio main-page composition", () => {
  it("scopes CSS and JS to its dashboard, sends its identity to the board and renders noindex metadata", async () => {
    const dashboard = { id: "10d16ad0-34be-4cb8-a459-7365f2aaab71", basePath: "/family" };
    await mount({ title: "Family", disableIndexing: true }, {}, dashboard);
    expect(state.boardProps.dashboard).toEqual(dashboard);
    expect(document.querySelector('meta[name="studio-dashboard-id"]').content).toBe(dashboard.id);
    expect(document.querySelector('meta[name="robots"]').content).toBe("noindex, nofollow");
    expect(document.querySelector('link[rel="stylesheet"]').getAttribute("href")).toBe(
      "/family/api/config/custom.css?v=0",
    );
    expect(state.script.src).toBe("/family/api/config/custom.js");
    expect(document.querySelector('link[rel="icon"]').getAttribute("href")).toBe("/homepage.ico");
  });

  it("starts Quick Launch inert and rejects shortcuts and the native floating control until the board reports readiness", async () => {
    state.deferBoardReady = true;
    await mount();
    const quickLaunch = screen.getByTestId("quick-launch");
    const surface = quickLaunch.closest(".studio-quicklaunch");
    expect(surface).toHaveAttribute("inert");
    expect(surface).toHaveAttribute("aria-hidden", "true");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(quickLaunch).toHaveTextContent("closed");
    act(() => state.quickProps.setSearching(true));
    expect(quickLaunch).toHaveTextContent("closed");
    act(() => state.boardProps.onInteractionBlocked(false));
    expect(surface).not.toHaveAttribute("inert");
    expect(surface).not.toHaveAttribute("aria-hidden");
    act(() => state.quickProps.setSearching(true));
    expect(quickLaunch).toHaveTextContent("open");
  });

  it("emits the chosen appearance before hydration and tracks device changes for native widget themes", async () => {
    let listener;
    const media = {
      matches: false,
      addEventListener: vi.fn((_, changed) => {
        listener = changed;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    const setters = await mount({
      studioTheme: { mode: "system", accent: "#81a8c8" },
    });
    expect(setters.setTheme).toHaveBeenLastCalledWith("light");
    const css = document.querySelector("style[data-studio-appearance]").textContent;
    expect(css).toContain(":where(:root)");
    expect(css).toContain("@media(prefers-color-scheme:light)");
    act(() => {
      media.matches = true;
      listener();
    });
    expect(setters.setTheme).toHaveBeenLastCalledWith("dark");
  });
  it("keeps Quick Launch shortcuts out of an open editor or an unavailable native data pair", async () => {
    await mount();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("open");
    act(() => state.boardProps.onInteractionBlocked(true));
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
    // Native Quick Launch's optional mobile button calls its supplied setter.
    act(() => state.quickProps.setSearching(true));
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
    act(() => state.quickProps.setSearching((current) => !current));
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
    act(() => state.boardProps.onInteractionBlocked(false));
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("open");
  });
  it("mounts a single board with native data and never requests raw editor state during ordinary viewing", async () => {
    await mount(
      {},
      {
        "/api/services": [],
        "/api/widgets": [{ type: "greeting", options: { index: 0, text: "Hello" } }],
        "/api/bookmarks": [],
      },
    );
    expect(screen.getByTestId("studio-board")).toBeInTheDocument();
    expect(state.boardProps.nativeData.widgets[0].type).toBe("greeting");
    expect(new Set(state.requests)).toEqual(new Set(["/api/studio/data"]));
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps native Quick Launch links including nested services and supports the keyboard shortcut", async () => {
    await mount(
      {},
      {
        "/api/services": [
          {
            name: "A",
            services: [],
            groups: [
              {
                name: "B",
                services: [{ name: "Link", href: "https://example.test" }, { name: "Widget only" }],
                groups: [],
              },
            ],
          },
        ],
        "/api/bookmarks": [
          {
            name: "Bookmarks",
            bookmarks: [{ name: "Docs", href: "https://docs.example.test" }],
          },
        ],
      },
    );
    expect(state.quickProps.servicesAndBookmarks.map((item) => item.name)).toEqual(["Docs", "Link"]);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("open");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("quick-launch")).toHaveTextContent("closed");
  });
  it("refreshes native render data and CSS after editing without replacing healthy board nodes", async () => {
    state.data = {
      settings: {},
      services: [],
      widgets: [],
      bookmarks: [],
      configurationRevision: "one",
    };
    await mount();
    const input = screen.getByLabelText("Stable native fixture");
    fireEvent.change(input, { target: { value: "retain this" } });
    state.data = {
      ...state.data,
      widgets: [{ type: "datetime", options: { index: 0 } }],
      configurationRevision: "two",
    };
    await act(async () => {
      await state.boardProps.onNativeChange();
    });
    expect(screen.getByLabelText("Stable native fixture")).toBe(input);
    expect(input).toHaveValue("retain this");
    expect(state.mounts).toBe(1);
    expect(request).toHaveBeenCalledWith("/api/revalidate");
    expect(globalMutate).toHaveBeenCalledWith("/api/widgets", state.data.widgets, { revalidate: false });
    expect(document.querySelector('link[rel="stylesheet"]').href).toContain("custom.css?v=1");
  });
  it("reports native refresh errors, applies identity/locale and leaves customJS loading native", async () => {
    state.error = new Error("native temporarily offline");
    const setters = await mount({
      title: "Private workspace",
      language: "zh-CN",
      favicon: "/local/icon.png",
      theme: "dark",
      color: "slate",
    });
    expect(screen.getByText(/Native widget data is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByTestId("studio-board")).toBeInTheDocument();
    expect(setters.setTheme).toHaveBeenCalledWith("dark");
    expect(setters.setColor).toHaveBeenCalledWith("slate");
    expect(i18n.changeLanguage).toHaveBeenCalledWith("zh-Hans");
    expect(document.title).toBe("Private workspace");
    expect(document.querySelector('link[rel="icon"]').getAttribute("href")).toBe("/local/icon.png");
    expect(state.script.src).toBe("/api/config/custom.js");
  });
});
