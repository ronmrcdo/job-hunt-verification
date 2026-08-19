// Reconciliation spine: every report component renders from the ReportVM
// produced here. Nothing downstream should read `Investigation` directly.
import type { Investigation, Source } from "./investigations";
import { defang } from "./defang";
import { formatStamp, pad2 } from "./format";

export type Band = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type ConfidenceLevel = "Low" | "Medium" | "High";

export interface SourceVM {
  name: string;
  stampMono: string;
  excerpt: string;
  defang: boolean;
}

export interface FindingVM {
  recordId: string; // "F-01"… by order
  direction: "legitimizing" | "suspicious" | "unverifiable";
  severity: "info" | "low" | "medium" | "high" | "critical" | null;
  claim: string;
  metaLine: string; // "SUSPICIOUS · SEVERITY HIGH · 3 SOURCES"
  provenanceLabel: string | null; // set iff provenance === "user_provided_unverified"
  however: string | null; // from Finding.mitigation
  sources: SourceVM[];
}

export interface ReportVM {
  caseId: string;
  complete: boolean; // false when the assessment never computed (e.g. deadline_exceeded)
  band: Band | null;
  bandIndex: number | null; // 1..4
  bandMeaning: string | null;
  confidence: ConfidenceLevel | null;
  confidenceSegments: number | null; // 1..3
  confidenceNote: string | null;
  summary: string | null;
  repeatLine: string; // "CHECKED 3 TIMES IN THE PAST WEEK" | "FIRST CHECK ON THIS POSTING"
  submitted: { label: string; value: string; mono?: boolean }[];
  groups: {
    key: "legitimizing" | "suspicious" | "unverifiable";
    heading: string;
    countMono: string;
    findings: FindingVM[];
  }[];
  verifyChecklist: string[];
}

// Narrowed view of ReportVM for the complete-report branch, where band/
// confidence/summary are guaranteed non-null. Kept local to the report
// components that only ever render once `vm.complete` is true.
export type CompleteReportVM = ReportVM & {
  complete: true;
  band: Band;
  bandIndex: number;
  bandMeaning: string;
  confidence: ConfidenceLevel;
  confidenceSegments: number;
  confidenceNote: string;
  summary: string;
};

export const BAND_MEANING: Record<Band, string> = {
  HIGH: "Multiple signals here match patterns common in job scams. Treat it with caution and verify independently before acting.",
  LOW: "Nothing here matches the scam patterns we check for, and the company and posting line up with each other. That isn't a guarantee — two things below stayed unverified.",
  MODERATE:
    "A few signals here are worth a second look. That isn't a verdict either way, so treat the items below as things to confirm before you proceed.",
  CRITICAL:
    "This matches the patterns we see in confirmed job scams closely enough that we'd stop here. Don't send money or personal documents, and verify independently before doing anything else.",
};

export const CONFIDENCE_NOTE: Record<ConfidenceLevel, string> = {
  Low: "Much of this rested on material we couldn't check independently.",
  Medium: "Some claims rested on sources we couldn't fully reach.",
  High: "Most claims were confirmed against sources that responded directly.",
};

const BAND_INDEX: Record<Band, number> = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

const CONFIDENCE_MAP: Record<"LOW" | "MODERATE" | "HIGH", { level: ConfidenceLevel; segments: number }> = {
  LOW: { level: "Low", segments: 1 },
  MODERATE: { level: "Medium", segments: 2 },
  HIGH: { level: "High", segments: 3 },
};

const DIRECTION_LABEL: Record<FindingVM["direction"], string> = {
  legitimizing: "SUPPORTS LEGITIMACY",
  suspicious: "SUSPICIOUS",
  unverifiable: "UNVERIFIED",
};

const GROUP_ORDER: FindingVM["direction"][] = ["legitimizing", "suspicious", "unverifiable"];
const GROUP_HEADING: Record<FindingVM["direction"], string> = {
  legitimizing: "What checks out",
  suspicious: "What looks suspicious",
  unverifiable: "What we couldn't verify",
};

