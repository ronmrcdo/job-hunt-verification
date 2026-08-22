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
        {/* Three blocks, explicitly placed. On desktop the copy (orientation +
            context) fills the left column and the form spans both rows on the
            right, side by side. On mobile the grid collapses to one column and
            stacking follows source order, so the blocks are ordered
            orientation → form → context: the step label and headline keep the
            user oriented, the form sits near the top so it's reachable without
            scrolling past the marketing copy, and the longer "why" + queued
            card follow just below it.

            grid-rows-[auto_1fr] matters: the form card spans both rows, and
            with implicit rows the browser splits its height across them, so
            switching to "Create account" (two extra fields) grew row 1 and
            shoved the headline's neighbours down. Row 1 is now pinned to the
            headline's height and row 2 absorbs whatever slack the taller card
            leaves, so the left column never moves between tabs. */}
        <main
          id="main-content"
          className="mx-auto grid max-w-page grid-cols-1 gap-x-10 gap-y-6 px-8 py-16 max-[430px]:px-5 md:grid-cols-[1fr_420px] md:grid-rows-[auto_1fr] md:gap-y-10"
        >
          {/* DOM order is orientation → form → context, which is exactly the
              mobile single-column stack. On desktop the explicit grid
              coordinates below override that flow — the two copy blocks take
              the left column's two rows and the form spans the right — so
              source order only drives the mobile layout. */}
          <div className="flex flex-col gap-6 md:col-start-1 md:row-start-1">
            <MicroLabel>STEP 2 OF 3 · SIGN IN REQUIRED</MicroLabel>
            <h1 className="m-0 text-[48px] font-bold leading-[0.98] tracking-[-0.03em]">
              SIGN IN TO RUN
              <br />
              THIS CHECK
            </h1>
          </div>
          <div className="md:col-start-2 md:row-start-1 md:row-span-2">
            <AuthForm />
          </div>
          <div className="flex flex-col gap-6 md:col-start-1 md:row-start-2">
            <p className="max-w-[520px] text-[16px] leading-[1.6] text-secondary">
              Reports name companies and people, so they don&apos;t sit on a public page. Signing
              in keeps yours to you and lets us hold the report if you close the tab mid-check.
            </p>
            <QueuedCard />
          </div>
        </main>
      </div>
    </>
  );
}
