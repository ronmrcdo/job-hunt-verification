"use client";

import { Button } from "../ui/Button";
import { Reveal, RevealItem } from "../ui/Reveal";

// Sample finding transcribed from the prototype (RULING R9):
// Investigator Prototype.dc.html lines 154-162. Proof-of-style only — this is a
// static presentation, deliberately NOT the interactive FindingCard: the
// prototype's sample omits the record id, the expand affordance, the source
// count, and the critical tint. Reusing FindingCard here dragged all of that
// chrome onto the landing page and broke the match.
const SAMPLE = {
  claim: "The recruiter asked for a training fee payment",
  metaLine: "SUSPICIOUS · SEVERITY CRITICAL",
  provenanceLabel: "Based on the conversation you shared — we can't independently verify it.",
};

export interface ClosingBlockProps {
  onScan?: () => void;
}

export function ClosingBlock({ onScan }: ClosingBlockProps) {
  return (
    <section>
      <Reveal className="mx-auto flex max-w-page flex-wrap items-start gap-8 px-8 pb-[60px] pt-12 max-[430px]:px-5">
        <RevealItem className="flex flex-1 basis-[480px] flex-col gap-[14px]">
          <h2 className="m-0 text-[34px] font-bold tracking-[-0.03em] break-words max-[430px]:text-[24px]">MID-CONVERSATION RIGHT NOW?</h2>
          <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-secondary">
            Paste the chat as text and we&rsquo;ll read it for known pressure and payment patterns. Anything we
            find there is labelled as coming from you — we can&rsquo;t independently verify a conversation, and
            we say so on the finding itself.
          </p>
          <Button variant="primary" size="wide" onClick={onScan} className="self-start">
            CHECK A JOB NOW
          </Button>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted">
            <span className="font-semibold text-ink">FREE</span>
            <span className="px-[6px] text-rule-strong">·</span>
            No payment required
          </div>
        </RevealItem>
        <RevealItem className="flex-1 basis-[380px] border border-ink p-5 max-w-[380px]">
          <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-muted">Sample finding</div>
          <div className="flex items-start gap-[8px]">
            <div
              className="mt-[2px] h-5 w-[6px] shrink-0 rounded-none"
              style={{ background: "var(--color-critical)" }}
            />
            <div className="text-[18px] font-bold leading-[1.3]">{SAMPLE.claim}</div>
          </div>
          <div className="mt-1 pl-[14px] text-[11px] uppercase tracking-[0.1em] text-muted">{SAMPLE.metaLine}</div>
          <div className="mt-3 rounded-none border border-rule bg-page p-2 text-[12px] leading-[1.5]">
            {SAMPLE.provenanceLabel}
          </div>
        </RevealItem>
      </Reveal>
    </section>
  );
}
