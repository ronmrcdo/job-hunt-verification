import { defang } from "../../lib/defang";

// A subset of the generated Source shape — deliberately loose so this
// component can also render a placeholder for a finding's source_id that
// has no matching entry in the sources list.
type SourceLike = { id: string; url?: string | null; content_summary?: string | null };

// Renders the sources backing a single finding. Never a live <a href> to a
// URL — evidence URLs may be attacker-controlled (spec §9.2/§9.5), so they
// are shown defanged as inert text, and content_summary is rendered as a
// plain escaped string (React escapes by default; no dangerouslySetInnerHTML
// anywhere in this tree).
export function SourceList({ sources }: { sources: SourceLike[] }) {
  return (
    <ul>
      {sources.map((s) => (
        <li key={s.id}>
          {s.url ? defang(s.url) : s.id}
          {s.content_summary ? `: ${s.content_summary}` : null}
        </li>
      ))}
    </ul>
  );
}
