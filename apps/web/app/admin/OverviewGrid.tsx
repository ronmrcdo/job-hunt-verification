import type { DashboardStats } from "./stats";

// Hairline datasheet grid: gap-px over a rule-colored bg paints continuous 1px
// seams between cards (no shadows, no radius — handoff tokens). Modeled as a
// <dl>: each metric is a <dt> label described by a <dd> value.
export function OverviewGrid({ stats }: { stats: DashboardStats }) {
  const n = (v: number) => v.toLocaleString();
  return (
    <dl className="grid grid-cols-1 gap-px border border-rule-soft bg-rule-soft sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Registered users" value={n(stats.registeredUsers)} />
      <Card label="Investigations" value={n(stats.investigationsTotal)} />
      <Card
        label="Feedback"
        value={n(stats.feedback.total)}
        sub={`agree ${stats.feedback.agree} · too_high ${stats.feedback.too_high} · too_low ${stats.feedback.too_low}`}
      />
      <Card
        label="Eval candidates"
        value={n(stats.candidates.total)}
        sub={`promoted ${stats.candidates.promoted} · exported ${stats.candidates.exported}`}
      />
    </dl>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-h-[132px] bg-page p-6">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-3 font-mono text-[40px] leading-none tabular-nums text-ink">{value}</dd>
      {sub && <dd className="mt-3 font-mono text-[12px] text-muted">{sub}</dd>}
    </div>
  );
}
