"use client";

// Step 3 of 3: everything else the user knows about the posting, all
// optional. See DetailsForm.tsx for the field-to-flow wiring and the V0
// note on which fields the API actually accepts.
import { SiteHeader } from "../../../components/site/SiteHeader";
import { MicroLabel } from "../../../components/ui/MicroLabel";
import { DetailsForm } from "../../../components/details/DetailsForm";
import { FieldValueRail } from "../../../components/details/FieldValueRail";
import { useFlow } from "../../../lib/flow-context";

export default function Page() {
  const { state } = useFlow();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-page px-8 py-11">
        {/* Two-column row: title + form share the left column so the rail
            top-aligns with the title, not the first field (design handoff). */}
        <div className="flex flex-wrap items-start gap-11">
          <div className="flex flex-1 basis-[560px] flex-col gap-6">
            <div className="flex flex-col gap-3">
              <MicroLabel>STEP 3 OF 3 · SIGNED IN AS {state.authEmail}</MicroLabel>
              <h1 className="m-0 text-[44px] font-bold leading-[0.98] tracking-[-0.035em]">
                ADD ANYTHING ELSE
                <br />
                YOU KNOW
              </h1>
              <p className="max-w-[600px] text-[16px] leading-[1.6] text-secondary">
                All optional — but each field gives us something more to verify, which raises the
                confidence attached to your result.
              </p>
            </div>

            <DetailsForm />
          </div>

          <FieldValueRail />
        </div>
      </main>
    </>
  );
}
