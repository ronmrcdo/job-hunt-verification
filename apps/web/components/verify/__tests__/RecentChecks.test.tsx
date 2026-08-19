import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentChecks } from "../RecentChecks";

const inv = (id: string, company: string, status: string) =>
  ({ id, status, submission: { job_text: "x", company_name: company }, created_at: "2026-08-19T00:00:00Z" }) as any;

describe("RecentChecks", () => {
  it("renders a link per investigation", () => {
    render(<RecentChecks items={[inv("a", "Acme", "done"), inv("b", "Globex", "running")]} />);
    expect(screen.getByRole("link", { name: /acme/i })).toHaveAttribute("href", "/investigations/a");
    expect(screen.getByRole("link", { name: /globex/i })).toHaveAttribute("href", "/investigations/b");
  });
  it("shows an empty state", () => {
    render(<RecentChecks items={[]} />);
    expect(screen.getByText(/no checks yet/i)).toBeInTheDocument();
  });
});
