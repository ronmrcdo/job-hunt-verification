"use client";

// The load-bearing reconciliation screen. Fires the single real (~90s)
// POST while playing a scripted, out-of-order step animation. Navigates on
// to the report only once BOTH the POST has resolved with an id AND the
// script has reached its last step — whichever finishes later — so the
// user never lands on a report page before it exists, and never sits
// staring at a finished script waiting on a slow network.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createInvestigation } from "../../../lib/api";
import { getOwnerKey } from "../../../lib/ownerKey";
import { useFlow } from "../../../lib/flow-context";
import { detectInput } from "../../../lib/detect";
import { useMotion } from "../../../lib/motion";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { MicroLabel } from "../../../components/ui/MicroLabel";
import { StepList } from "../../../components/progress/StepList";
import { EvidenceRail } from "../../../components/progress/EvidenceRail";
import {
  STEPS,
  COMPLETION_ORDER,
} from "../../../components/progress/progress-script";

function makeCaseId(): string {
  const raw = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export default function Page() {
  const router = useRouter();
  const { state, set } = useFlow();
  const { screenEnter, screenEnterVariants } = useMotion();

  const [caseId] = useState(makeCaseId);
  const [doneSteps, setDoneSteps] = useState<number[]>([]);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [scriptDone, setScriptDone] = useState(false);

  // Guards against the effect's cleanup/StrictMode double-invoke firing the
  // POST twice, and against setting state after unmount.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  // Fire the POST exactly once. FlowState hydrates from sessionStorage in
  // FlowProvider's own mount effect, which runs (and can commit) AFTER this
  // one — so this effect is keyed on state.jobInput rather than run once on
  // mount with an empty-deps array: the first run (before hydration lands)
  // is a no-op when jobInput is still empty, and the run right after
  // hydration is the one that actually fires, guarded by startedRef so it
  // never fires twice.
  useEffect(() => {
    if (startedRef.current || !state.jobInput) return;
    startedRef.current = true;

    // V0's API only accepts job_text, company_name, recruiter_email, and
    // job_url — the site/recruiter/convo fields the UI also collects are
    // intentionally dropped here (see lib/api.ts's own note on this).
    const input = {
      jobText: state.jobInput,
      companyName: state.company || undefined,
      recruiterEmail: state.email || undefined,
      jobUrl:
        detectInput(state.jobInput) === "link" ? state.jobInput : undefined,
    };

    createInvestigation(input, getOwnerKey())
      .then(({ id }) => {
        if (!mountedRef.current) return;
        setResolvedId(id);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        set({ fetchError: true });
        router.push("/");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.jobInput, state.company, state.email]);

  // The scripted step timers run independently of the POST/hydration — they
  // start the instant this page mounts.
  useEffect(() => {
    mountedRef.current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Schedule each step's completion at its scripted offset. Progress is
    // ONLY these step rows animating in — no spinner, no percentage.
    for (const step of STEPS) {
      timers.push(
        setTimeout(() => {
          if (!mountedRef.current) return;
          setDoneSteps((current) =>
            current.includes(step.id) ? current : [...current, step.id],
          );
        }, step.completeAt),
      );
    }

    const lastCompleteAt = Math.max(...STEPS.map((s) => s.completeAt));
    timers.push(
      setTimeout(() => {
        if (!mountedRef.current) return;
        setScriptDone(true);
      }, lastCompleteAt),
    );

    return () => {
      mountedRef.current = false;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coordination: route to the report only once both signals are in.
  useEffect(() => {
    if (resolvedId && scriptDone) {
      router.push(`/report/${resolvedId}`);
    }
  }, [resolvedId, scriptDone, router]);

  const skipTheWait = () => {
    setDoneSteps(COMPLETION_ORDER);
    setScriptDone(true);
    if (resolvedId) {
      router.push(`/report/${resolvedId}`);
    }
  };

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-page px-8 py-11">
        {/* Two-column row: title, step list, and leave-page footer share the
          left column so the evidence rail top-aligns with the title, not the
          first step (design handoff progress screen). */}
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex flex-1 basis-[560px] flex-col gap-6">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={screenEnterVariants}
              transition={screenEnter}
              className="flex flex-col gap-3"
            >
              {/* aria-live: the only user-facing text that actually tracks
                progress as steps close — announces the count to AT as it
                updates, since there's no spinner/percentage for it to key off
                of otherwise. */}
              <MicroLabel aria-live="polite">
                CASE {caseId} · {doneSteps.length} of 7 steps closed
              </MicroLabel>
              <h1 className="m-0 text-[44px] font-bold leading-[0.98] tracking-[-0.035em]">
                WORKING THROUGH
                <br />
                THE POSTING
              </h1>
              <p className="max-w-[600px] text-[16px] leading-[1.6] text-secondary">
                {/* jobTitle isn't a flow field yet (see lib/flow-context.tsx) — "the
                  posting" stands in for it, same as elsewhere in V0. */}
                {state.company || "The company"} · the posting. Steps close as
                their evidence comes in, not in order.
              </p>
            </motion.div>

            <StepList doneSteps={doneSteps} />

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-4">
              <p className="text-[14px] text-muted">
                You can leave this page — the case stays open on your account
                and we&apos;ll hold the report.
              </p>
              <button
                type="button"
                onClick={skipTheWait}
                className="rounded-none border border-rule bg-page px-[15px] py-3 text-[11px] uppercase tracking-[0.1em] text-secondary hover:border-ink hover:text-body"
              >
                Skip the wait
              </button>
            </div>
          </div>

          <EvidenceRail />
        </div>
      </main>
    </>
  );
}
