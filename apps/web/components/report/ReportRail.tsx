"use client";

// Sticky report sidebar: the counts strip plus the report-an-issue /
// check-another actions and a reminder of where the report already lives.
// Product rule #7: buttons describe what happens, never "Submit".
//
// There is deliberately no "Save this report" action: the V1 worker persists
// the investigation to the user's account the moment it completes, so a save
// button would be a no-op that contradicts the "SAVED TO <email>" panel right
// below it. There is no "Copy link" either — the report's URL is already in
// the address bar, so a copy button spent the rail's most prominent slot on
// the least useful thing there. The slot now holds the one action a reader of
// a wrong assessment actually needs: telling us it's wrong.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { ReportVM } from "../../lib/report-view-model";
import { useFlow } from "../../lib/flow-context";
import { useMotion } from "../../lib/motion";
import { createClient } from "../../lib/supabase/client";
import { CountsStrip } from "./CountsStrip";
import { Button } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";

export interface ReportRailProps {
  vm: ReportVM;
  // The report's own id — kept so the rail can address this investigation
  // when the issue report is wired to a real endpoint.
  investigationId: string;
  // Lifted to the page so the acknowledgement survives a re-render and so
  // this stays the single report-an-issue control in the report.
  reported: boolean;
  onReport: () => void;
}

export function ReportRail({ vm, investigationId, reported, onReport }: ReportRailProps) {
  const router = useRouter();
  const { reset } = useFlow();
  // authEmail no longer lives in flow state (task-7 trim of
  // lib/flow-context.tsx) — auth is Supabase-session-driven now, same
  // pattern as SiteHeader.
  // `email === null` is ambiguous on its own (still fetching vs. no session),
  // so a separate `loaded` flag drives a reserved-space skeleton instead of a
  // blank line that pops in — no layout shift when the address arrives.
  const [email, setEmail] = useState<string | null>(null);
  const [emailLoaded, setEmailLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) {
          setEmail(data.user?.email ?? null);
          setEmailLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { fade } = useMotion();

  // Seeded from the prop, then flips locally on click so the acknowledgement
  // lands immediately even if the parent doesn't re-render with a new prop.
  const [hasReported, setHasReported] = useState(reported);
  const handleReport = () => {
    setHasReported(true);
    onReport();
  };

  const handleCheckAnother = () => {
    reset();
    router.push("/");
  };

  return (
    <motion.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={fade}
      data-investigation-id={investigationId}
      // self-start is load-bearing, not cosmetic: as a grid item the aside
      // otherwise stretches to the height of the findings column beside it,
      // so its border framed the entire page instead of its own content.
      className="sticky top-[90px] flex flex-col gap-4 self-start"
    >
      {/* Counts + actions share one frame; "saved to" is a sibling card, not
          a nested box — the prototype reads as two stacked panels, and a
          border inside a border muddles that. */}
      <div className="flex flex-col gap-4 border border-ink p-5">
        <CountsStrip vm={vm} />

        <div className="flex flex-col gap-3">
          {/* Primary is the forward action. Reporting a bad assessment is a
              rare corrective step, so it sits beside it as an outline
              button rather than competing for the same weight. */}
          <Button variant="primary" size="wide" onClick={handleCheckAnother}>
            Check another posting
          </Button>
          {hasReported ? (
            <p
              role="status"
              aria-live="polite"
              className="py-2 text-center text-[12px] text-muted"
            >
              Thanks — we&apos;ll look at it
            </p>
          ) : (
            <Button
              variant="secondary"
              size="wide"
              className="!text-[11px] leading-[1.4]"
              onClick={handleReport}
            >
              Report an issue with this assessment
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-none border border-ink-muted p-4">
        <MicroLabel>SAVED TO</MicroLabel>
        {emailLoaded ? (
          // break-all so a long address wraps inside the 320px rail rather
          // than overflowing; fall back to a generic label if the session
          // somehow has no email.
          <p className="mt-2 break-all font-mono text-[12px]">{email ?? "your account"}</p>
        ) : (
          // Reserved-height placeholder — same 14px line box the address will
          // occupy, so nothing jumps when it loads. Pulse only when motion is
          // allowed.
          <div
            aria-hidden="true"
            className="mt-2 h-[14px] w-3/5 bg-surface-soft motion-safe:animate-pulse"
          />
        )}
        <p className="mt-2 text-[12px] leading-[1.5] text-muted">
          Reports stay private to your account. Repeat checks on the same posting are counted, never
          published.
        </p>
      </div>
    </motion.aside>
  );
}
