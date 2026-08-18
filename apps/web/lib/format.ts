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
