"use client";

// Sticky header shared across the landing, auth, and details screens.
// Rule #4 (suspicious URLs are never links) doesn't apply here — every
// link is internal site navigation, not attacker-controlled content.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { useFlow } from "../../lib/flow-context";

export function SiteHeader() {
  const { state } = useFlow();
  const router = useRouter();

  return (
    <>
      {/* Visually hidden until focused — the first tab stop on every screen
          that renders this header, so keyboard/AT users can bypass the nav
          straight to the page's main content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-none focus:border focus:border-ink focus:bg-page focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to content
      </a>
      {/* Full-width sticky bar (border-bottom spans the viewport) whose inner
          content is constrained to the same page column (max-w-page) as
          <main>, so the nav lines up with the page content (Investigator
          Prototype.dc.html lines 29-30). */}
      <header className="sticky top-0 z-40 border-b border-rule bg-page">
        <div className="mx-auto flex h-[66px] max-w-page items-center px-8">
          <div className="flex items-center gap-3">
            <div className="h-[13px] w-[13px] bg-ink" />
            <span className="text-[17px] font-bold tracking-[-0.015em]">Wordmark</span>
          </div>

          <span className="ml-4 border-l border-rule pl-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            JOB LEGITIMACY INVESTIGATOR
          </span>

          <nav className="ml-auto flex items-center gap-[26px]">
            <Link href="/#how-it-works" className="text-[12px] uppercase tracking-[0.1em] text-secondary">
              How it works
            </Link>
            <Link href="/#risk-bands" className="text-[12px] uppercase tracking-[0.1em] text-secondary">
              Risk bands
            </Link>
            {state.signedIn ? (
              <span className="font-mono text-[13px] text-muted">{state.authEmail}</span>
            ) : (
              <Link href="/sign-in" className="text-[12px] uppercase tracking-[0.1em] text-secondary">
                Sign in
              </Link>
            )}
            <Button variant="primary" onClick={() => router.push("/")}>
              Check a job
            </Button>
          </nav>
        </div>
      </header>
    </>
  );
}