function sourceName(source: Source): { name: string; defang: boolean } {
  if (source.url) {
    return { name: defang(source.url), defang: true };
  }
  switch (source.kind) {
    case "whois":
      return { name: "registrar record", defang: false };
    case "dns":
      return { name: "mail records", defang: false };
    case "user_provided":
      return { name: "conversation you shared", defang: false };
    case "fetched_page":
    case "search_result":
      return { name: "web source", defang: false };
    default:
      return { name: "web source", defang: false };
  }
}

function toSourceVM(source: Source): SourceVM {
  const { name, defang: isDefanged } = sourceName(source);
  return {
    name,
    stampMono: formatStamp(source.retrieved_at),
    excerpt: source.raw_excerpt ?? source.content_summary,
    defang: isDefanged,
  };
}

function buildMetaLine(
  direction: FindingVM["direction"],
  severity: FindingVM["severity"],
  sourceCount: number,
): string {
  let line = DIRECTION_LABEL[direction];
  if (severity !== null && severity !== "info") {
    line += ` · SEVERITY ${severity.toUpperCase()}`;
  }
  if (sourceCount > 0) {
    line += ` · ${sourceCount} SOURCES`;
  }
  return line;
}

// caseId: deterministic cosmetic slice of the investigation id (first 8 hex
// chars, uppercased) — not derived from Date.now/random so it's stable
// across renders and tests.
function toCaseId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function toReportViewModel(inv: Investigation): ReportVM {
  const assessment = inv.assessment;
  const complete = assessment != null;

  const band: Band | null = assessment?.band ?? null;
  const confidenceRaw = assessment?.confidence ?? null;
  const conf = confidenceRaw ? CONFIDENCE_MAP[confidenceRaw] : null;
  const bandIndex = band ? BAND_INDEX[band] : null;
  const bandMeaning = band ? BAND_MEANING[band] : null;

  const sources = inv.sources ?? [];
  const findings = inv.findings ?? [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const findingVMs: FindingVM[] = findings.map((finding, index) => {
    const findingSources = (finding.source_ids ?? [])
      .map((id) => sourceById.get(id))
      .filter((s): s is Source => s !== undefined)
      .map(toSourceVM);

    return {
      recordId: `F-${pad2(index + 1)}`,
      direction: finding.direction,
      severity: finding.severity,
      claim: finding.claim,
      metaLine: buildMetaLine(finding.direction, finding.severity, findingSources.length),
      provenanceLabel:
        finding.provenance === "user_provided_unverified"
          ? "Based on the conversation you shared — we can't independently verify it."
          : null,
      however: finding.mitigation ?? null,
      sources: findingSources,
    };
  });

  const groups = GROUP_ORDER.map((key) => {
    const findings = findingVMs.filter((f) => f.direction === key);
    return {
      key,
      heading: GROUP_HEADING[key],
      countMono: pad2(findings.length),
      findings,
    };
  }).filter((g) => g.findings.length > 0);

  const repeatLine =
    inv.check_count && inv.check_count > 0
      ? `CHECKED ${inv.check_count} TIMES IN THE PAST WEEK`
      : "FIRST CHECK ON THIS POSTING";

  // Job title / recruiter name / contact channel have no corresponding
  // field on `Submission` — those rows are simply never produced. Only
  // company_name and recruiter_email round-trip from the submitted job.
  const submittedRows: { label: string; value: string; mono?: boolean }[] = [];
  if (inv.submission.company_name !== undefined)
    submittedRows.push({ label: "Company", value: inv.submission.company_name });
  if (inv.submission.recruiter_email !== undefined)
    submittedRows.push({ label: "Email", value: inv.submission.recruiter_email, mono: true });

  return {
    caseId: toCaseId(inv.id),
    complete,
    band,
    bandIndex,
    bandMeaning,
    confidence: conf?.level ?? null,
    confidenceSegments: conf?.segments ?? null,
    confidenceNote: conf ? CONFIDENCE_NOTE[conf.level] : null,
    summary: assessment?.summary ?? null,
    repeatLine,
    submitted: submittedRows,
    groups,
    verifyChecklist: inv.what_to_verify ?? [],
  };
}
