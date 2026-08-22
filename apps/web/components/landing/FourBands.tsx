import { SegmentBar } from "../ui/SegmentBar";
import { Reveal, RevealGroup, RevealItem } from "../ui/Reveal";

interface BandCard {
  label: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  filled: number;
  fillColor: string;
  description: string;
  ink?: boolean;
}

const EMPTY_COLOR = "var(--color-rule-soft)";

// Descriptions transcribed verbatim from the prototype (RULING R9):
// Investigator Prototype.dc.html lines 124-140.
const BANDS: BandCard[] = [
  {
    label: "LOW",
    filled: 1,
    fillColor: "var(--color-band-low)",
    description: "Nothing matches the patterns we check for. Caveats still printed.",
  },
  {
    label: "MODERATE",
    filled: 2,
    fillColor: "var(--color-band-moderate)",
    description: "Some signals worth resolving before you go further.",
  },
  {
    label: "HIGH",
    filled: 3,
    fillColor: "var(--color-band-high-on-white)",
    description: "Several signals match known job-scam patterns. Verify before acting.",
  },
  {
    label: "CRITICAL",
    filled: 4,
    fillColor: "var(--color-band-critical)",
    description: "Reserved for money already requested or documents already sent.",
    ink: true,
  },
];

export function FourBands() {
  return (
    // Anchor target for the header's "Risk bands" link; scroll-mt offsets
    // the 66px sticky header so the heading lands below it, not under it.
    <section id="risk-bands" className="scroll-mt-[66px] bg-surface-soft">
      <Reveal className="mx-auto flex max-w-page flex-col gap-6 px-8 pb-[52px] pt-12 max-[430px]:px-5">
        <RevealItem className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="m-0 text-[34px] font-bold tracking-[-0.03em] max-[430px]:text-[24px]">FOUR BANDS, NOT A SCORE</h2>
          <div className="max-w-[520px] text-[14px] leading-[1.55] text-secondary">
            A band says how the evidence reads. A separate confidence level says how much of it we could
            actually verify.
          </div>
        </RevealItem>
        <RevealGroup className="flex flex-wrap gap-4">
          {BANDS.map((band) => (
            <RevealItem
              key={band.label}
              data-band-card={band.label}
              data-ink={band.ink ? "true" : "false"}
              className={`flex flex-1 flex-col gap-[10px] rounded-none p-[22px] shadow-band ${
                band.ink ? "bg-ink text-page" : "bg-page"
              }`}
              style={{ flexBasis: "240px" }}
            >
              <SegmentBar total={4} filled={band.filled} fillColor={band.fillColor} emptyColor={EMPTY_COLOR} />
              <div className="text-[20px] font-bold tracking-[-0.02em]">{band.label}</div>
              <div className={`text-[14px] leading-[1.6] ${band.ink ? "" : "text-secondary"}`}>
                {band.description}
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </Reveal>
    </section>
  );
}
