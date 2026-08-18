import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("design tokens (@theme)", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8").replaceAll(" ", "");
  it("imports tailwind", () => expect(css).toContain('@import"tailwindcss"'));
  it.each([
    "--color-ink:#26282C", "--color-band-high:#E08A55", "--color-critical:#A3241C",
    "--color-surface-soft:#F7F7F5", "--shadow-band:0", "--font-mono:",
  ])("declares %s", (t) => expect(css).toContain(t));
  it("introduces no rounded corners", () => expect(css).not.toMatch(/border-radius:[1-9]/));
});
