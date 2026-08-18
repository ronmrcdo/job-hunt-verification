import { fetchInvestigation } from "../../../lib/api";
import { BandBadge } from "../../../components/report/BandBadge";
import { FindingGroup } from "../../../components/report/FindingGroup";
import { VerifyChecklist } from "../../../components/report/VerifyChecklist";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // V0: owner key from a cookie/localStorage stand-in; accounts land in V1.
  const inv = await fetchInvestigation(id, "dev-owner");
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      {inv.assessment && (
        <BandBadge band={inv.assessment.band} confidence={inv.assessment.confidence} />
      )}
      <p>{inv.assessment?.summary}</p>
      {(["suspicious", "unverifiable", "legitimizing"] as const).map((d) => (
        <FindingGroup key={d} direction={d} findings={inv.findings} sources={inv.sources} />
      ))}
      <VerifyChecklist items={inv.what_to_verify ?? []} />
    </main>
  );
}
