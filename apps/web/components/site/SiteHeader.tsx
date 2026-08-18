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
    <header className="sticky top-0 z-40 flex h-[66px] items-center border-b border-rule bg-page px-6">
      <div className="flex items-center gap-3">
        <div className="h-[13px] w-[13px] bg-ink" />
        <span className="text-[17px] font-bold tracking-[-0.015em]">Wordmark</span>
      </div>

      <span className="ml-4 border-l border-rule pl-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        JOB LEGITIMACY INVESTIGATOR
      </span>

      <nav className="ml-auto flex items-center gap-6">
        <Link href="/#how-it-works" className="text-[14px]">
          How it works
        </Link>
        <Link href="/#risk-bands" className="text-[14px]">
          Risk bands
        </Link>
        {state.signedIn ? (
          <span className="font-mono text-[13px]">{state.authEmail}</span>
        ) : (
          <Link href="/sign-in" className="text-[14px]">
            Sign in
          </Link>
        )}
        <Button variant="primary" onClick={() => router.push("/")}>
          Check a job
        </Button>
      </nav>
    </header>
  );
}
