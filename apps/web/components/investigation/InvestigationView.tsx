"use client";

// The single status-driven view behind /investigations/:id (spec §3, §6).
// queued|running -> the live checklist; done|deadline_exceeded -> the
// report; failed -> a concise panel that never surfaces worker internals
// (spec §8) and points the visitor back at /verify to try again.
import { useRouter } from "next/navigation";
import { useInvestigationLive } from "../../lib/investigations-live";
import { toReportViewModel } from "../../lib/report-view-model";
import type { CompleteReportVM, ReportVM } from "../../lib/report-view-model";
import type { Investigation, InvestigationStep } from "../../lib/investigations";
import { MicroLabel } from "../ui/MicroLabel";
import { Button } from "../ui/Button";
import { StepList } from "../progress/StepList";
import { BandBanner } from "../report/BandBanner";
import { ConfidencePanel } from "../report/ConfidencePanel";
import { Summary } from "../report/Summary";
import { FindingGroup } from "../report/FindingGroup";
import { VerifyChecklist } from "../report/VerifyChecklist";
import { ReportFooter } from "../report/ReportFooter";
import { ReportRail } from "../report/ReportRail";
import { Reveal, RevealItem } from "../ui/Reveal";
import { useState } from "react";

// Report/IncompleteReport branch on vm.complete before rendering the band
// components, but that doesn't narrow ReportVM's nullable fields for
// TypeScript across the branch. This asserts the narrowing once, right
// after the guard, instead of `!`-asserting at each call site below.
function asComplete(vm: ReportVM): CompleteReportVM {
  return vm as CompleteReportVM;
}

export interface InvestigationViewProps {
  initial: { investigation: Investigation; steps: InvestigationStep[] };
}

function Checklist({
  investigation,
  steps,
}: {
  investigation: Investigation;
  steps: InvestigationStep[];
}) {
  return (
    <main id="main-content" className="mx-auto max-w-page px-8 py-11">
      <div className="flex flex-col gap-6">
        <MicroLabel aria-live="polite">WORKING THROUGH THE POSTING</MicroLabel>
        <h1 className="m-0 text-[44px] font-bold leading-[0.98] tracking-[-0.035em]">
          WORKING THROUGH
          <br />
          THE POSTING
        </h1>
        <p className="max-w-[600px] text-[16px] leading-[1.6] text-secondary">
          {investigation.submission.company_name ||
            investigation.entities?.company_name ||
            investigation.title ||
            "The company"}{" "}
          · the posting. Steps close as their evidence comes in, not in order.
        </p>
        <StepList steps={steps} />
        <p className="text-[14px] text-muted">
          You can leave this page — the case stays open on your account and we&apos;ll hold the
          report.
        </p>
      </div>
    </main>
  );
}

function FailedPanel({ id }: { id: string }) {
  const router = useRouter();
  return (
    <main id="main-content" className="mx-auto max-w-page px-6 py-16">
      <MicroLabel>CHECK FAILED</MicroLabel>
      <p className="mt-2 max-w-[36rem] text-[16px] leading-[1.6]">
        We couldn&apos;t finish checking this posting. Nothing was lost — try again below.
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={() => router.push("/verify")}>
          Try again
        </Button>
      </div>
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
        CASE {id.replace(/-/g, "").slice(0, 8).toUpperCase()}
      </p>
    </main>
  );
}

// Terminal investigation with no assessment (e.g. deadline_exceeded, spec
// §6 best-effort) — no band was ever computed, so this never fabricates
// one. Still surfaces any partial findings + the verify checklist.
function IncompleteReport({ investigation }: { investigation: Investigation }) {
  const vm = toReportViewModel(investigation);
  return (
    <main id="main-content" className="mx-auto max-w-page px-6 py-16">
      <MicroLabel>COULDN&apos;T COMPLETE THE ASSESSMENT</MicroLabel>
      <p className="mt-2 max-w-[36rem] text-[16px] leading-[1.6]">
        We ran out of time before we could finish weighing this posting, so there&apos;s no
        overall read. Here&apos;s what we did gather — treat it as partial.
      </p>
      <div className="mt-10 flex flex-col gap-10">
        {vm.groups.map((group) => (
          <FindingGroup key={group.key} group={group} />
        ))}
        <VerifyChecklist items={vm.verifyChecklist} />
      </div>
    </main>
  );
}

function Report({ investigation }: { investigation: Investigation }) {
  const vm = toReportViewModel(investigation);
  const [reported, setReported] = useState(false);

  if (!vm.complete) return <IncompleteReport investigation={investigation} />;
  const completeVm = asComplete(vm);

  return (
    <main id="main-content">
      {/* Rare, first-time view (spec §3): the verdict lands on load, then the
          evidence sections rise and cascade in on their own slots — reusing the
          shared screenEnter/stagger presets, so reduced motion drops movement
          for free. Above-the-fold Reveal fires on mount; lower sections key to
          viewport entry. */}
      <Reveal>
        <RevealItem>
          <BandBanner vm={completeVm} confidenceSlot={<ConfidencePanel vm={completeVm} />} />
        </RevealItem>
      </Reveal>
      <div className="mx-auto max-w-page grid grid-cols-1 gap-8 px-6 py-16 md:grid-cols-[1fr_320px]">
        <Reveal className="flex flex-col gap-10">
          <RevealItem>
            <Summary summary={completeVm.summary} />
          </RevealItem>
          {vm.groups.map((group) => (
            <RevealItem key={group.key}>
              <FindingGroup group={group} />
            </RevealItem>
          ))}
          <RevealItem>
            <VerifyChecklist items={vm.verifyChecklist} />
          </RevealItem>
          <RevealItem>
            <ReportFooter vm={vm} />
          </RevealItem>
        </Reveal>
        <ReportRail
          vm={vm}
          investigationId={investigation.id}
          reported={reported}
          onReport={() => setReported(true)}
        />
      </div>
    </main>
  );
}

export function InvestigationView({ initial }: InvestigationViewProps) {
  const { investigation, steps } = useInvestigationLive(initial.investigation.id, initial);
  const status = investigation.status;

  if (status === "queued" || status === "running") {
    return <Checklist investigation={investigation} steps={steps} />;
  }
  if (status === "failed") {
    return <FailedPanel id={investigation.id} />;
  }
  // done | deadline_exceeded -> the report.
  return <Report investigation={investigation} />;
}
