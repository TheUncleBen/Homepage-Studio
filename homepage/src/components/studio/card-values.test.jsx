// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CardValues from "./card-values";

import Block from "components/services/widget/block";

vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => key }) }));
// A plain value block: the real one reads dashboard settings.
vi.mock("components/services/widget/block", () => ({
  default: ({ label, value }) => (
    <span>
      {label} {value}
    </span>
  ),
}));

describe("card values", () => {
  it("shows a widget's own content as it is, never folded away", () => {
    const { container } = render(
      <div className="studio-native-content">
        <CardValues
          card={{ id: "embed" }}
          items={[<iframe key="page" title="Embedded page" src="about:blank" />, <p key="note">Own content</p>]}
        />
      </div>,
    );
    expect(screen.getByTitle("Embedded page")).toBeTruthy();
    expect(screen.getByText("Own content")).toBeTruthy();
    // No values to arrange, so nothing hides it or stops it scrolling.
    expect(container.querySelector(".studio-values")).toBeNull();
    expect(container.querySelector("[hidden]")).toBeNull();
  });

  it("still arranges values into a hero and the rest", () => {
    const { container } = render(
      <div className="studio-native-content">
        <CardValues
          card={{ id: "values" }}
          items={[<Block key="a" label="First" value="1" />, <Block key="b" label="Second" value="2" />]}
        />
      </div>,
    );
    expect(container.querySelector(".studio-values-hero")).toBeTruthy();
    expect(container.querySelector(".studio-values-below .studio-fold-item")).toBeTruthy();
  });
});

describe("balanced value boxes (U7)", () => {
  it("spreads boxes evenly over the fewest rows that fit", async () => {
    const { balancedColumns } = await import("./card-values");
    expect(balancedColumns(6, 4)).toBe(3);
    expect(balancedColumns(5, 4)).toBe(3);
    expect(balancedColumns(4, 4)).toBe(4);
    expect(balancedColumns(7, 3)).toBe(3);
    expect(balancedColumns(2, 6)).toBe(2);
    expect(balancedColumns(9, 1)).toBe(1);
  });
  it("keeps a chosen number of columns while the boxes fit", async () => {
    const { balancedColumns } = await import("./card-values");
    expect(balancedColumns(6, 4, "2")).toBe(2);
    expect(balancedColumns(6, 3, "4")).toBe(3);
    expect(balancedColumns(2, 4, "4")).toBe(2);
  });
});
