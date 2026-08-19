import { describe, it, expect } from "vitest";
import { submissionSchema, authSchema } from "../validation";

describe("submissionSchema", () => {
  it("requires non-empty job_text within 40000 chars", () => {
    expect(submissionSchema.safeParse({ job_text: "" }).success).toBe(false);
    expect(submissionSchema.safeParse({ job_text: "a".repeat(40001) }).success).toBe(false);
    expect(submissionSchema.safeParse({ job_text: "real posting" }).success).toBe(true);
  });
  it("accepts optional company/email/url and rejects a malformed email", () => {
    expect(
      submissionSchema.safeParse({ job_text: "x", recruiter_email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({ job_text: "x", company_name: "Acme", job_url: "https://acme.com" })
        .success,
    ).toBe(true);
  });
  it("treats blank optional fields as absent", () => {
    const r = submissionSchema.safeParse({ job_text: "x", recruiter_email: "", job_url: "" });
    expect(r.success).toBe(true);
  });
});

describe("authSchema", () => {
  it("requires a valid email and 8+ char password", () => {
    expect(authSchema.safeParse({ email: "a@b.com", password: "1234567" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "bad", password: "12345678" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });
});
