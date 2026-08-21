import { z } from "zod";
import { unmetCriteria } from "./password";

// Blank optional strings coerce to undefined so empty inputs don't fail
// url()/email() and aren't sent as "" on insert.
const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const submissionSchema = z
  .object({
    job_text: optionalTrimmed.pipe(z.string().max(40000, "That posting is too long.").optional()),
    company_name: optionalTrimmed,
    recruiter_email: optionalTrimmed.pipe(z.string().email().optional()),
    job_url: optionalTrimmed.pipe(z.string().url().optional()),
  })
  .superRefine((val, ctx) => {
    // A submission needs something to investigate: the pasted posting, or a
    // link we can fetch (spec §11 URL submission).
    if (!val.job_text && !val.job_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["job_text"],
        message: "Paste the posting or add a job link.",
      });
    }
  });
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "At least 8 characters."),
});
export type AuthInput = z.infer<typeof authSchema>;

// Create-account is stricter than sign-in: a real name, a complex password
// (see PASSWORD_CRITERIA), and a matching confirmation. Sign-in keeps the
// lenient authSchema so existing accounts with any 8+ char password still work.
export const createAccountSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your full name."),
    email: z.string().trim().email("Enter a valid email."),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((val, ctx) => {
    const missing = unmetCriteria(val.password);
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: `Password needs ${missing
          .map((c) => c.label.toLowerCase())
          .join(", ")}.`,
      });
    }
    if (val.confirmPassword !== val.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords don't match.",
      });
    }
  });
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
