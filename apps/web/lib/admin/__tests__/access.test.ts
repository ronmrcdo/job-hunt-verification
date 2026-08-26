import { describe, it, expect, vi, beforeEach } from "vitest";

const jwtVerify = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: () => () => Promise.resolve({}),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

import { resolveAdminEmail, AdminAccessError } from "../access";

const HEADER = "cf-access-jwt-assertion";

describe("resolveAdminEmail", () => {
  beforeEach(() => {
    jwtVerify.mockReset();
    process.env.CF_ACCESS_TEAM_DOMAIN = "myteam.cloudflareaccess.com";
    process.env.CF_ACCESS_AUD = "aud-123";
  });

  it("throws AdminAccessError when the assertion header is absent", async () => {
    await expect(resolveAdminEmail(new Headers())).rejects.toBeInstanceOf(AdminAccessError);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("throws AdminAccessError when jose rejects the token", async () => {
    jwtVerify.mockRejectedValue(new Error("bad signature"));
    const h = new Headers({ [HEADER]: "tampered.jwt.here" });
    await expect(resolveAdminEmail(h)).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("returns the email claim for a valid assertion", async () => {
    jwtVerify.mockResolvedValue({ payload: { email: "ron@example.com" } });
    const h = new Headers({ [HEADER]: "good.jwt.here" });
    await expect(resolveAdminEmail(h)).resolves.toBe("ron@example.com");
    expect(jwtVerify).toHaveBeenCalledWith(
      "good.jwt.here",
      expect.any(Function),
      expect.objectContaining({ audience: "aud-123" }),
    );
  });

  it("throws when a verified token carries no email claim", async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: "no-email" } });
    const h = new Headers({ [HEADER]: "good.jwt.here" });
    await expect(resolveAdminEmail(h)).rejects.toBeInstanceOf(AdminAccessError);
  });
});
