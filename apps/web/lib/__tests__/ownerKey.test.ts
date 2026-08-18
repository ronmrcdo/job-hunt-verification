import { describe, it, expect, beforeEach } from "vitest";
import { getOwnerKey } from "../ownerKey";

describe("getOwnerKey", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("generates a non-empty key on first use", () => {
    const key = getOwnerKey();
    expect(key).toBeTruthy();
    expect(key.length).toBeGreaterThan(0);
  });

  it("persists the same key across calls (stable per browser)", () => {
    const first = getOwnerKey();
    const second = getOwnerKey();
    expect(second).toBe(first);
  });

  it("persists the key in localStorage so a reload reuses it", () => {
    const key = getOwnerKey();
    expect(window.localStorage.getItem("jhv_owner_key")).toBe(key);
  });

  it("generates different keys for different browsers (no shared storage)", () => {
    const a = getOwnerKey();
    window.localStorage.clear();
    const b = getOwnerKey();
    expect(a).not.toBe(b);
  });
});
