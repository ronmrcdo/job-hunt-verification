"use client";

import { use, useEffect, useState } from "react";
import { fetchInvestigation, type Investigation } from "../../../lib/api";
import { getOwnerKey } from "../../../lib/ownerKey";
import { BandBadge } from "../../../components/report/BandBadge";
import { FindingGroup } from "../../../components/report/FindingGroup";
import { VerifyChecklist } from "../../../components/report/VerifyChecklist";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Owner key is per-browser (localStorage), so this must run client-side
    // (spec §9.6) — each browser only ever reads back what it created.
    fetchInvestigation(id, getOwnerKey())
      .then((result) => {
        if (!cancelled) setInv(result);
      })
      .catch(() => {
        if (!cancelled) setError("not found");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <main style={{ maxWidth: 720, margin: "2rem auto" }}>{error}</main>;
  if (!inv) return <main style={{ maxWidth: 720, margin: "2rem auto" }}>Loading…</main>;

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
