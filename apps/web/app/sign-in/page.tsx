// The auth gate between pasting a posting and running the check. Server
// component: an already-authenticated visitor is bounced to /verify so the
// header "Check a job" CTA never dead-ends a signed-in user on the sign-in
// form (middleware guards /verify + /investigations/*, not /sign-in).
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { SiteHeader } from "../../components/site/SiteHeader";
import { MicroLabel } from "../../components/ui/MicroLabel";
import { AuthForm } from "../../components/auth/AuthForm";
import { QueuedCard } from "../../components/auth/QueuedCard";

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/verify");

  return (
    <>
      <SiteHeader />
      {/* Off-white canvas below the white header — the prototype paints the
          page column #FAFAF8 (surface-alt) and reserves white for the cards
          and inputs, so they read as raised surfaces. Full-width wrapper (the
          tone spans the viewport) with the content column centred inside. */}
      <div className="min-h-[calc(100dvh-66px)] bg-surface-alt">
        <main
          id="main-content"
          className="mx-auto grid max-w-page grid-cols-1 gap-10 px-8 py-16 md:grid-cols-[1fr_420px]"
        >
          <div className="flex flex-col gap-6">
            <MicroLabel>STEP 2 OF 3 · SIGN IN REQUIRED</MicroLabel>
            <h1 className="m-0 text-[48px] font-bold leading-[0.98] tracking-[-0.03em]">
              SIGN IN TO RUN
              <br />
              THIS CHECK
            </h1>
            <p className="max-w-[520px] text-[16px] leading-[1.6] text-secondary">
              Reports name companies and people, so they don&apos;t sit on a public page. Signing
              in keeps yours to you and lets us hold the report if you close the tab mid-check.
            </p>
            <QueuedCard />
          </div>
          <AuthForm />
        </main>
      </div>
    </>
  );
}
