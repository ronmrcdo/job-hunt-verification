"use client";

// The landing rail's running totals. The numbers are all-time ("So far"),
// not a 7-day window: on a young product a real weekly figure reads as
// "2 postings checked", which is a worse front door than an honest
// cumulative count. Read through `public_stats()` — an anon-executable
// aggregate RPC — because RLS scopes `investigations` to its owner and an
// unauthenticated visitor can see none of them directly.
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { publicStats, type PublicStats } from "../../lib/investigations";
import { formatCount, formatPercent, formatDuration } from "../../lib/format";

// Pre-fetch state is all-nulls, which the formatters render as em dashes.
// The rail therefore never shows a number it has not actually read — no
// placeholder digits that a visitor could mistake for a real total.
const PENDING: PublicStats = {
  postingsChecked: null,
  findingsWithSourcesPct: null,
  medianSeconds: null,
};

export function ThisWeekRail() {
  const [stats, setStats] = useState<PublicStats>(PENDING);

  useEffect(() => {
    let cancelled = false;
    publicStats(createClient())
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      // publicStats already folds an RPC error into all-nulls; this catches
      // the client failing to construct at all. Either way the rail keeps
      // its dashes instead of breaking the page.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = [
    { label: "Postings checked", value: formatCount(stats.postingsChecked) },
    { label: "Findings with sources attached", value: formatPercent(stats.findingsWithSourcesPct) },
    { label: "Median time to a report", value: formatDuration(stats.medianSeconds) },
  ];

  return (
    <aside className="flex flex-col gap-[26px]">
      <div className="flex flex-col gap-[14px]">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">So far</div>
        <div className="flex flex-col">
          {rows.map((stat) => (
            <div
              key={stat.label}
              className="flex items-baseline justify-between gap-3 border-t border-rule py-[14px] last:border-b"
            >
              <span className="text-[14px] text-ink">{stat.label}</span>
              <span className="font-mono text-[16px]">{stat.value}</span>
            </div>
          ))}
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
