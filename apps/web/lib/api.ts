import type { components } from "@job-hunt/api-types";

export type Investigation = components["schemas"]["InvestigationResponse"];

export async function fetchInvestigation(id: string, ownerKey: string): Promise<Investigation> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${base}/investigations/${id}`, {
    headers: { "X-Owner-Key": ownerKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("not found");
  return res.json();
}
