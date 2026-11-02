// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CardError from "./card-error";

vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => key }) }));

describe("card states", () => {
  it("says a new widget is not set up yet and opens its settings", () => {
    const onFix = vi.fn();
    render(
      <CardError
        card={{ id: "w", onFix }}
        service={{ name: "NAS" }}
        error={{ message: "This widget has no service address yet.", code: "WIDGET_NOT_SET_UP" }}
      />,
    );
    expect(screen.getByText("Not set up yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open setup" }));
    expect(onFix).toHaveBeenCalled();
  });

  it("keeps saying what failed for other errors", () => {
    render(<CardError card={{ id: "w" }} service={{ name: "NAS" }} error={{ message: "HTTP 401" }} />);
    expect(screen.getByText("Can’t reach NAS")).toBeTruthy();
    expect(screen.getByText("401 · the API key or password was refused")).toBeTruthy();
  });
});
