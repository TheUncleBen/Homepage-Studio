// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "components/errorboundry";
import { StudioRevisionContext } from "utils/contexts/studio-revision";

import { PanelLayer } from "./board";
import { moveUnit, stackBoard, unstackBoard } from "./geometry.mjs";
import { createStackPlayback } from "./playback.mjs";

vi.mock("./native-panel", () => ({ default: () => null }));

describe("Stable React-owned native hosts", () => {
  it("cancels a standalone panel hold when an overlay opens without replacing its host", () => {
    vi.useFakeTimers();
    const hold = vi.fn();
    const props = {
      board: {
        version: 2,
        columns: 12,
        panels: [{ id: "a", title: "Clock", kind: "informationWidget", rect: { x: 0, y: 0, w: 4, h: 3 } }],
        stacks: [],
      },
      data: {},
      geometry: new Map([["a", { left: 0, top: 0, width: 320, height: 248 }]]),
      controllers: { current: new Map() },
      selection: [],
      editing: false,
      active: {},
      onLongPress: hold,
      renderNative: () => <input aria-label="Held native input" />,
    };
    const { rerender, unmount } = render(<PanelLayer {...props} />);
    try {
      const input = screen.getByLabelText("Held native input");
      fireEvent(
        screen.getByText("Clock"),
        Object.assign(new Event("pointerdown", { bubbles: true }), {
          pointerId: 1,
          button: 0,
          isPrimary: true,
          clientX: 100,
          clientY: 20,
        }),
      );
      rerender(<PanelLayer {...props} overlayOpen />);
      act(() => vi.advanceTimersByTime(500));
      expect(hold).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Held native input")).toBe(input);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("preserves the same input nodes/state/mounts through move, resize, stacking, slides and unstacking", () => {
    const mounts = new Map();
    const unmounts = new Map();
    function NativeFixture({ panel }) {
      const [value, setValue] = useState("");
      useEffect(() => {
        mounts.set(panel.id, (mounts.get(panel.id) || 0) + 1);
        return () => unmounts.set(panel.id, (unmounts.get(panel.id) || 0) + 1);
      }, [panel.id]);
      return (
        <>
          <input
            aria-label={`Native input ${panel.id}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <iframe title={`Native frame ${panel.id}`} />
        </>
      );
    }
    let board = {
      version: 2,
      columns: 12,
      panels: [
        {
          id: "a",
          title: "Search",
          kind: "informationWidget",
          rect: { x: 0, y: 0, w: 4, h: 3 },
        },
        {
          id: "b",
          title: "Calendar",
          kind: "serviceWidget",
          rect: { x: 4, y: 0, w: 4, h: 3 },
        },
      ],
      stacks: [],
    };
    const geometry = new Map(["a", "b", "s"].map((id) => [id, { left: 0, top: 0, width: 320, height: 240 }]));
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const controllers = { current: new Map([["s", controller]]) };
    const props = {
      data: {},
      geometry,
      controllers,
      selection: [],
      editing: false,
      onSelect() {},
      onEdit() {},
      renderNative: NativeFixture,
    };
    const { rerender } = render(<PanelLayer {...props} board={board} active={{}} />);
    const a = screen.getByLabelText("Native input a");
    const b = screen.getByLabelText("Native input b");
    const frame = screen.getByTitle("Native frame a");
    const documentBefore = frame.contentDocument;
    documentBefore.body.textContent = "Embedded state retained";
    fireEvent.change(a, { target: { value: "search retained" } });
    fireEvent.change(b, { target: { value: "calendar retained" } });
    board = moveUnit(board, "a", { x: 0, y: 5, w: 5, h: 4 });
    geometry.set("a", { left: 0, top: 440, width: 400, height: 336 });
    rerender(<PanelLayer {...props} board={board} active={{}} />);
    board = stackBoard(board, ["a", "b"], "s");
    rerender(<PanelLayer {...props} board={board} active={{ s: "a" }} />);
    controller.next({ manual: true });
    rerender(<PanelLayer {...props} board={board} active={{ s: "b" }} />);
    expect(a.closest("section")).toHaveAttribute("inert");
    expect(a.closest("section")).toHaveAttribute("aria-hidden", "true");
    expect(b.closest("section")).not.toHaveAttribute("inert");
    board = unstackBoard(board, "s");
    rerender(<PanelLayer {...props} board={board} active={{}} />);
    expect(screen.getByLabelText("Native input a")).toBe(a);
    expect(screen.getByLabelText("Native input b")).toBe(b);
    expect(a).toHaveValue("search retained");
    expect(b).toHaveValue("calendar retained");
    expect(frame.contentDocument).toBe(documentBefore);
    expect(frame.contentDocument.body).toHaveTextContent("Embedded state retained");
    expect([...frame.closest(".studio-panel-layer").children].map((node) => node.dataset.panelId)).toEqual(["a", "b"]);
    expect([...mounts.values()]).toEqual([1, 1]);
    expect(unmounts.size).toBe(0);
    controller.destroy();
  });
  it("retries failed native boundaries only when configuration changes and preserves healthy mounts", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    let healthyMounts = 0;
    function Fragile() {
      if (broken) throw new Error("fixture unavailable");
      return <span>Recovered native content</span>;
    }
    function Healthy() {
      useEffect(() => {
        healthyMounts += 1;
      }, []);
      return <input aria-label="Healthy native input" />;
    }
    const view = (revision) => (
      <StudioRevisionContext.Provider value={revision}>
        <ErrorBoundary>
          <Healthy />
        </ErrorBoundary>
        <ErrorBoundary>
          <Fragile />
        </ErrorBoundary>
      </StudioRevisionContext.Provider>
    );
    const { rerender } = render(view("initial"));
    const input = screen.getByLabelText("Healthy native input");
    broken = false;
    rerender(view("initial"));
    expect(screen.queryByText("Recovered native content")).toBeNull();
    rerender(view("changed-native-files"));
    expect(screen.getByText("Recovered native content")).toBeInTheDocument();
    expect(screen.getByLabelText("Healthy native input")).toBe(input);
    expect(healthyMounts).toBe(1);
    log.mockRestore();
  });
});
