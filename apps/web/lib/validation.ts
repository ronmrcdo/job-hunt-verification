import { z } from "zod";

// Blank optional strings coerce to undefined so empty inputs don't fail
// url()/email() and aren't sent as "" on insert.
const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const submissionSchema = z.object({
  job_text: z.string().trim().min(1, "Paste the posting.").max(40000, "That posting is too long."),
  company_name: optionalTrimmed,
  recruiter_email: optionalTrimmed.pipe(z.string().email().optional()),
  job_url: optionalTrimmed.pipe(z.string().url().optional()),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "At least 8 characters."),
});
export type AuthInput = z.infer<typeof authSchema>;
