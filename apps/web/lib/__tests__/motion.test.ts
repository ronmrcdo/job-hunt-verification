import { describe, it, expect } from "vitest";
import { screenEnter, staggerParent, expandVariants } from "../motion";

describe("motion presets", () => {
  it("screenEnter uses the shared SPRING ease curve", () => {
    expect(screenEnter.ease).toEqual([0.22, 1, 0.36, 1]);
  });

  it("staggerParent staggers children by 0.08s", () => {
    expect(staggerParent.visible.transition.staggerChildren).toBe(0.08);
  });

  it("expandVariants opens to auto height", () => {
    expect(expandVariants.open.height).toBe("auto");
  });
});
