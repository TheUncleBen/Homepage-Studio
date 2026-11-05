// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    expect(screen.getByRole("heading", { name: "Keeping the password out of the files" })).toBeInTheDocument();
    expect(screen.getByText("homepage_pfsense_password")).toBeInTheDocument();
    expect(container.querySelector("pre").textContent).toBe(
      "HOMEPAGE_FILE_PFSENSE_PASSWORD: /run/secrets/homepage_pfsense_password",
    );
    expect(screen.getByText("{{HOMEPAGE_FILE_PFSENSE_PASSWORD}}")).toBeInTheDocument();
    expect(screen.getByText(/For a second pfSense/)).toBeInTheDocument();
  });

  it("shows no secret steps for a widget without secrets", () => {
    render(<Guide blocks={[{ type: "p", text: "Hello" }]} />);
    expect(screen.queryByText(/out of the files/)).toBeNull();
  });
});
