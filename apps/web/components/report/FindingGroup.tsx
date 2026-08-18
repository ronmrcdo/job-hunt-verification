import type { components } from "@job-hunt/api-types";
import { defang } from "../../lib/defang";
import { formatStamp } from "../../lib/format";
import type { SourceVM } from "../../lib/report-view-model";
import { SourceList } from "./SourceList";

type Finding = components["schemas"]["Finding"];
type Source = components["schemas"]["Source"];

// This component predates the new report view-model pipeline (Task 3.6
// retires the page that renders it) and still receives raw API `Source`
// objects, so it adapts them to SourceList's SourceVM shape locally rather
// than duplicating a SourceList that special-cases both shapes.
function toSourceVM(source: Source | { id: string }): SourceVM {
  const url = "url" in source ? source.url : undefined;
  const retrievedAt = "retrieved_at" in source ? source.retrieved_at : undefined;
  const summary = "content_summary" in source ? source.content_summary : undefined;
  return {
    name: url ? defang(url) : source.id,
    stampMono: retrievedAt ? formatStamp(retrievedAt) : "",
    excerpt: summary ?? "",
    defang: Boolean(url),
  };
}

const TITLES: Record<Finding["direction"], string> = {
  legitimizing: "Looks legitimate",
  suspicious: "Worth a closer look",
  unverifiable: "Could not verify",
};

export function FindingGroup({
  direction,
  findings,
  sources,
}: {
  direction: Finding["direction"];
  findings: Finding[];
  sources: Source[];
}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const group = findings.filter((f) => f.direction === direction);
  return (
    <section>
      <h2>{TITLES[direction]}</h2>
      {group.map((f) => {
        // f.claim/f.mitigation are untrusted, attacker-influenced content
        // (spec §9.2) — rendered as plain text (React escapes by default),
        // never via dangerouslySetInnerHTML.
        const findingSources = (f.source_ids ?? []).map((id) => toSourceVM(byId.get(id) ?? { id }));
        return (
          <details key={f.id}>
            <summary>{f.claim}</summary>
            {f.mitigation && (
              <p>
                <em>{f.mitigation}</em>
              </p>
            )}
            <SourceList sources={findingSources} />
          </details>
        );
      })}
    </section>
  );
}
