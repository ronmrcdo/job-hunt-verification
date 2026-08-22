"use client";

// The landing rail's running totals. The numbers are all-time ("So far"),
// not a 7-day window: on a young product a real weekly figure reads as
// "2 postings checked", which is a worse front door than an honest
// cumulative count. Read through `public_stats()` — an anon-executable
// aggregate RPC — because RLS scopes `investigations` to its owner and an
// unauthenticated visitor can see none of them directly.
//
// The rail also polls while the page is open so it reads as *live*: when a
// number climbs between polls we flash a signed "+N" beside it (and pulse a
// check by the eyebrow when a new posting lands). The very first fetch never
// flashes — there is no prior value to have moved from — so the flourish only
// ever marks a real, watched-in-real-time change, not a page load.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { publicStats, type PublicStats } from "../../lib/investigations";
import {
  formatCount,
  formatPercent,
  formatDuration,
  formatDelta,
  type StatKind,
} from "../../lib/format";

// Pre-fetch state is all-nulls, which the formatters render as em dashes.
// The rail therefore never shows a number it has not actually read — no
// placeholder digits that a visitor could mistake for a real total.
const PENDING: PublicStats = {
  postingsChecked: null,
  findingsWithSourcesPct: null,
  medianSeconds: null,
};

// How often to re-read the aggregate while the tab is visible. Long enough
// that the anon RPC stays cheap, short enough that a "+1" feels tied to the
// activity a visitor is watching. Polling is skipped entirely while the tab
// is hidden (see the effect) so a backgrounded page costs nothing.
const POLL_MS = 20_000;

type Row = {
  key: keyof PublicStats;
  label: string;
  kind: StatKind;
  value: string;
};

function rowsFrom(stats: PublicStats): Row[] {
  return [
    {
      key: "postingsChecked",
      label: "Postings checked",
      kind: "count",
      value: formatCount(stats.postingsChecked),
    },
    {
      key: "findingsWithSourcesPct",
      label: "Findings with sources attached",
      kind: "percent",
      value: formatPercent(stats.findingsWithSourcesPct),
    },
    {
      key: "medianSeconds",
      label: "Median time to a report",
      kind: "duration",
      value: formatDuration(stats.medianSeconds),
    },
  ];
}

// A live delta to flash on one row. `nonce` changes on every fire so React
// remounts the badge and the CSS animation replays from the start even when
// the same "+1" lands twice in a row.
type Pulse = { text: string; nonce: number };

export function ThisWeekRail() {
  const [stats, setStats] = useState<PublicStats>(PENDING);
  const [pulses, setPulses] = useState<Partial<Record<keyof PublicStats, Pulse>>>({});
  // Bumped when a new posting lands, to replay the eyebrow check pulse.
  const [checkNonce, setCheckNonce] = useState(0);
  // Last stats we have seen. Null until the first fetch resolves — the guard
  // that keeps the first load from flashing.
  const prevRef = useRef<PublicStats | null>(null);
  const nonceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const client = createClient();

    async function tick() {
      // Never spend an RPC on a backgrounded tab; the next visible tick catches up.
      if (typeof document !== "undefined" && document.hidden) return;
      let next: PublicStats;
      try {
        next = await publicStats(client);
      } catch {
        // publicStats already folds an RPC error into all-nulls; this catches
        // the client failing outright. Either way we keep the last good values.
        return;
      }
      if (cancelled) return;

      const prev = prevRef.current;
      if (prev) {
        const fired: Partial<Record<keyof PublicStats, Pulse>> = {};
        for (const { key, kind } of rowsFrom(next)) {
          const before = prev[key];
          const after = next[key];
          // Only diff when both ends are real numbers — a value arriving from
          // or lapsing into "no data yet" (null) is not a change to celebrate.
          if (before === null || after === null) continue;
          const text = formatDelta(after - before, kind);
          if (text) fired[key] = { text, nonce: (nonceRef.current += 1) };
        }
        if (Object.keys(fired).length) setPulses((p) => ({ ...p, ...fired }));
        // The check by the eyebrow marks new *activity* specifically — a
        // posting getting checked — not any stat drifting.
        if (
          prev.postingsChecked !== null &&
          next.postingsChecked !== null &&
          next.postingsChecked > prev.postingsChecked
        ) {
          setCheckNonce((n) => n + 1);
        }
      }

      prevRef.current = next;
      setStats(next);
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const rows = rowsFrom(stats);

  return (
    <aside className="flex flex-col gap-[26px]">
      <div className="flex flex-col gap-[14px]">
        <div className="flex items-center gap-[6px]">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">So far</span>
          {checkNonce > 0 && (
            <span
              key={checkNonce}
              aria-hidden="true"
              className="font-mono text-[11px] leading-none text-legit animate-[rail-check_900ms_var(--ease-out)_forwards]"
            >
              ✓
            </span>
          )}
        </div>
        <div className="flex flex-col">
          {rows.map((stat) => {
            const pulse = pulses[stat.key];
            return (
              <div
                key={stat.label}
                className="flex items-baseline justify-between gap-3 border-t border-rule py-[14px] last:border-b"
              >
                <span className="text-[14px] text-ink">{stat.label}</span>
                <span className="relative flex items-baseline font-mono text-[16px]">
                  {stat.value}
                  {pulse && (
                    <span
                      key={pulse.nonce}
                      aria-hidden="true"
                      onAnimationEnd={() =>
                        setPulses((p) => {
                          const rest = { ...p };
                          delete rest[stat.key];
                          return rest;
                        })
                      }
                      className="pointer-events-none absolute left-full ml-[6px] top-0 whitespace-nowrap text-[11px] text-muted animate-[rail-delta_1200ms_var(--ease-out)_forwards]"
                    >
                      {pulse.text}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-[9px] rounded-none border border-ink p-[18px]">
        <div className="text-[10px] uppercase tracking-[0.16em] text-ink">What we won&rsquo;t do</div>
        <div className="text-[14px] leading-[1.6] text-ink">
          We never stamp a posting a scam, never give it a score out of a hundred, and never link to a domain
          under investigation. You get a band, our confidence in it, and the evidence.
        </div>
      </div>
    </aside>
  );
}
