import { describe, expect, it } from "vitest";
import { detectInput } from "../detect";

describe("detectInput", () => {
  it("returns 'empty' for an empty string", () => {
    expect(detectInput("")).toBe("empty");
  });

  it("returns 'empty' for a whitespace-only string", () => {
    expect(detectInput("   ")).toBe("empty");
  });

  it("returns 'link' for an http(s) URL", () => {
    expect(detectInput("https://x.co")).toBe("link");
  });

  it("returns 'link' for a bare host.tld/path form", () => {
    expect(detectInput("acme.com/jobs")).toBe("link");
  });

  it("returns 'text' for a bare domain without a trailing slash", () => {
    expect(detectInput("acme.com")).toBe("text");
  });

  it("returns 'text' for plain posting text", () => {
    expect(detectInput("Virtual Assistant $2500")).toBe("text");
  });
});
