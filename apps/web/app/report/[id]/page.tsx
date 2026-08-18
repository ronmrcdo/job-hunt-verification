"use client";

import { use, useEffect, useState } from "react";
import { fetchInvestigation, type Investigation } from "../../../lib/api";
import { getOwnerKey } from "../../../lib/ownerKey";
import { toReportViewModel } from "../../../lib/report-view-model";
import { useFlow } from "../../../lib/flow-context";
import { BandBanner } from "../../../components/report/BandBanner";
import { ConfidencePanel } from "../../../components/report/ConfidencePanel";
import { Summary } from "../../../components/report/Summary";
import { FindingGroup } from "../../../components/report/FindingGroup";
import { VerifyChecklist } from "../../../components/report/VerifyChecklist";
import { ReportFooter } from "../../../components/report/ReportFooter";
import { ReportRail } from "../../../components/report/ReportRail";
import { MicroLabel } from "../../../components/ui/MicroLabel";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { submitted } = useFlow();
  const [inv, setInv] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [saved, setSaved] = useState(false);

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

  if (error) {
    return (
      <main id="main-content" className="mx-auto max-w-page px-6 py-16">
        <MicroLabel>NOT FOUND</MicroLabel>
        <p className="mt-2 font-mono text-[13px]">We couldn&apos;t find that report.</p>
      </main>
    );
  }

  if (!inv) {
    return (
      <main id="main-content" className="mx-auto max-w-page px-6 py-16">
        <MicroLabel>LOADING</MicroLabel>
        <p className="mt-2 font-mono text-[13px]">Loading…</p>
      </main>
    );
  }

  const vm = toReportViewModel(inv, submitted);

  return (
    <main id="main-content">
      <BandBanner vm={vm} confidenceSlot={<ConfidencePanel vm={vm} />} />
      <div className="mx-auto max-w-page grid grid-cols-1 gap-8 px-6 py-16 md:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-10">
          <Summary summary={vm.summary} />
          {vm.groups.map((group) => (
            <FindingGroup key={group.key} group={group} />
          ))}
          <VerifyChecklist items={vm.verifyChecklist} />
          <ReportFooter vm={vm} reported={reported} onReport={() => setReported(true)} />
        </div>
        <ReportRail vm={vm} saved={saved} onSave={() => setSaved(true)} />
      </div>
    </main>
  );
}
