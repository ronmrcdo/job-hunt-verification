"use client";

// Replaces the old no-op "report an issue" button in ReportRail. A report
// reader's structured verdict on THIS assessment. Advisory only (spec Global
// Constraints): one RLS-scoped INSERT into `feedback` via the browser anon
// client — no new key, no server round-trip. The row is owner-scoped by RLS
// (user_id = auth.uid(), server-forced) and is a "review this" signal, never a
// label. Bounds mirror the DB: note <= 2000 chars, verdict is a fixed enum.
import { useState } from "react";
import type { Finding } from "../../lib/investigations";
import { createClient } from "../../lib/supabase/client";
import { Button } from "../ui/Button";

type Verdict = "agree" | "too_high" | "too_low";

const VERDICT_LABELS: { value: Verdict; label: string }[] = [
  { value: "agree", label: "This looks right" },
  { value: "too_high", label: "Rated too high" },
  { value: "too_low", label: "Rated too low" },
];

export interface VerdictWidgetProps {
  investigationId: string;
  findings: Pick<Finding, "id" | "claim">[];
  // Lifted acknowledgement so it survives a parent re-render, matching the old
  // ReportRail contract.
  reported: boolean;
  onReported: () => void;
}

export function VerdictWidget({ investigationId, findings, reported, onReported }: VerdictWidgetProps) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [wrongFindingId, setWrongFindingId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(reported);

  const showPicker = verdict === "too_high" || verdict === "too_low";

  if (acknowledged) {
    return (
      <p role="status" aria-live="polite" className="py-2 text-center text-[12px] text-muted">
        Thanks — we&apos;ll look at it
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="wide"
        className="!text-[11px] leading-[1.4]"
        onClick={() => setOpen(true)}
      >
        Report an issue with this assessment
      </Button>
    );
  }

  const handleSend = async () => {
    if (!verdict || submitting) return;
    setSubmitting(true);
    const { error } = await createClient()
      .from("feedback")
      .insert({
        investigation_id: investigationId,
        verdict,
        wrong_finding_id: showPicker && wrongFindingId ? wrongFindingId : null,
        note: note.trim() ? note.trim() : null,
      });
    setSubmitting(false);
    if (!error) {
      setAcknowledged(true);
      onReported();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] uppercase tracking-wide text-muted">What&apos;s off?</legend>
        {VERDICT_LABELS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-[12px]">
            <input
              type="radio"
              name="verdict"
              value={value}
              checked={verdict === value}
              onChange={() => setVerdict(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {showPicker && findings.length > 0 && (
        <label className="flex flex-col gap-1 text-[12px]">
          Which finding is wrong? (optional)
          <select
            value={wrongFindingId}
            onChange={(e) => setWrongFindingId(e.target.value)}
            className="border border-rule-soft p-1 text-[12px]"
          >
            <option value="">No specific finding</option>
            {findings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.claim}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-[12px]">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          className="border border-rule-soft p-1 text-[12px]"
        />
      </label>

      <Button variant="primary" size="wide" onClick={handleSend} disabled={!verdict || submitting}>
        Send
      </Button>
    </div>
  );
}
