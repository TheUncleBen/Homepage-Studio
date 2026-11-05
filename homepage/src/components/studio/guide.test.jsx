// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Guide from "./guide";

describe("setup guide", () => {
  it("names the exact Docker secret, variable and reference for each secret setting", () => {
    const secrets = [
      {
        key: "password",
        label: "Password",
        variable: "HOMEPAGE_FILE_PFSENSE_PASSWORD",
        secret: "homepage_pfsense_password",
        reference: "{{HOMEPAGE_FILE_PFSENSE_PASSWORD}}",
      },
    ];
    const { container } = render(<Guide secrets={secrets} name="pfSense" />);
    expect(screen.getByRole("heading", { name: "Keep the password out of the files" })).toBeInTheDocument();
    expect(screen.getByText("homepage_pfsense_password")).toBeInTheDocument();
    expect(
      screen.getByText("HOMEPAGE_FILE_PFSENSE_PASSWORD: /run/secrets/homepage_pfsense_password"),
    ).toBeInTheDocument();
    expect(screen.getByText("{{HOMEPAGE_FILE_PFSENSE_PASSWORD}}")).toBeInTheDocument();
    expect(screen.getByText(/For a second pfSense/)).toBeInTheDocument();
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy secret name homepage_pfsense_password" }));
    expect(writeText).toHaveBeenCalledWith("homepage_pfsense_password");
    expect(container.querySelectorAll(".studio-guide-copy")).toHaveLength(3);
  });

  it("shows no secret steps for a widget without secrets", () => {
    render(<Guide blocks={[{ type: "p", text: "Hello" }]} />);
    expect(screen.queryByText(/out of the files/)).toBeNull();
  });
});
