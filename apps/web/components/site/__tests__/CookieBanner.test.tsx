import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CookieBanner, CONSENT_STORAGE_KEY } from "../CookieBanner";

describe("CookieBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the banner when no consent choice is stored", () => {
    render(<CookieBanner />);
    expect(screen.getByRole("button", { name: /allow analytics/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /essential only/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
  });

  it("persists an analytics opt-in and hides itself", () => {
    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: /allow analytics/i }));

    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? "null");
    expect(stored?.analytics).toBe(true);
    expect(screen.queryByRole("button", { name: /allow analytics/i })).not.toBeInTheDocument();
  });

  it("persists an essential-only choice and hides itself", () => {
    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: /essential only/i }));

    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? "null");
    expect(stored?.analytics).toBe(false);
    expect(screen.queryByRole("button", { name: /essential only/i })).not.toBeInTheDocument();
  });

  it("does not reappear when a choice is already stored", () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ analytics: false, decidedAt: "2026-08-22" }),
    );
    render(<CookieBanner />);
    expect(screen.queryByRole("button", { name: /essential only/i })).not.toBeInTheDocument();
  });
});
