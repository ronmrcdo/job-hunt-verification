// The three App Router error entry points. These lock in what each route is
// *for* — a missing address (404), a crashed segment (5xx, recoverable in
// place), and a crashed root layout (global-error, which must ship its own
// <html>) — plus the copy contract that we never blame the visitor and always
// hand them a way out.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "../not-found";
import ErrorBoundary from "../error";
import GlobalError from "../global-error";
import ReportNotFound from "../investigations/[id]/not-found";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// SiteHeader reads the session on mount; same local mock the other page
// suites declare (the setup-file default doesn't cover getSession).
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

describe("app/not-found (404)", () => {
  it("names the status in words and in code", () => {
    render(<NotFound />);
    expect(screen.getByText(/ERROR 404 · PAGE NOT FOUND/)).toBeInTheDocument();
  });

  it("offers a way back to the home page", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /GO TO HOME/i })).toHaveAttribute("href", "/");
  });

  it("keeps the site header so the visitor is never stranded without nav", () => {
    render(<NotFound />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});

describe("app/error (5xx)", () => {
  const error = Object.assign(new Error("boom"), { digest: "d1g3st" });

  it("names the status as a server-side failure", () => {
    render(<ErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText(/ERROR 500 ·/)).toBeInTheDocument();
  });

  it("retries in place via the boundary reset", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={error} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /TRY AGAIN/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("surfaces the digest as the support reference", () => {
    render(<ErrorBoundary error={error} reset={vi.fn()} />);
    expect(screen.getByText("d1g3st")).toBeInTheDocument();
  });

  it("omits the reference row entirely when there is no digest", () => {
    render(<ErrorBoundary error={new Error("boom")} reset={vi.fn()} />);
    expect(screen.queryByText("REFERENCE")).not.toBeInTheDocument();
  });
});

describe("app/global-error", () => {
  // Asserted against the server-rendered string, not a jsdom container:
  // mounting <html> inside a container <div> is what the browser refuses to
  // do, and it's the served markup that has to carry the shell anyway.
  it("ships its own document shell, since the root layout is what failed", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("boom")} reset={vi.fn()} />);
    expect(html.startsWith("<html")).toBe(true);
    expect(html).toContain("<body");
  });

  it("still offers a retry", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /TRY AGAIN/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

// RLS scopes the report SELECT to its owner, so a missing report and someone
// else's report are indistinguishable here by design. The copy has to hold
// that line: never confirm a report exists for an account that can't open it.
describe("app/investigations/[id]/not-found", () => {
  it("uses the shared error presentation", () => {
    render(<ReportNotFound />);
    expect(screen.getByTestId("error-screen")).toBeInTheDocument();
    expect(screen.getByText(/ERROR 404 · REPORT NOT FOUND/)).toBeInTheDocument();
  });

  it("does not reveal whether the report exists", () => {
    render(<ReportNotFound />);
    expect(screen.getByRole("main")).toHaveTextContent(/no report exists at this address, or it belongs to another account/i);
  });

  it("routes onward to the visitor's own checks", () => {
    render(<ReportNotFound />);
    expect(screen.getByRole("link", { name: /YOUR RECENT CHECKS/i })).toHaveAttribute("href", "/verify");
  });
});
