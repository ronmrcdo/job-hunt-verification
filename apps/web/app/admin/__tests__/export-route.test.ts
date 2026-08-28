import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above the module body, so the spies they close
// over must be created in a hoisted block too.
const { assertAdmin, notFound, pending } = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  pending: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../../../lib/admin/access", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/admin/access")>("../../../lib/admin/access");
  return { ...actual, assertAdmin };
});

vi.mock("../export", async () => {
  const actual = await vi.importActual<typeof import("../export")>("../export");
  return { ...actual, loadPendingCandidates: pending };
});
vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));

import { GET } from "../export/route";
import { AdminAccessError } from "../../../lib/admin/access";

const ID_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  assertAdmin.mockReset();
  pending.mockReset();
  notFound.mockClear();
});

describe("GET /admin/export", () => {
  it("serves the pending candidates as a downloadable file in the script's envelope", async () => {
    assertAdmin.mockResolvedValue("ron@example.com");
    pending.mockResolvedValue({ ok: true, candidates: [{ id: ID_A }] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="eval-candidates-\d{4}-\d{2}-\d{2}\.json"/);
    const body = await res.json();
    expect(body.candidates).toEqual([{ id: ID_A }]);
    expect(typeof body.generated_at).toBe("string");
  });

  it("404s an unauthenticated caller rather than 403 — no existence leak", async () => {
    assertAdmin.mockRejectedValue(new AdminAccessError("nope"));
    await expect(GET()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
  });

  it("fails loudly on a read error instead of serving an empty export", async () => {
    assertAdmin.mockResolvedValue("ron@example.com");
    pending.mockResolvedValue({ ok: false, error: "permission denied" });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-disposition")).toBeNull();
    await expect(res.text()).resolves.toMatch(/permission denied/);
  });
});
