"use client";

// Shared page footer — the counterpart to SiteHeader, and the emotional close
// of the page. In this flat, monochrome system there are no gradients or glow
// to lean on, so the feeling comes from the levers the system already owns:
// the ink inversion (the CRITICAL band's `bg-ink text-page`, scaled up to a
// full band), oversized type against small mono labels, a human mission line,
// and a heart that actually beats. It bookends the light page with one
// deliberate dark moment instead of trailing off into a row of small links.
//
// Rule #4 (suspicious URLs are never links) doesn't apply here — every link is
// either internal site navigation or our own site, not attacker-controlled
// content.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reveal, RevealItem } from "../ui/Reveal";
import { Button } from "../ui/Button";

// Legal routes grouped so the eye reads them as one "protect ourselves"
// cluster. Kept data-driven so the column is one source of truth.
const LEGAL_LINKS: { href: string; label: string }[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Disclaimer & terms of use" },
  { href: "/disclaimer", label: "How we handle your data" },
];

/**
 * A link with an underline that wipes in from the left on hover — the one bit
 * of motion on the utility links. It's a transform on a dedicated underline
 * span (scaleX 0→1), so it's GPU-cheap and interruptible, and it reveals from
 * the origin the eye reads toward. On dark, links sit at 70% page-white and
 * come up to full white on hover.
 */
function FooterLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const className =
    "group relative inline-flex w-fit items-center gap-1 text-[14px] text-page/70 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-page";
  const underline = (
    <span
      aria-hidden="true"
      className="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-page transition-transform duration-200 [transition-timing-function:var(--ease-out)] group-hover:scale-x-100"
    />
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
        {/* Arrow nudges out on hover — a small "this leaves the site" cue. */}
        <span
          aria-hidden="true"
          className="transition-transform duration-150 [transition-timing-function:var(--ease-out)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        >
          &#8599;
        </span>
        {underline}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
      {underline}
    </Link>
  );
}

export function SiteFooter() {
  const router = useRouter();
  // Client-computed so the notice never drifts stale. Reveal already makes this
  // a client component, so there's no server/client year to mismatch.
  const year = new Date().getFullYear();

  return (
    <footer className="bg-ink text-page">
      <Reveal className="mx-auto flex max-w-page flex-col gap-14 px-8 pb-12 pt-20 max-[430px]:px-5">
        {/* The moment: mission line + loop-back CTA. This is the emotional
            payoff — why the product exists, said plainly, then a way back in. */}
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
          <RevealItem className="flex max-w-[640px] flex-col gap-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-page/45">
              Before you answer
            </div>
            <h2 className="m-0 text-[40px] font-bold leading-[1.05] tracking-[-0.03em] max-[430px]:text-[28px]">
              No one should lose their savings to a job that was never real.
            </h2>
            <p className="m-0 max-w-[520px] text-[16px] leading-[1.6] text-page/70">
              So we built a second pair of eyes. Paste the link or the message a recruiter sent you —
              we check what can be verified, say plainly what we couldn&rsquo;t reach, and show the
              evidence behind every finding. Free, and we&rsquo;ll never ask you to pay.
            </p>
          </RevealItem>
          <RevealItem>
            <Button
              variant="secondary"
              size="wide"
              onClick={() => router.push("/verify")}
              // The secondary button is designed for the light page (ink border,
              // dark text). On the dark band, invert it by hand: page-white
              // border + text, filling to solid white on hover.
              className="border-page text-page hover:bg-page hover:text-ink"
            >
              Check a job now
            </Button>
          </RevealItem>
        </div>

        {/* A hairline in page-white at low alpha — the system's border-rule
            idiom, translated for the dark band. */}
        <div className="h-px w-full bg-page/12" />

        {/* Utility region: identity + made-with-love on the left, legal cluster
            on the right. */}
        <div className="flex flex-wrap justify-between gap-x-12 gap-y-10">
          <RevealItem className="flex max-w-[420px] flex-1 basis-[320px] flex-col gap-4">
            {/* Wordmark mirrors the header — the 13px square + name — but the
                square is inverted to page-white so it reads on the dark band,
                bookending top and bottom of the page with the same mark. */}
            <div className="flex items-center gap-3">
              <div className="h-[13px] w-[13px] bg-page" />
              <span className="text-[17px] font-bold tracking-[-0.015em]">Jobverifai</span>
            </div>
            <p className="m-0 text-[13px] leading-[1.6] text-page/55">
              Evidence-backed checks for people job-hunting. No scam verdicts, no scores, no payment —
              just what we could verify and what we couldn&rsquo;t.
            </p>
            <p className="m-0 flex items-center gap-1.5 text-[12px] text-page/55">
              <span>Made</span>
              <span
                aria-hidden="true"
                className="inline-block animate-[heartbeat_2.4s_var(--ease-out)_infinite] text-[13px] [transform-origin:center]"
                style={{ color: "var(--color-band-critical)" }}
              >
                &hearts;
              </span>
              <span className="sr-only">with love</span>
              <span>by</span>
              <a
                href="https://ronmrcdo.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-page/80 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-page"
              >
                ronmrcdo.dev
              </a>
            </p>
          </RevealItem>

          <RevealItem className="flex flex-col gap-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-page/45">
              The fine print
            </div>
            <nav aria-label="Legal" className="flex flex-col gap-3">
              {LEGAL_LINKS.map((link) => (
                <FooterLink key={link.href} href={link.href}>
                  {link.label}
                </FooterLink>
              ))}
            </nav>
          </RevealItem>
        </div>

        {/* Bottom strip: copyright + the standing disclaimer that frames every
            report as informational, not advice — the sentence that does the
            "protect ourselves" work on every page. */}
        <RevealItem className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-page/12 pt-6">
          <div className="font-mono text-[11px] text-page/45">&copy; {year} Jobverifai</div>
          <div className="max-w-[560px] text-[11px] leading-[1.5] text-page/45">
            Checks are informational and evidence-based — not a legal determination, background check, or
            guarantee. Always do your own verification before acting.
          </div>
        </RevealItem>
      </Reveal>
    </footer>
  );
}
