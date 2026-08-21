// The shared error presentation (404 / 5xx). Locks in the contracts the
// error routes depend on: the eyebrow carries the status code as text (not
// colour alone), actions render as real anchors when they navigate, the
// diagnostic rows are readable, and the tone drives the accent.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorScreen } from "../ErrorScreen";

describe("ErrorScreen", () => {
  it("states the status code and meaning as text in the eyebrow", () => {
    render(
      <ErrorScreen code="404" status="PAGE NOT FOUND" headline={"NOTHING LIVES\nAT THAT ADDRESS"} body="We couldn't find that page." />,
    );
    expect(screen.getByText(/ERROR 404 · PAGE NOT FOUND/)).toBeInTheDocument();
  });

  it("renders the headline as the page's h1 with line breaks preserved", () => {
    render(<ErrorScreen code="404" status="PAGE NOT FOUND" headline={"NOTHING LIVES\nAT THAT ADDRESS"} body="x" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("NOTHING LIVES");
    expect(heading).toHaveTextContent("AT THAT ADDRESS");
  });

  it("renders a navigating action as a real anchor, not a button", () => {
    render(
      <ErrorScreen
        code="404"
        status="PAGE NOT FOUND"
        headline="X"
        body="x"
        actions={[{ label: "GO TO HOME", href: "/" }]}
      />,
    );
    const link = screen.getByRole("link", { name: "GO TO HOME" });
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders an onClick action as a button and invokes it", () => {
    const onClick = vi.fn();
    render(
      <ErrorScreen code="500" status="X" headline="X" body="x" actions={[{ label: "TRY AGAIN", onClick }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows each diagnostic row as a label/value pair", () => {
    render(
      <ErrorScreen
        code="500"
        status="X"
        headline="X"
        body="x"
        details={[{ label: "REFERENCE", value: "abc123" }]}
      />,
    );
    expect(screen.getByText("REFERENCE")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("defaults to the neutral tone and exposes the critical tone as data", () => {
    const { rerender } = render(<ErrorScreen code="404" status="X" headline="X" body="x" />);
    expect(screen.getByTestId("error-screen")).toHaveAttribute("data-tone", "neutral");
    rerender(<ErrorScreen code="500" status="X" headline="X" body="x" tone="critical" />);
    expect(screen.getByTestId("error-screen")).toHaveAttribute("data-tone", "critical");
  });

  it("repeats the code as the status card's specimen numeral", () => {
    render(<ErrorScreen code="404" status="X" headline="X" body="x" />);
    expect(screen.getByTestId("error-code")).toHaveTextContent("404");
  });
});
