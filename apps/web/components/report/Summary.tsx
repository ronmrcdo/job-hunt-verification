import { MicroLabel } from "../ui/MicroLabel";

export interface SummaryProps {
  summary: string;
}

export function Summary({ summary }: SummaryProps) {
  return (
    <section>
      <MicroLabel>SUMMARY</MicroLabel>
      <p className="mt-2" style={{ fontSize: 18, lineHeight: 1.62 }}>
        {summary}
      </p>
    </section>
  );
}
