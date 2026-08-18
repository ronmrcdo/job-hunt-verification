// Copy transcribed verbatim from the prototype's "review/details" screen
// (Investigator Prototype.dc.html, lines 250-254): the right rail heading
// and the three field/value pairs, punctuation and wording as written there.
import { MicroLabel } from "../ui/MicroLabel";

interface RailItem {
  label: string;
  description: string;
}

const ITEMS: RailItem[] = [
  {
    label: "Company website",
    description: "Lets us compare the domain you were given against the registered one.",
  },
  {
    label: "Recruiter email",
    description: "Shows whether mail comes from the company or a free consumer address.",
  },
  {
    label: "Conversation",
    description: "Read for pressure and payment patterns. Findings from it are always labelled as yours.",
  },
];

export function FieldValueRail() {
  return (
    <aside className="flex flex-1 basis-[320px] flex-col gap-4 border border-ink p-[22px]">
      <MicroLabel>WHAT EACH FIELD BUYS YOU</MicroLabel>
      <div className="flex flex-col">
        {ITEMS.map((item) => (
          <div key={item.label} className="flex flex-col gap-[3px] border-t border-rule py-[13px]">
            <span className="text-[14px] font-bold">{item.label}</span>
            <span className="text-[13px] leading-[1.55] text-secondary">{item.description}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
