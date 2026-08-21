-- supabase/migrations/20260822010000_submission_url_or_text.sql
-- Relax the submission content check so a user can submit a job LINK with no
-- pasted text (spec §11 URL submission; the url_fetch node retrieves it). The
-- old constraint required job_text present with length 1..40000; now a
-- submission satisfies the check with either a valid-length job_text OR a
-- non-empty job_url. The 40000 cap mirrors settings.max_job_text_chars.
-- OPERATOR: apply after 20260822000000_investigations_entities.sql.

alter table investigations drop constraint if exists investigations_job_text_chk;

alter table investigations add constraint investigations_submission_content_chk
  check (
    (submission ? 'job_text' and char_length(submission->>'job_text') between 1 and 40000)
    or (submission ? 'job_url' and char_length(submission->>'job_url') > 0)
  );
