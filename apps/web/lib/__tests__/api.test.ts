import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInvestigation, FetchError } from "../api";

describe("createInvestigation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /investigations with X-Owner-Key header and snake_case body, returning {id} on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "abc" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createInvestigation({ jobText: "x" }, "key");

    expect(result).toEqual({ id: "abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/investigations$/);
    expect(options.headers["X-Owner-Key"]).toBe("key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.job_text).toBe("x");
    expect(Object.keys(body)).not.toContain("conversation");
    expect(Object.keys(body)).not.toContain("companyWebsite");
    expect(Object.keys(body)).not.toContain("recruiterName");
    const allowedKeys = ["job_text", "company_name", "recruiter_email", "job_url"];
    for (const key of Object.keys(body)) {
      expect(allowedKeys).toContain(key);
    }
  });

  it("throws FetchError on non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(createInvestigation({ jobText: "x" }, "key")).rejects.toThrow(FetchError);

    const fetchMock2 = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = fetchMock2 as unknown as typeof fetch;

    try {
      await createInvestigation({ jobText: "x" }, "key");
      expect.fail("expected createInvestigation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).name).toBe("FetchError");
      expect((err as FetchError).status).toBe(500);
    }
  });
});
