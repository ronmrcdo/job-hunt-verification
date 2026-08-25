import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyPage from "../privacy/page";
import TermsPage from "../terms/page";
import DisclaimerPage from "../disclaimer/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// SiteHeader reads the session on mount; the global setup mock predates
// getSession, so mirror the landing test's client mock here.
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

describe("/privacy", () => {
  it("renders the privacy policy with collection, third parties, and contact", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: /PRIVACY/i })).toBeInTheDocument();
    // Named third-party processors.
    expect(screen.getAllByText(/Google/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Resend/).length).toBeGreaterThan(0);
    // Rate limiting / IP processing is disclosed.
    expect(screen.getAllByText(/rate.?limit/i).length).toBeGreaterThan(0);
    // Analytics scope: visitor counts, never sold.
    expect(screen.getAllByText(/visitor/i).length).toBeGreaterThan(0);
    // Contact for privacy requests.
    const contact = screen.getAllByRole("link", { name: /contact@ronmrcdo\.dev/ });
    expect(contact.length).toBeGreaterThan(0);
    expect(contact[0]).toHaveAttribute("href", "mailto:contact@ronmrcdo.dev");
  });

  it("states that only the password is hashed — never the email", () => {
    render(<PrivacyPage />);
    // The email is the login identifier and is stored in the clear; the
    // wording must not imply it is hashed alongside the password.
    expect(
      screen.getAllByText((_, node) =>
        (node?.textContent ?? "").includes("only the password is stored as a hash"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("discloses Cloudflare Turnstile as a third-party bot check", () => {
    render(<PrivacyPage />);
    expect(screen.getAllByText(/Cloudflare/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Turnstile/).length).toBeGreaterThan(0);
  });
});

describe("/terms", () => {
  it("renders the disclaimer and terms with the standing not-a-guarantee language", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: /DISCLAIMER|TERMS/i }),
    ).toBeInTheDocument();
    // The core protective sentence: informational, not a determination.
    expect(screen.getAllByText(/not a legal determination/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/background check/i).length).toBeGreaterThan(0);
    // Acceptable use covers automated abuse.
    expect(screen.getAllByText(/rate.?limit/i).length).toBeGreaterThan(0);
    // The recently-added sign-in bot check is named as an enforcement measure.
    expect(screen.getAllByText(/bot check|captcha/i).length).toBeGreaterThan(0);
  });
});

describe("/disclaimer (How we handle your data)", () => {
  it("explains the AI processing pipeline and what we never do", () => {
    render(<DisclaimerPage />);

    expect(screen.getByRole("heading", { level: 1, name: /DATA/i })).toBeInTheDocument();
    // The AI-processing disclosure the page exists for.
    expect(screen.getAllByText(/AI/).length).toBeGreaterThan(0);
    // The never-do commitments.
    expect(screen.getAllByText(/never sell/i).length).toBeGreaterThan(0);
    // Deletion route.
    expect(
      screen.getAllByRole("link", { name: /contact@ronmrcdo\.dev/ }).length,
    ).toBeGreaterThan(0);
  });
});

describe("legal pages share the page chrome", () => {
  it.each([
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
    ["disclaimer", DisclaimerPage],
  ] as const)("/%s has a main landmark and the site footer", (_route, Page) => {
    render(<Page />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
