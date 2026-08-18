"use client";

// Step 3 of 3: the optional-details form. Every field here edits flow state
// live as the user types, so both CTAs can just read `state` and route —
// neither needs its own local draft state.
//
// V0 NOTE: `site` (company website), `recruiter` (recruiter name), and
// `convo` (pasted conversation) are collected here for UX/V1 groundwork —
// the FieldValueRail explains why they're worth filling in — but the V0
// POST (lib/api.ts createInvestigation) does NOT send them. The V0 API only
// accepts job_text, company_name, recruiter_email, and job_url; the
// conversation-analysis node is dormant in V0. See lib/api.ts's own comment
// on createInvestigation for the source of truth.
import { useRouter } from "next/navigation";
import { TextField } from "../ui/TextField";
import { TextArea } from "../ui/TextArea";
import { Button } from "../ui/Button";
import { useFlow } from "../../lib/flow-context";

export function DetailsForm() {
  const router = useRouter();
  const { state, set } = useFlow();

  // Both CTAs do the same thing: the fields are already live-synced to flow
  // state via each field's onChange, so there's nothing left to gather —
  // just go run the check. SKIP intentionally requires nothing extra.
  function goRun() {
    router.push("/check/running");
  }

  // Just the form column. The two-column split (this column + FieldValueRail)
  // and the step-3 title now live in the page, so the rail top-aligns with
  // the title rather than the first field — matching the design handoff.
  return (
    <div className="flex flex-col gap-6">
      <TextArea
        label="Job link or job text"
        value={state.jobInput}
        onChange={(jobInput) => set({ jobInput })}
        mono
        minHeight="104px"
      />

      <div className="flex flex-wrap gap-4">
        <TextField
          label="Company name"
          value={state.company}
          onChange={(company) => set({ company })}
          placeholder="Acme Global"
          minWidth="240px"
          autoComplete="organization"
        />
        <TextField
          label="Company website"
          value={state.site}
          onChange={(site) => set({ site })}
          placeholder="acme-globall.com"
          mono
          minWidth="240px"
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <TextField
          label="Recruiter name"
          value={state.recruiter}
          onChange={(recruiter) => set({ recruiter })}
          placeholder="John Smith"
          minWidth="240px"
        />
        <TextField
          label="Recruiter email"
          value={state.email}
          onChange={(email) => set({ email })}
          placeholder="acmeglobalcareers@gmail.com"
          mono
          minWidth="240px"
          autoComplete="email"
        />
      </div>

      <TextArea
        label="Paste your conversation with the recruiter"
        value={state.convo}
        onChange={(convo) => set({ convo })}
        placeholder="Copy the messages and paste them here"
        minHeight="116px"
      />
      <p className="-mt-4 text-[12px] text-muted">
        Text only — copy and paste the messages. Screenshots aren&apos;t supported yet.
      </p>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-1 basis-[320px] items-stretch border border-ink">
          <Button variant="primary" size="wide" className="flex-1" onClick={goRun}>
            START INVESTIGATION
          </Button>
          <div className="flex items-center whitespace-nowrap px-4 text-[11px] uppercase tracking-[0.08em] text-muted">
            1–2 MIN
          </div>
        </div>
        <Button variant="secondary" onClick={goRun}>
          SKIP THE EXTRAS AND RUN IT
        </Button>
      </div>
    </div>
  );
}
