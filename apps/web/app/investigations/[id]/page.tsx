import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getInvestigation } from "../../../lib/investigations";
import { InvestigationView } from "../../../components/investigation/InvestigationView";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { NOINDEX } from "../../../lib/site";

// Per-user report. RLS scopes it to the owner, so it must never be indexed
// or leak into a sitemap under any circumstances.
export const metadata = {
  title: "Investigation report",
  robots: NOINDEX,
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const initial = await getInvestigation(supabase, id);
  // RLS scopes the SELECT to the owning user, so a missing row and an
  // unauthorized one both read as "not found" here — never distinguished.
  if (!initial) notFound();
  return (
    <>
      <SiteHeader />
      <InvestigationView initial={initial} />
    </>
  );
}
