// The authenticated home (spec §3): paste-and-run form + the signed-in
// user's recent checks. Middleware already gates this route to signed-in
// sessions; the getUser() call here is a defensive belt-and-braces guard,
// not the primary access control.
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { recentInvestigations } from "../../lib/investigations";
import { SiteHeader } from "../../components/site/SiteHeader";
import { NewCheckForm } from "../../components/verify/NewCheckForm";
import { RecentChecks } from "../../components/verify/RecentChecks";

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const items = await recentInvestigations(supabase);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-page px-8 py-11">
        <div className="flex flex-wrap items-start gap-11">
          <div className="flex flex-1 basis-[560px] flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h1 className="m-0 text-[44px] font-bold leading-[0.98] tracking-[-0.035em]">
                CHECK A JOB
              </h1>
              <p className="max-w-[600px] text-[16px] leading-[1.6] text-secondary">
                Paste the posting, add anything else you know, and we&rsquo;ll run the check.
              </p>
            </div>

            <NewCheckForm initialJobText="" />
          </div>

          <div className="flex flex-1 basis-[280px] flex-col gap-3">
            <h2 className="m-0 text-[11px] uppercase tracking-[0.12em] text-muted">
              Recent checks
            </h2>
            <RecentChecks items={items} />
          </div>
        </div>
      </main>
    </>
  );
}
