// Copy transcribed verbatim from the prototype's progress screen
// (Investigator Prototype.dc.html, lines 288-291): the right rail heading
// and the evidence items collected so far, wording and punctuation as
// written there.
import { MicroLabel } from "../ui/MicroLabel";

const ITEMS: { label: string; description: string }[] = [
  { label: "registrar record", description: "retrieved 09:41" },
  { label: "job board listing ×3", description: "retrieved 09:41–09:42" },
  { label: "conversation you shared", description: "not independently verifiable" },
];

export function EvidenceRail() {
  return (
    <aside className="flex flex-[0_1_320px] flex-col gap-4 border border-ink p-[22px]">
      <MicroLabel>EVIDENCE COLLECTED</MicroLabel>
      <div className="flex flex-col">
        {ITEMS.map((item) => (
          <div key={item.label} className="flex flex-col gap-[3px] border-t border-rule py-[13px]">
            <span className="font-mono text-[12px]">{item.label}</span>
            <span className="text-[12px] text-muted">{item.description}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-[1.5] text-muted">
        Every item here is listed again in the report, with the excerpt it came from.
      </p>
    </aside>
  );
}
