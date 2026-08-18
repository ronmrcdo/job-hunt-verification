import type { components } from "@job-hunt/api-types";

type Band = components["schemas"]["FinalAssessment"]["band"];
type Conf = components["schemas"]["FinalAssessment"]["confidence"];

const COLORS: Record<Band, string> = {
  LOW: "#137333",
  MODERATE: "#b06000",
  HIGH: "#c5221f",
  CRITICAL: "#8c1d18",
};

export function BandBadge({ band, confidence }: { band: Band; confidence: Conf }) {
  return (
    <div
      role="status"
      style={{
        background: COLORS[band],
        color: "white",
        padding: "0.75rem 1.25rem",
        borderRadius: 8,
        fontWeight: 700,
      }}
    >
      {band} risk
      <span style={{ fontWeight: 400, marginLeft: 8 }}>· confidence: {confidence.toLowerCase()}</span>
    </div>
  );
}
