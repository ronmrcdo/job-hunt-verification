"use client";

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { getInvestigation, type Investigation, type InvestigationStep } from "./investigations";

const TERMINAL = new Set(["done", "failed", "deadline_exceeded"]);
export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

const STEP_RANK: Record<string, number> = {
  pending: 0, running: 1, skipped: 2, failed: 3, done: 3,
};

export function applyStepEvent(
  steps: InvestigationStep[],
  row: InvestigationStep,
): InvestigationStep[] {
  const existing = steps.find((s) => s.step_key === row.step_key);
  // Monotonic: never regress to a lower-rank status for the same step
  // (out-of-order Realtime delivery — review Minor #4).
  if (existing && STEP_RANK[row.status] < STEP_RANK[existing.status]) {
    return steps;
  }
  const next = steps.filter((s) => s.step_key !== row.step_key);
  next.push(row);
  next.sort((a, b) => a.display_order - b.display_order);
  return next;
}

export function applyStatusEvent(inv: Investigation, row: Partial<Investigation>): Investigation {
  return { ...inv, ...row };
}

export function useInvestigationLive(
  id: string,
  initial: { investigation: Investigation; steps: InvestigationStep[] },
) {
  const [investigation, setInvestigation] = useState(initial.investigation);
  const [steps, setSteps] = useState(initial.steps);

  useEffect(() => {
    if (isTerminal(investigation.status)) return;
    const supabase = createClient();

    async function reselect() {
      const fresh = await getInvestigation(supabase, id);
      if (fresh) {
        setInvestigation(fresh.investigation);
        setSteps(fresh.steps);
      }
    }

    const channel = supabase
      .channel(`investigation:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "investigation_steps", filter: `investigation_id=eq.${id}` },
        (payload) => setSteps((prev) => applyStepEvent(prev, payload.new as InvestigationStep)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "investigation_steps", filter: `investigation_id=eq.${id}` },
        (payload) => setSteps((prev) => applyStepEvent(prev, payload.new as InvestigationStep)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "investigations", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Investigation;
          setInvestigation((prev) => applyStatusEvent(prev, row));
          if (isTerminal(row.status)) {
            supabase.removeChannel(channel);
            void reselect();
          }
        },
      )
      .subscribe((status) => {
        // Close the SELECT→subscribe gap: re-read once the channel is live so
        // any step transition during subscription setup is not lost (review Minor #3).
        if (status === "SUBSCRIBED") void reselect();
        // CHANNEL_ERROR / TIMED_OUT → degrade to a one-shot re-SELECT (spec §7.5).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void reselect();
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // Re-run only when the id or terminal-ness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, investigation.status]);

  return { investigation, steps };
}
