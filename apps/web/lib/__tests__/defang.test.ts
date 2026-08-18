import { describe, it, expect } from "vitest";
import { defang } from "../defang";

describe("defang", () => {
  it("neutralizes scheme and dots", () => {
    expect(defang("https://acme-globall.com/pay")).toBe("hxxps://acme-globall[.]com/pay");
  });

  it("returns the original string unchanged when it is not a valid URL", () => {
    expect(defang("not-a-url")).toBe("not-a-url");
  });
});
