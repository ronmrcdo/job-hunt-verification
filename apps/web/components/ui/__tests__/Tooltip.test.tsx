import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tooltip } from "../Tooltip";

describe("Tooltip", () => {
  it("has a trigger button with the accessible name from label", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    expect(screen.getByRole("button", { name: "Confidence explanation" })).toBeInTheDocument();
  });

  it("hides the panel initially", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    expect(screen.queryByText("Details here")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confidence explanation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows the panel after click and sets aria-expanded true", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    fireEvent.click(screen.getByRole("button", { name: "Confidence explanation" }));
    expect(screen.getByText("Details here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confidence explanation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows the panel on focus", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    fireEvent.focus(screen.getByRole("button", { name: "Confidence explanation" }));
    expect(screen.getByText("Details here")).toBeInTheDocument();
  });

  it("hides the panel after Escape", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);
    expect(screen.getByText("Details here")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // AnimatePresence's exit removal resolves on a microtask/animation
    // callback even with MotionGlobalConfig.skipAnimations set, so the
    // panel leaves the DOM asynchronously rather than on the same tick.
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });

  it("hides the panel on blur", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);
    expect(screen.getByText("Details here")).toBeInTheDocument();
    fireEvent.blur(trigger);
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });

  it("associates the trigger to the panel via aria-controls/id", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const panel = document.getElementById(controlsId as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent("Details here");
  });
});
