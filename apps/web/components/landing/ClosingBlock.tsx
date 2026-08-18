"use client";

import { Button } from "../ui/Button";
import { FindingCard } from "../report/FindingCard";
import type { FindingVM } from "../../lib/report-view-model";

// Sample finding transcribed from the prototype (RULING R9):
// Investigator Prototype.dc.html lines 154-162. Proof-of-style only — not
// wired to a real investigation.
const SAMPLE_FINDING: FindingVM = {
  recordId: "F-04",
  direction: "suspicious",
  severity: "critical",
  claim: "The recruiter asked for a training fee payment",
  metaLine: "SUSPICIOUS · SEVERITY CRITICAL · 1 SOURCE",
  provenanceLabel: "Based on the conversation you shared — we can't independently verify it.",
  however: null,
  sources: [
    {
      name: "conversation you shared",
      stampMono: "",
      excerpt: "The recruiter asked for a training fee payment",
      defang: false,
    },
  ],
};

export interface ClosingBlockProps {
  onScan?: () => void;
}

export function ClosingBlock({ onScan }: ClosingBlockProps) {
  return (
    <section className="flex flex-wrap items-start gap-8">
      <div className="flex flex-1 flex-col gap-[14px]" style={{ flexBasis: "480px" }}>
        <h2 className="m-0 text-[34px] font-bold tracking-[-0.03em]">MID-CONVERSATION RIGHT NOW?</h2>
        <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-secondary">
          Paste the chat as text and we&rsquo;ll read it for known pressure and payment patterns. Anything we
          find there is labelled as coming from you — we can&rsquo;t independently verify a conversation, and
          we say so on the finding itself.
        </p>
        <Button variant="primary" size="wide" onClick={onScan} className="self-start">
          CHECK A JOB NOW
        </Button>
      </div>
      <div className="flex-1 border border-ink p-5" style={{ flexBasis: "380px", maxWidth: "380px" }}>
        <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-muted">Sample finding</div>
        <FindingCard finding={SAMPLE_FINDING} />
      </div>
    </section>
  );
}
