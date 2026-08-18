import type { components } from "@job-hunt/api-types";

export type Investigation = components["schemas"]["InvestigationResponse"];

export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export type CreateInput = {
  jobText: string;
  companyName?: string;
  recruiterEmail?: string;
  jobUrl?: string;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

// Dev-only request simulation. When NEXT_PUBLIC_MOCK_API === "1" the two
// network calls below resolve from the existing report fixtures instead of
// hitting the ~90s V0 backend, so the report page (and the full flow into it)
// can be driven without a running API. NEXT_PUBLIC_MOCK_BAND=low selects the
// LOW fixture; anything else falls back to HIGH. Fixtures are pulled via
// dynamic import so they stay out of the bundle when the flag is off.
//   Enable:  NEXT_PUBLIC_MOCK_API=1 npm run dev
const MOCK_API = process.env.NEXT_PUBLIC_MOCK_API === "1";

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockInvestigation(): Promise<Investigation> {
  const band = process.env.NEXT_PUBLIC_MOCK_BAND?.toLowerCase();
  if (band === "low") {
    const { SAMPLE_LOW } = await import("./__fixtures__/sample-low");
    return SAMPLE_LOW.inv;
  }
  const { SAMPLE_HIGH } = await import("./__fixtures__/sample-high");
  return SAMPLE_HIGH.inv;
}

export async function fetchInvestigation(id: string, ownerKey: string): Promise<Investigation> {
  if (MOCK_API) {
    // Short read-back delay so the LOADING state is briefly visible, then
    // stamp the requested id onto the fixture so the URL and payload agree.
    await mockDelay(500);
    return { ...(await mockInvestigation()), id };
  }
  const res = await fetch(`${apiBase()}/investigations/${id}`, {
    headers: { "X-Owner-Key": ownerKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("not found");
  return res.json();
}

export async function createInvestigation(
  input: CreateInput,
  ownerKey: string,
): Promise<{ id: string }> {
  if (MOCK_API) {
    // Simulate the blocking run so the progress screen's scripted animation
    // plays through, then hand back the fixture's id for the report route.
    await mockDelay(1500);
    return { id: (await mockInvestigation()).id };
  }
  // V0 API accepts ONLY these four fields: job_text, company_name, recruiter_email,
  // job_url. The UI also collects a pasted conversation, company website, and
  // recruiter name, but those are intentionally NOT sent here — the V0 conversation
  // node is dormant and the API has no fields for them.
  const res = await fetch(`${apiBase()}/investigations`, {
    method: "POST",
    headers: {
      "X-Owner-Key": ownerKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_text: input.jobText,
      company_name: input.companyName,
      recruiter_email: input.recruiterEmail,
      job_url: input.jobUrl,
    }),
  });
  if (!res.ok) throw new FetchError(`failed to create investigation (${res.status})`, res.status);
  return res.json();
}
