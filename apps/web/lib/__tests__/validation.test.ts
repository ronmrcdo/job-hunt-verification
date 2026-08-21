import { describe, it, expect } from "vitest";
import { submissionSchema, authSchema, createAccountSchema } from "../validation";

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

describe("submissionSchema: text-or-url", () => {
  it("accepts a URL-only submission (empty job_text)", () => {
    const r = submissionSchema.safeParse({ job_text: "", job_url: "https://acme.co/careers/va" });
    expect(r.success).toBe(true);
  });

  it("accepts a text-only submission (no job_url)", () => {
    const r = submissionSchema.safeParse({ job_text: "Virtual Assistant, $2,500/month" });
    expect(r.success).toBe(true);
  });

  it("rejects when both job_text and job_url are empty", () => {
    const r = submissionSchema.safeParse({ job_text: "", job_url: "" });
    expect(r.success).toBe(false);
  });

  it("still rejects an over-long posting", () => {
    const r = submissionSchema.safeParse({ job_text: "x".repeat(40001) });
    expect(r.success).toBe(false);
  });
});

describe("authSchema", () => {
  it("requires a valid email and 8+ char password", () => {
    expect(authSchema.safeParse({ email: "a@b.com", password: "1234567" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "bad", password: "12345678" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });
});

describe("createAccountSchema", () => {
  const base = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    password: "Abcdef12",
    confirmPassword: "Abcdef12",
  };

  it("accepts a complete, complex, matching submission", () => {
    expect(createAccountSchema.safeParse(base).success).toBe(true);
  });

  it("requires a full name", () => {
    const r = createAccountSchema.safeParse({ ...base, fullName: "  " });
    expect(r.success).toBe(false);
  });

  it("rejects a password that fails complexity (no uppercase / number)", () => {
    const r = createAccountSchema.safeParse({
      ...base,
      password: "abcdefgh",
      confirmPassword: "abcdefgh",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "password")).toBe(true);
  });

  it("rejects when confirmation does not match", () => {
    const r = createAccountSchema.safeParse({ ...base, confirmPassword: "Abcdef13" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "confirmPassword")).toBe(true);
  });
});
