import { describe, it, expect } from "vitest";
import { PASSWORD_CRITERIA, evaluatePassword, unmetCriteria } from "../password";

describe("PASSWORD_CRITERIA", () => {
  it("covers length, lower, upper, and number", () => {
    expect(PASSWORD_CRITERIA.map((c) => c.id)).toEqual([
      "length",
      "lower",
      "upper",
      "number",
    ]);
  });
});

describe("evaluatePassword", () => {
  it("scores 0 with no label for an empty password", () => {
    const r = evaluatePassword("");
    expect(r.score).toBe(0);
    expect(r.label).toBeNull();
  });

  it("scores each satisfied criterion", () => {
    // lowercase only
    expect(evaluatePassword("abc").score).toBe(1);
    // lowercase + number, still under 8 chars
    expect(evaluatePassword("abc1").score).toBe(2);
    // lowercase + upper + number, still under 8 chars
    expect(evaluatePassword("Abc1").score).toBe(3);
    // all four
    expect(evaluatePassword("Abcdef12").score).toBe(4);
  });

  it("labels weak → strong as the score climbs", () => {
    expect(evaluatePassword("abc").label).toBe("Weak"); // 1
    expect(evaluatePassword("abc1").label).toBe("Fair"); // 2
    expect(evaluatePassword("Abc1").label).toBe("Good"); // 3
    expect(evaluatePassword("Abcdef12").label).toBe("Strong"); // 4
  });
});

describe("unmetCriteria", () => {
  it("lists the ids a password does not satisfy", () => {
    expect(unmetCriteria("abcdefgh").map((c) => c.id)).toEqual(["upper", "number"]);
    expect(unmetCriteria("Abcdef12")).toEqual([]);
  });
});
