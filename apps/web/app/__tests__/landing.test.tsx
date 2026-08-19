import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Page from "../page";
import { FlowProvider } from "../../lib/flow-context";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
});

describe("Landing page", () => {
  it("renders the hero headline", () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /CHECK A JOB\s*BEFORE YOU\s*ANSWER/ })).toBeTruthy();
  });

  it("fills the scan field with the sample posting and flips detection to text on 'TRY THE SAMPLE CASE'", () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "TRY THE SAMPLE CASE" }));

    const field = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" }) as HTMLTextAreaElement;
    expect(field.value.length).toBeGreaterThan(0);
    expect(screen.getByText("Job text detected")).toBeTruthy();
  });

  it("routes to /sign-in when signed-out and START INVESTIGATION is clicked after entering input", () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    const field = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" });
    fireEvent.change(field, { target: { value: "https://example.com/job" } });

    fireEvent.click(screen.getByRole("button", { name: "START INVESTIGATION" }));

    expect(push).toHaveBeenCalledWith("/sign-in");
  });

  it("shows the prior-check notice when the field contains the known prior-check domain", () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    const field = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" });
    fireEvent.change(field, { target: { value: "https://jobs-hire-portal.co/listing/1" } });

    expect(screen.getByText("PRIOR CHECK ON FILE")).toBeTruthy();
  });

  it("shows the signed-out gate line", () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    expect(
      screen.getByText(
        "You’ll be asked to sign in before the check runs, so the report stays private to you.",
      ),
    ).toBeTruthy();
  });
});
