import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentChecks } from "../RecentChecks";

const inv = (id: string, title: string | null, status: string) =>
  ({ id, status, title, submission: { job_text: "x" }, created_at: "2026-08-19T00:00:00Z" }) as any;

describe("RecentChecks", () => {
  it("labels each check with its worker-derived title", () => {
    render(<RecentChecks items={[inv("a", "Acme", "done"), inv("b", "Globex", "running")]} />);
    expect(screen.getByRole("link", { name: /acme/i })).toHaveAttribute("href", "/investigations/a");
    expect(screen.getByRole("link", { name: /globex/i })).toHaveAttribute("href", "/investigations/b");
  });
  it("falls back to 'Untitled posting' when no title was derived", () => {
    render(<RecentChecks items={[inv("a", null, "done")]} />);
    expect(screen.getByText(/untitled posting/i)).toBeInTheDocument();
  });
  it("shows an empty state", () => {
    render(<RecentChecks items={[]} />);
    expect(screen.getByText(/no checks yet/i)).toBeInTheDocument();
  });
});
