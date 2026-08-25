-- M2 (security review 2026-08-26): job_text is already capped 1..40000 by
-- investigations_job_text_chk, but company_name / recruiter_email / job_url
-- and the overall submission blob are unbounded — a client can POST a
-- multi-megabyte field straight to PostgREST (client-side zod is not a trust
-- boundary), inflating worker memory and LLM/Tavily cost. Bound the whole blob
-- and each optional field at the DB, the real trust boundary for the V1 path.
-- Idempotent: drop-then-add so re-running db push --include-all is safe.
alter table investigations drop constraint if exists investigations_submission_size_chk;
alter table investigations add constraint investigations_submission_size_chk
  check (
    char_length(submission::text) <= 60000
    and char_length(coalesce(submission->>'company_name', '')) <= 200
    and char_length(coalesce(submission->>'recruiter_email', '')) <= 320
    and char_length(coalesce(submission->>'job_url', '')) <= 2048
  );
