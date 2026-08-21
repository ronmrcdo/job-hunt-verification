"use client";

// The one presentation behind every error route (404, route-level 5xx, and
// the root global-error boundary). Built from the same parts as the landing
// hero and the sign-in screen so a dead end still reads as this product and
// not as a framework default: off-white canvas, micro-label eyebrow, a tight
// uppercase headline, and a bordered white "status" card on the right — the
// same left-copy / right-card column pair those screens use.
//
// Rendered rarely by definition, so it keeps the shared entrance stagger
// (frequent UI would drop it). The animation is the existing screenEnter
// preset, not a new curve.
import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button, buttonClasses } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";
import { useMotion } from "../../lib/motion";

/** Neutral = nothing broke, the address is just empty. Critical = we failed. */
export type ErrorTone = "neutral" | "critical";

export interface ErrorScreenAction {
  label: string;
  /** Navigation — rendered as a real anchor so it works without client JS. */
  href?: string;
  /** In-page recovery (a boundary `reset`) — rendered as a button. */
  onClick?: () => void;
  variant?: "primary" | "secondary";
}

export interface ErrorScreenDetail {
  label: string;
  value: ReactNode;
}

export interface ErrorScreenProps {
  /** HTTP-ish status, shown as text in the eyebrow and as the card specimen. */
  code: string;
  /** Plain-language meaning, e.g. "PAGE NOT FOUND". */
  status: string;
  /** Newline-separated so it breaks on the same words the hero headlines do. */
  headline: string;
  body: ReactNode;
  details?: ErrorScreenDetail[];
  actions?: ErrorScreenAction[];
  tone?: ErrorTone;
}

// The accent bar beside the specimen numeral — the same 6px rule the sample
// finding uses to key a severity, so an error page borrows an existing signal
// rather than inventing one.
const TONE_ACCENT: Record<ErrorTone, string> = {
  neutral: "var(--color-rule-strong)",
  critical: "var(--color-critical)",
};

export function ErrorScreen({
  code,
  status,
  headline,
  body,
  details = [],
  actions = [],
  tone = "neutral",
}: ErrorScreenProps) {
  const motionPreset = useMotion();

  return (
    <div
      data-testid="error-screen"
      data-tone={tone}
      className="min-h-[calc(100dvh-66px)] bg-surface-alt"
    >
      <motion.main
        id="main-content"
        className="mx-auto grid max-w-page grid-cols-1 items-start gap-10 px-8 py-16 md:grid-cols-[1fr_380px]"
        variants={motionPreset.staggerParent}
        initial="hidden"
        animate="visible"
      >
        <div className="flex flex-col gap-6">
          <motion.div
            variants={motionPreset.screenEnterVariants}
            transition={motionPreset.screenEnterAt(0.04)}
          >
            {/* Code and meaning both spelled out — the tone colour is never
                the only carrier of what went wrong. */}
            <MicroLabel tone={tone === "critical" ? "var(--color-critical)" : undefined}>
              {`ERROR ${code} · ${status}`}
            </MicroLabel>
          </motion.div>

          <motion.h1
            variants={motionPreset.screenEnterVariants}
            transition={motionPreset.screenEnterAt(0.11)}
            className="m-0 whitespace-pre-line text-[48px] font-bold leading-[0.98] tracking-[-0.03em] max-[430px]:text-[30px]"
          >
            {headline}
          </motion.h1>

          <motion.p
            variants={motionPreset.screenEnterVariants}
            transition={motionPreset.screenEnterAt(0.19)}
            className="m-0 max-w-[520px] text-[16px] leading-[1.6] text-secondary"
          >
            {body}
          </motion.p>

          {actions.length > 0 ? (
            <motion.div
              variants={motionPreset.screenEnterVariants}
              transition={motionPreset.screenEnterAt(0.27)}
              className="flex flex-wrap gap-[10px]"
            >
              {actions.map((action) =>
                action.href ? (
                  <Link
                    key={action.label}
                    href={action.href}
                    className={buttonClasses({ variant: action.variant ?? "secondary", size: "wide" })}
                  >
                    {action.label}
                  </Link>
                ) : (
                  <Button
                    key={action.label}
                    variant={action.variant ?? "secondary"}
                    size="wide"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </motion.div>
          ) : null}
        </div>

        {/* Status card — white on the off-white canvas, like the sign-in and
            sample-finding cards. It carries the specimen numeral plus the
            few facts we actually have, in mono: the same "show what we know,
            say what we don't" posture the reports take. */}
        <motion.aside
          aria-label="Status detail"
          variants={motionPreset.screenEnterVariants}
          transition={motionPreset.screenEnterAt(0.36)}
          className="border border-ink bg-page p-5"
        >
          <MicroLabel>STATUS</MicroLabel>
          <div className="mt-3 flex items-start gap-[8px]">
            <div
              aria-hidden="true"
              className="mt-[6px] h-[46px] w-[6px] shrink-0"
              style={{ background: TONE_ACCENT[tone] }}
            />
            <div
              data-testid="error-code"
              className="text-[58px] font-bold leading-[0.9] tracking-[-0.045em]"
            >
              {code}
            </div>
          </div>

          {details.length > 0 ? (
            <dl className="mt-4 flex flex-col gap-3 border-t border-rule pt-4">
              {details.map((detail) => (
                <div key={detail.label} className="flex flex-col gap-1">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                    {detail.label}
                  </dt>
                  <dd className="m-0 break-words font-mono text-[12px] leading-[1.5] text-body">
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </motion.aside>
      </motion.main>
    </div>
  );
}
