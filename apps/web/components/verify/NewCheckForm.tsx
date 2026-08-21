"use client";

// The `/verify` home's paste-and-run form: validate the posting (+ optional
// details) with `submissionSchema`, INSERT via `createInvestigation`, and
// route straight to the investigation's live/report view. Reuses the same
// field components as the old DetailsForm (TextArea/TextField) — see that
// file for the field-to-flow wiring this form replaces for the authed home.
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submissionSchema, type SubmissionInput } from "../../lib/validation";
import { createInvestigation, quotaStatus, type QuotaStatus } from "../../lib/investigations";
import { createClient } from "../../lib/supabase/client";
import { TextField } from "../ui/TextField";
import { TextArea } from "../ui/TextArea";
import { Button } from "../ui/Button";
import { useFlowOptional } from "../../lib/flow-context";

function resetCopy(resetsAt: string | null, limit: number): string {
  if (!resetsAt) return `You’ve used all ${limit} weekly checks and have no bonus checks left. Your weekly quota resets soon.`;
  const d = new Date(resetsAt);
  return `You’ve used all ${limit} weekly checks and have no bonus checks left. Your weekly quota resets on ${d.toLocaleDateString()}.`;
}

export function NewCheckForm({ initialJobText }: { initialJobText: string }) {
  const router = useRouter();
  const flow = useFlowOptional();
  const [formError, setFormError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  useEffect(() => {
    let active = true;
    quotaStatus(createClient())
      .then((q) => { if (active) setQuota(q); })
      .catch(() => { /* non-blocking: the DB trigger is the real gate */ });
    return () => { active = false; };
  }, []);
  const weeklyRemaining = quota ? Math.max(quota.weeklyLimit - quota.weeklyUsed, 0) : null;
  const topUp = quota?.topUpBalance ?? 0;
  // Blocked only when BOTH buckets are empty; a bonus check keeps submit live.
  const exhausted = quota ? weeklyRemaining === 0 && topUp === 0 : false;
  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SubmissionInput>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      job_text: initialJobText,
      company_name: "",
      recruiter_email: "",
      job_url: "",
    },
  });

  // Seed job_text from the pre-auth draft (flow-context/sessionStorage) once
  // it hydrates, but only if the caller didn't already pass one in and the
  // user hasn't started typing yet.
  const draftJobInput = flow?.state.jobInput ?? "";
  useEffect(() => {
    if (!initialJobText && draftJobInput && !getValues("job_text")) {
      setValue("job_text", draftJobInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJobInput]);

  async function onSubmit(values: SubmissionInput) {
    setFormError(null);
    if (exhausted) {
      setFormError(resetCopy(quota?.resetsAt ?? null, quota?.weeklyLimit ?? 3));
      return;
    }
    const result = await createInvestigation(createClient(), values);
    if ("error" in result) {
      setFormError(
        result.quotaExceeded
          ? resetCopy(result.resetsAt ?? null, quota?.weeklyLimit ?? 3)
          : "We couldn’t start the check. " + result.error,
      );
      return;
    }
    flow?.reset();
    router.push(`/investigations/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <Controller
        name="job_text"
        control={control}
        render={({ field }) => (
          <TextArea
            label="Job link or job text"
            value={field.value ?? ""}
            onChange={field.onChange}
            mono
            minHeight="104px"
          />
        )}
      />
      {errors.job_text ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{errors.job_text.message}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <Controller
          name="company_name"
          control={control}
          render={({ field }) => (
            <TextField
              label="Company name"
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Acme Global"
              minWidth="240px"
              autoComplete="organization"
            />
          )}
        />
        <Controller
          name="job_url"
          control={control}
          render={({ field }) => (
            <TextField
              label="Job posting link"
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="https://acme-globall.com/careers/va"
              mono
              minWidth="240px"
            />
          )}
        />
      </div>
      {errors.job_url ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{errors.job_url.message}</p>
        </div>
      ) : null}

      <Controller
        name="recruiter_email"
        control={control}
        render={({ field }) => (
          <TextField
            label="Recruiter email"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="acmeglobalcareers@gmail.com"
            mono
            minWidth="240px"
            autoComplete="email"
          />
        )}
      />
      {errors.recruiter_email ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{errors.recruiter_email.message}</p>
        </div>
      ) : null}

      {formError ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{formError}</p>
        </div>
      ) : null}

      {quota ? (
        <p className="text-[13px] leading-[1.5] text-ink-soft">
          {weeklyRemaining} of {quota.weeklyLimit} weekly checks left
          {quota.resetsAt ? ` · resets ${new Date(quota.resetsAt).toLocaleDateString()}` : ""}
          {topUp > 0 ? ` · +${topUp} bonus checks` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-1 basis-[320px] items-stretch border border-ink">
          <Button
            variant="primary"
            size="wide"
            type="submit"
            className="flex-1"
            disabled={exhausted}
            pending={isSubmitting}
            pendingLabel="RUNNING THE CHECK…"
          >
            RUN THE CHECK
          </Button>
        </div>
      </div>
    </form>
  );
}
