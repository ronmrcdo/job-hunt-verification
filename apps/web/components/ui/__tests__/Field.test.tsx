import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextField } from "../TextField";
import { TextArea } from "../TextArea";

describe("TextField", () => {
  it("exposes an input with the label as its accessible name", () => {
    render(<TextField label="Job link or job text" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Job link or job text" })).toBeInTheDocument();
  });

  it("calls onChange with the typed value", () => {
    const onChange = vi.fn();
    render(<TextField label="Job link or job text" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Job link or job text" });
    fireEvent.change(input, { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalledWith("hi");
  });

  it("renders rightSlot content in the label row", () => {
    render(
      <TextField
        label="Job link or job text"
        value=""
        onChange={() => {}}
        rightSlot={<span>Detecting…</span>}
      />
    );
    expect(screen.getByText("Detecting…")).toBeInTheDocument();
  });
});

describe("TextArea", () => {
  it("renders a textbox with the label as its accessible name", () => {
    render(<TextArea label="Job posting text" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Job posting text" })).toBeInTheDocument();
  });

  it("calls onChange with the typed value", () => {
    const onChange = vi.fn();
    render(<TextArea label="Job posting text" value="" onChange={onChange} />);
    const textarea = screen.getByRole("textbox", { name: "Job posting text" });
    fireEvent.change(textarea, { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("renders rightSlot content in the label row", () => {
    render(
      <TextArea
        label="Job posting text"
        value=""
        onChange={() => {}}
        rightSlot={<span>0 / 5000</span>}
      />
    );
    expect(screen.getByText("0 / 5000")).toBeInTheDocument();
  });
});
