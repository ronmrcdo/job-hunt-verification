import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "../SiteHeader";
import { FlowProvider } from "../../../lib/flow-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("SiteHeader", () => {
  it("signed-out: shows Sign in link and Check a job button", () => {
    render(
      <FlowProvider>
        <SiteHeader />
      </FlowProvider>,
    );

    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check a job" })).toBeTruthy();
  });

  it("signed-in: shows the auth email in place of Sign in, Check a job still present", async () => {
    window.sessionStorage.setItem(
      "jhv_flow",
      JSON.stringify({ signedIn: true, authEmail: "a@b.co" }),
    );

    render(
      <FlowProvider>
        <SiteHeader />
      </FlowProvider>,
    );

    // FlowProvider hydrates persisted state from sessionStorage in an
    // effect after mount, so the signed-in UI appears asynchronously.
    expect(await screen.findByText("a@b.co")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check a job" })).toBeTruthy();
  });
});
