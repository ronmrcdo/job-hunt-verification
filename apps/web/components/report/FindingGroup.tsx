import type { components } from "@job-hunt/api-types";
import { SourceList } from "./SourceList";

type Finding = components["schemas"]["Finding"];
type Source = components["schemas"]["Source"];

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
        const findingSources = (f.source_ids ?? []).map((id) => byId.get(id) ?? { id });
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
