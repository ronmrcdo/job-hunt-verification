import { Reveal, RevealGroup, RevealItem } from "../ui/Reveal";

interface Step {
  number: string;
  title: string;
  description: string;
}

// Step descriptions transcribed verbatim from the prototype (RULING R9):
// Investigator Prototype.dc.html lines 107-110.
const STEPS: Step[] = [
  {
    number: "01",
    title: "Read the posting",
    description: "We pull out the claims that can actually be checked: company, domain, pay, contact route.",
  },
  {
    number: "02",
    title: "Gather evidence",
    description: "Company web presence, registrar records, duplicate postings, and the conversation you shared.",
  },
  {
    number: "03",
    title: "Weigh it",
    description: "Each finding gets a direction, a severity, its sources, and a counterpoint where one exists.",
  },
  {
    number: "04",
    title: "Hand it to you",
    description: "A band, a confidence level, the evidence behind it, and the checks only you can do.",
  },
];

export function HowItRuns() {
  return (
    <section>
      <Reveal className="mx-auto flex max-w-page flex-col gap-[26px] px-8 pb-[52px] pt-12">
        <RevealItem className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 text-[34px] font-bold tracking-[-0.03em]">HOW A CHECK RUNS</h2>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Four stages · about 1–2 minutes</div>
        </RevealItem>
        <RevealGroup className="flex flex-wrap gap-[28px]">
          {STEPS.map((step) => (
            <RevealItem key={step.number} className="flex flex-1 flex-col gap-[9px]" style={{ flexBasis: "230px" }}>
              <div className="font-mono text-[12px] text-muted">{step.number}</div>
              <div className="text-[18px] font-bold tracking-[-0.015em]">{step.title}</div>
              <div className="text-[14px] leading-[1.6] text-secondary">{step.description}</div>
            </RevealItem>
          ))}
        </RevealGroup>
      </Reveal>
    </section>
  );
}
