import { Suspense } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import Page from "../[id]/page";
import { FlowProvider } from "../../../lib/flow-context";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../lib/api", () => ({
  fetchInvestigation: vi.fn(() => Promise.resolve(SAMPLE_HIGH.inv)),
}));

vi.mock("../../../lib/ownerKey", () => ({
  getOwnerKey: () => "test-owner-key",
}));

async function renderPage() {
  // `use(params)` suspends on the first render (the params Promise is
  // synchronously pending) — Next's app router provides an implicit Suspense
  // boundary around a page in production; tests must supply one explicitly,
  // and the render itself must be wrapped in an async `act` so React's
  // Suspense-retry (which fires once the params promise settles) is flushed
  // deterministically instead of racing the test.
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <FlowProvider>
        <Suspense fallback={null}>
          <Page params={Promise.resolve({ id: SAMPLE_HIGH.inv.id })} />
        </Suspense>
      </FlowProvider>,
    );
  });
  return result;
}

describe("/report/[id] page", () => {
  it("fetches the investigation and renders the assembled report", async () => {
    await renderPage();

    expect(await screen.findByText("HIGH RISK")).toBeTruthy();
    expect(screen.getByText("What checks out")).toBeTruthy();
    expect(screen.getByText("What looks suspicious")).toBeTruthy();
    expect(screen.getByText("What we couldn't verify")).toBeTruthy();
    expect(
      screen.getByText("Based on the conversation you shared — we can't independently verify it."),
    ).toBeTruthy();
    expect(screen.getByText("FOUR CHECKS THAT WOULD SETTLE THIS")).toBeTruthy();
  });

  it("renders zero <a href> anywhere in the document", async () => {
    const { container } = await renderPage();

    await screen.findByText("HIGH RISK");

    expect(container.querySelector("a[href]")).toBeNull();
  });
});
