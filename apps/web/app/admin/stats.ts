export interface DashboardStatsInput {
  registeredUsers: number;
  investigationsTotal: number;
  feedbackVerdicts: string[];
  candidateStatuses: string[];
}

export interface DashboardStats {
  registeredUsers: number;
  investigationsTotal: number;
  feedback: { total: number; agree: number; too_high: number; too_low: number };
  candidates: { total: number; promoted: number; exported: number };
}

// Pure grouping so it's unit-tested without a database (mirrors toTriageRows).
// `total` reflects the row count; sub-counts tally only recognized enum values,
// so a future enum value is ignored rather than crashing the page.
export function toDashboardStats(raw: DashboardStatsInput): DashboardStats {
  const feedback = { total: raw.feedbackVerdicts.length, agree: 0, too_high: 0, too_low: 0 };
  for (const v of raw.feedbackVerdicts) {
    if (v === "agree" || v === "too_high" || v === "too_low") feedback[v] += 1;
  }
  const candidates = { total: raw.candidateStatuses.length, promoted: 0, exported: 0 };
  for (const s of raw.candidateStatuses) {
    if (s === "promoted" || s === "exported") candidates[s] += 1;
  }
  return { registeredUsers: raw.registeredUsers, investigationsTotal: raw.investigationsTotal, feedback, candidates };
}
