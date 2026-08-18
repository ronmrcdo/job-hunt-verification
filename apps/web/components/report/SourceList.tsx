import type { SourceVM } from "../../lib/report-view-model";
import { DefangedText } from "../ui/DefangedText";

export interface SourceListProps {
  sources: SourceVM[];
}

// Renders the sources backing a single finding. A source name that is a URL
// (source.defang === true) is always shown via DefangedText — never a live
// <a href> — because evidence URLs may be attacker-controlled (spec
// §9.2/§9.5, product rule #4).
export function SourceList({ sources }: SourceListProps) {
  return (
    <ul className="space-y-3">
      {sources.map((source, index) => (
        <li key={`${source.name}-${index}`} className="text-[13px]">
          <div className="flex items-baseline gap-2">
            <span className="font-mono">
              {source.defang ? <DefangedText value={source.name} /> : source.name}
            </span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{source.stampMono}</span>
          </div>
          <p className="mt-1 border-l-[3px] border-rule pl-2 leading-[1.5]">{source.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}
