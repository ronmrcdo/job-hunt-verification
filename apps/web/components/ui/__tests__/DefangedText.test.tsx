import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DefangedText } from "../DefangedText";

describe("DefangedText", () => {
  it("renders the defanged form of the value as plain text", () => {
    const { container } = render(<DefangedText value="https://acme-globall.com/x" />);
    expect(container.textContent).toContain("hxxps://acme-globall[.]com");
  });

  it("never renders the value as a link", () => {
    const { container } = render(<DefangedText value="https://acme-globall.com/x" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders inside a span", () => {
    const { container } = render(<DefangedText value="https://acme-globall.com/x" />);
    expect(container.querySelector("span")).not.toBeNull();
  });
});
