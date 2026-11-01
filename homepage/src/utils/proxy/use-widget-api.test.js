// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSWR } = vi.hoisted(() => ({ useSWR: vi.fn() }));

vi.mock("swr", () => ({
  default: useSWR,
}));

import useWidgetAPI from "./use-widget-api";

import { CardLookContext, canRefresh, cardLive, refreshCards } from "components/studio/card-look";

const call = (...args) => renderHook(() => useWidgetAPI(...args)).result.current;

describe("utils/proxy/use-widget-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats the proxy url and passes refreshInterval when provided in options", () => {
    useSWR.mockReturnValue({ data: { ok: true }, error: undefined, mutate: "m" });

    const widget = { service_group: "g", service_name: "s", index: 0 };
    const result = call(widget, "status", { refreshInterval: 123, foo: "bar" });

    expect(useSWR).toHaveBeenCalledWith(
      expect.stringContaining("/api/services/proxy?"),
      expect.objectContaining({ refreshInterval: 123 }),
    );
    expect(result.data).toEqual({ ok: true });
    expect(result.error).toBeUndefined();
    expect(result.mutate).toBe("m");
  });

  it("passes additional SWR configuration separately from the proxy query", () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined, mutate: vi.fn() });

    const widget = { service_group: "g", service_name: "s", index: 0 };
    const onSuccess = vi.fn();
    call(widget, "status", { refreshInterval: 123 }, { onSuccess });

    const [url, config] = useSWR.mock.calls[0];
    expect(url).not.toContain("onSuccess");
    expect(config).toEqual({ refreshInterval: 123, onSuccess });
  });

  it("returns data.error as the top-level error", () => {
    const dataError = { message: "nope" };
    useSWR.mockReturnValue({ data: { error: dataError }, error: undefined, mutate: vi.fn() });

    const widget = { service_group: "g", service_name: "s", index: 0 };
    const result = call(widget, "status", {});

    expect(result.error).toBe(dataError);
  });

  it("disables the request when endpoint is an empty string", () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined, mutate: vi.fn() });

    const widget = { service_group: "g", service_name: "s", index: 0 };
    call(widget, "");

    expect(useSWR).toHaveBeenCalledWith(null, {});
  });

  it("lets its Studio card refresh it now and say when its data arrived", () => {
    const mutate = vi.fn();
    useSWR.mockReturnValue({ data: { ok: true }, error: undefined, mutate });
    const widget = { service_group: "g", service_name: "s", index: 0 };
    const wrapper = ({ children }) =>
      createElement(CardLookContext.Provider, { value: { id: "card-1", refreshMs: 30000 } }, children);
    const { unmount } = renderHook(() => useWidgetAPI(widget, "status"), { wrapper });
    expect(canRefresh("card-1")).toBe(true);
    expect(cardLive("card-1").updatedAt).toBeGreaterThan(0);
    expect(cardLive("card-1").interval).toBe(30000);
    expect(refreshCards(["card-1", "unknown"])).toBe(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    unmount();
    expect(canRefresh("card-1")).toBe(false);
  });
});
