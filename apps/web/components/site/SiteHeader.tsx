"use client";

// Sticky header shared across the landing, auth, and details screens.
// Rule #4 (suspicious URLs are never links) doesn't apply here — every
// link is internal site navigation, not attacker-controlled content.
import {
  useEffect,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "../ui/Button";
import { createClient } from "../../lib/supabase/client";
import { useMotion } from "../../lib/motion";

interface Account {
  // What the trigger shows: the person's chosen name (Supabase user_metadata,
  // set at sign-up or by the Google profile), falling back to the email when
  // no name was ever provided.
  name: string;
  email: string | null;
}

// Google and email sign-up both stash a name on user_metadata, under slightly
// different keys — prefer the explicit full_name we set, then Google's `name`,
// then the email so the trigger is never blank.
function resolveAccount(user: {
  email?: string | null;
  user_metadata?: { full_name?: string | null; name?: string | null } | null;
}): Account {
  const meta = user.user_metadata ?? {};
  const name = (meta.full_name || meta.name || user.email || "Account").trim();
  return { name, email: user.email ?? null };
}

export function SiteHeader() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!cancelled) setAccount(user ? resolveAccount(user) : null);
    });
    return () => { cancelled = true; };
  }, []);

  async function onSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setAccount(null);
    router.push("/");
  }

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
        <div className="mx-auto flex h-[66px] max-w-page items-center px-8 max-[430px]:px-5">
          {/* The wordmark is the conventional "back to home" affordance —
              logo mark and name are one link so either half works. */}
          <Link href="/" aria-label="Jobverifai home" className="flex items-center gap-3">
            <div className="h-[13px] w-[13px] bg-ink" />
            <span className="text-[17px] font-bold tracking-[-0.015em]">Jobverifai</span>
          </Link>

          {/* Two zones on the right, split by spacing so the eye reads
              "navigate" then "act" instead of one wall of labels: the in-page
              anchor links, then the auth + CTA action cluster. */}
          <nav className="ml-auto flex items-center gap-8 max-[430px]:gap-4">
            {/* Navigation zone — secondary in-page anchors; collapses out on
                phones (≤md) so the essential auth + CTA affordances fit. */}
            <div className="hidden items-center gap-6 md:flex">
              <Link
                href="/#how-it-works"
                className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink"
              >
                How it works
              </Link>
              <Link
                href="/#risk-bands"
                className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink"
              >
                Risk bands
              </Link>
            </div>

            {/* Actions zone — account affordance + primary CTA, grouped tight
                and set apart from navigation by the parent's larger gap. */}
            <div className="flex items-center gap-4 max-[430px]:gap-3">
              {account ? (
                <AccountMenu account={account} onSignOut={onSignOut} />
              ) : (
                <Link
                  href="/sign-in"
                  className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink"
                >
                  Sign in
                </Link>
              )}
              {/* Override the primary button's mobile full-width rule: inside the
                  header row the CTA must stay compact, not span the bar. */}
              <Button
                variant="primary"
                className="max-[430px]:w-auto!"
                onClick={() => router.push("/verify")}
              >
                Check a job
              </Button>
            </div>
          </nav>
        </div>
      </header>
    </>
  );
}

interface AccountMenuProps {
  account: Account;
  onSignOut: () => Promise<void>;
}

/**
 * The signed-in identity affordance: the display name is the trigger, and
 * sign-out lives one click deeper in an origin-aware popover — keeping a
 * destructive action off the nav bar itself. Mirrors Tooltip's dismissal
 * contract (Escape, or focus leaving the widget), so keyboard and pointer
 * users close it the same way.
 *
 * This is a *disclosure*, not an ARIA menu: the trigger is `aria-expanded`
 * and the panel holds ordinary links/buttons. We deliberately don't use
 * role="menu"/menuitem — that pattern promises arrow-key roving focus and
 * typeahead we don't implement (review Important #2); a disclosure's contract
 * is exactly what we ship (Tab to move, Enter/Space to activate, Escape to
 * close).
 */
function AccountMenu({ account, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Same 150ms ease-out reveal every popover in the app uses; collapses to an
  // instant show under reduced motion for free.
  const { tooltip: transition } = useMotion();

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  // Escape closes; Enter/Space activation is the native <button>'s own job
  // (see Tooltip.tsx for why we don't hand-roll it).
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") setOpen(false);
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await onSignOut();
  }

  return (
    <div className="relative" onBlur={handleBlur}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-1.5 text-[13px] text-secondary transition-[transform,color] duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink active:scale-[0.98]"
      >
        <span className="max-w-[160px] truncate max-[430px]:max-w-[90px]">{account.name}</span>
        {/* Chevron rotates to point up while open — a quiet state cue. */}
        <svg
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
          className="h-[6px] w-[10px] transition-transform duration-150 [transition-timing-function:var(--ease-out)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            aria-label="Account"
            // Anchored to the trigger at the right edge of the bar, so it
            // scales open from its top-right corner, not from center.
            style={{ transformOrigin: "top right" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={transition}
            className="absolute right-0 z-50 mt-2 min-w-[200px] rounded-none border border-ink bg-page"
          >
            {account.email ? (
              <div className="border-b border-rule px-3 py-2">
                <span className="block font-mono text-[11px] text-muted">Signed in as</span>
                <span className="mt-0.5 block truncate font-mono text-[12px] text-body">
                  {account.email}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut || undefined}
              className="block w-full px-3 py-2 text-left text-[12px] uppercase tracking-[0.1em] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
