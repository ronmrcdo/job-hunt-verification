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

export async function fetchInvestigation(id: string, ownerKey: string): Promise<Investigation> {
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
