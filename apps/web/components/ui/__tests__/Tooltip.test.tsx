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

describe("Tooltip — pointer interaction", () => {
  it("opens on hover", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Confidence explanation" }));
    expect(screen.getByText("Details here")).toBeInTheDocument();
  });

  it("closes when the pointer leaves", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });

  // The regression this suite exists for: a real mouse click fires
  // pointerdown -> focus -> click. When focus opened the panel, the click's
  // toggle closed it again, so the first click looked like a no-op.
  it("stays open through a full pointer click sequence", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(screen.getByText("Details here")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  // Touch has no hover, so tapping a second time must still dismiss it.
  it("dismisses on a second pointer click", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });
});
