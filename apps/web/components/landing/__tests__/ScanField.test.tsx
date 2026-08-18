import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScanField } from "../ScanField";

describe("ScanField", () => {
  it("shows 'Waiting for input' when detection is empty", () => {
    render(<ScanField value="" onChange={vi.fn()} detection="empty" onPasteInstead={vi.fn()} />);
    expect(screen.getByText("Waiting for input")).toBeTruthy();
  });

  it("shows 'Link detected' when detection is link", () => {
    render(
      <ScanField value="https://x.co" onChange={vi.fn()} detection="link" onPasteInstead={vi.fn()} />,
    );
    expect(screen.getByText("Link detected")).toBeTruthy();
  });

  it("shows 'Job text detected' when detection is text", () => {
    render(
      <ScanField value="Assistant role" onChange={vi.fn()} detection="text" onPasteInstead={vi.fn()} />,
    );
    expect(screen.getByText("Job text detected")).toBeTruthy();
  });

  it("renders the labeled textarea and calls onChange on typing", () => {
    const onChange = vi.fn();
    render(<ScanField value="" onChange={onChange} detection="empty" onPasteInstead={vi.fn()} />);

    const field = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" });
    fireEvent.change(field, { target: { value: "a" } });

    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows the prior-check notice when prior is truthy and no fetchError", () => {
    render(
      <ScanField
        value=""
        onChange={vi.fn()}
        detection="empty"
        prior
        onPasteInstead={vi.fn()}
      />,
    );

    expect(screen.getByText("PRIOR CHECK ON FILE")).toBeTruthy();
    expect(
      screen.getByText(
        "This posting was checked 2 days ago — view that report or run a fresh check.",
      ),
    ).toBeTruthy();
  });

  it("hides the prior-check notice and shows the fetch-error panel when fetchError is truthy, even if prior is also true", () => {
    const onPasteInstead = vi.fn();
    render(
      <ScanField
        value=""
        onChange={vi.fn()}
        detection="empty"
        prior
        fetchError
        onPasteInstead={onPasteInstead}
      />,
    );

    expect(screen.getByText("FETCH FAILED")).toBeTruthy();
    expect(screen.queryByText("PRIOR CHECK ON FILE")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "PASTE THE JOB TEXT INSTEAD" }));
    expect(onPasteInstead).toHaveBeenCalledTimes(1);
  });

  it("never wraps a pasted value in an anchor", () => {
    const { container } = render(
      <ScanField
        value="https://example.com"
        onChange={vi.fn()}
        detection="link"
        prior
        fetchError
        onPasteInstead={vi.fn()}
      />,
    );

    expect(container.querySelector("a[href]")).toBeNull();
  });
});
