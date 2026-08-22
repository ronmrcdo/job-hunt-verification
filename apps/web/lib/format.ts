// Timestamp formatting for report/case stamps.
//
// Timezone determinism: dates/times are always extracted from the UTC
// components of the parsed ISO string (getUTCDate/getUTCMonth/getUTCFullYear/
// getUTCHours/getUTCMinutes), never the local-timezone getters. A naive
// `new Date(iso).getDate()` would shift near midnight in negative-offset
// runner timezones (e.g. "2026-08-18T00:00:00Z" reading back as the 17th),
// which would make output depend on where the tests run. The zone label
// shown to the user ("PDT") is a fixed display string, not derived from the
// runner's local zone — it is cosmetic only, the numeric HH:mm is still the
// UTC time. This keeps output identical across any machine/CI timezone.

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDateParts(iso: string): { day: string; month: string; year: number } {
  const d = new Date(iso);
  return {
    day: pad2(d.getUTCDate()),
    month: pad2(d.getUTCMonth() + 1),
    year: d.getUTCFullYear(),
  };
}

export function formatStamp(iso: string): string {
  const { day, month, year } = utcDateParts(iso);
  return `Retrieved ${day}.${month}.${year}`;
}

export function formatCaseStamp(iso: string, caseId: string): string {
  const { day, month, year } = utcDateParts(iso);
  const d = new Date(iso);
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  return `${day}.${month}.${year} · ${hh}:${mm} PDT · CASE ${caseId}`;
}

// ---------------------------------------------------------------------------
// Landing-page stat formatting (the "So far" rail).
//
// Every helper accepts the nullable value straight off the `public_stats()`
// RPC and renders EM_DASH when it is null, so the rail never has to decide
// what "no data yet" looks like — an empty database and a failed fetch render
// identically, and neither can be mistaken for a real zero-ish number.
// ---------------------------------------------------------------------------

const EM_DASH = "—";

export function formatCount(n: number | null): string {
  if (n === null) return EM_DASH;
  // en-US explicitly, not the runner's locale: the rail's digits must not
  // depend on where the page renders (same determinism rule as the stamps).
  return n.toLocaleString("en-US");
}

export function formatPercent(n: number | null): string {
  return n === null ? EM_DASH : `${n}%`;
}

// The kind of a rail row, so the live "+N" flourish formats a change the same
// way its base value is formatted: counts group, percents carry a %, durations
// reuse formatDuration.
export type StatKind = "count" | "percent" | "duration";

// Signed change label for the rail's live delta flourish. Returns null when
// there is nothing worth flashing — a flat change, a change that rounds away,
// or a count that did not grow (postings only ever climb, so a non-positive
// count delta is noise, never shown). The caller skips rendering on null, so
// most polls flash nothing and only a real move surfaces.
export function formatDelta(delta: number, kind: StatKind): string | null {
  if (kind === "count") {
    if (delta <= 0) return null;
    return `+${delta.toLocaleString("en-US")}`;
  }
  const rounded = Math.round(delta);
  if (rounded === 0) return null;
  const sign = rounded > 0 ? "+" : "-";
  const magnitude = Math.abs(rounded);
  if (kind === "percent") return `${sign}${magnitude}%`;
  return `${sign}${formatDuration(magnitude)}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return EM_DASH;
  const total = Math.round(seconds);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
