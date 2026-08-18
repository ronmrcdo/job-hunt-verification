const STATS: { label: string; value: string }[] = [
  { label: "Postings checked", value: "4,118" },
  { label: "Findings with sources attached", value: "96%" },
  { label: "Median time to a report", value: "1m 40s" },
];

export function ThisWeekRail() {
  return (
    <aside className="flex flex-col gap-[26px]">
      <div className="flex flex-col gap-[14px]">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">This week</div>
        <div className="flex flex-col">
          {STATS.map((stat) => (
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
