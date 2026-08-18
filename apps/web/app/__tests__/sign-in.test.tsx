import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "../sign-in/page";
import { FlowProvider } from "../../lib/flow-context";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const STORAGE_KEY = "jhv_flow";

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
});

describe("Sign-in page", () => {
  it("shows the queued posting (jobInput) and its detection label from flow state", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ jobInput: "Assistant role, remote, flexible hours" }),
    );

    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    expect(await screen.findByText("Assistant role, remote, flexible hours")).toBeTruthy();
    expect(screen.getByText(/Job text detected/)).toBeTruthy();
  });

  it("renders the STEP 2 OF 3 micro label and the H1", async () => {
    render(
      <FlowProvider>
        <Page />
      </FlowProvider>,
    );

    expect(await screen.findByText(/STEP 2 OF 3/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: /SIGN IN TO RUN\s*THIS CHECK/ })).toBeTruthy();
  });
});
