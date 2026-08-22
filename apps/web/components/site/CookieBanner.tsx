"use client";

// Cookie consent, in the footer's dark-band idiom: an ink bar pinned to the
// bottom until the visitor decides. Essential cookies (auth session) don't
// need consent; the only thing the choice gates is the self-hosted
// visitor-count analytics, so the copy says exactly that instead of the usual
// wall of vendor text. The decision lives in localStorage — analytics reads
// it before ever loading, and a stored choice means the banner never mounts
// visible again.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../ui/Button";

export const CONSENT_STORAGE_KEY = "jv-cookie-consent";

export interface CookieConsent {
  analytics: boolean;
  decidedAt: string;
}

/** Read the stored choice; null means the visitor hasn't decided yet. */
export function readConsent(): CookieConsent | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CookieConsent) : null;
  } catch {
    return null;
  }
}

export function CookieBanner() {
  // Hidden until the effect confirms no stored choice — the server renders
  // nothing, so there's no hydration mismatch and no flash for returning
  // visitors.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (readConsent() === null) setOpen(true);
  }, []);

  const decide = (analytics: boolean) => {
    try {
      window.localStorage.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({ analytics, decidedAt: new Date().toISOString() } satisfies CookieConsent),
      );
    } catch {
      // Storage unavailable (private mode): honour the choice for this page
      // view anyway — the banner closes and analytics stays off by default.
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 bg-ink text-page"
    >
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-10 gap-y-4 px-8 py-5 max-[430px]:px-5">
        <p className="m-0 max-w-[560px] text-[13px] leading-[1.6] text-page/70">
          We only set what the product needs: a sign-in cookie that keeps your session, and — if
          you allow it — a self-hosted visitor count. No ad tracking, nothing sold.{" "}
          <Link
            href="/privacy"
            className="font-semibold text-page/90 underline decoration-page/40 underline-offset-2 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-page"
          >
            Privacy policy
          </Link>
        </p>
        {/* Both choices get the footer's dark-band button idiom (page-white
            outline, filling to white on hover) — deliberately equal
            prominence, since "decline" must be as easy as "accept". A filled
            primary here would also fight Button's `text-page` with a
            conflicting `text-ink` override (stylesheet order wins, not class
            order), which is exactly the white-on-white bug this replaces. */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => decide(false)}
            className="border-page/60 text-page hover:bg-page hover:text-ink"
          >
            Essential only
          </Button>
          <Button
            variant="secondary"
            onClick={() => decide(true)}
            className="border-page text-page hover:bg-page hover:text-ink"
          >
            Allow analytics
          </Button>
        </div>
      </div>
    </aside>
  );
}
