# Job Legitimacy Investigator — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Job Legitimacy Investigator's full UI (landing → auth gate → details → scripted progress → result, plus LOW variant, fetch-error and prior-check states, and mobile layouts) inside the existing `apps/web` Next.js app, faithful to the high-fidelity design handoff, wired to the real (posting-only, synchronous) backend.

**Architecture:** App Router routes for each screen (`/`, `/sign-in`, `/check/new`, `/check/running`, `/report/[id]`). A single client **flow context** (sessionStorage-backed) carries the pasted posting and auth state across the gate. A single **API service module** talks to the real `POST/GET /investigations`. A typed **view-model adapter** reconciles the real `InvestigationResponse` into the richer shape the report design assumes, with static copy maps for the fields the V0 API does not yet return. Styling is **Tailwind CSS v4** (CSS-first `@theme` holding the design tokens); motion is **Framer Motion** variants on the spec's spring curve, with `useReducedMotion()` shipped alongside each animation.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, **Tailwind CSS v4** (`@tailwindcss/postcss`, CSS-first `@theme` tokens), **Framer Motion** (`framer-motion`), `next/font/google` (JetBrains Mono), Vitest + @testing-library/react (jsdom). Existing helpers: `lib/defang.ts`, `lib/ownerKey.ts`, `@job-hunt/api-types`.

**Spec:** `~/Downloads/Prototype design options/design_handoff_job_legitimacy_investigator/README.md` (the handoff — source of truth for flow, copy, tokens). Companion design references in the same folder: `Investigator Prototype.dc.html` (interactive flow/copy — **the canonical source for verbatim finding/source copy**, transcribe from it) and `Job Legitimacy Investigator.dc.html` §4a·chosen (static per-screen specs incl. 390px mobile). `support.js` in that folder holds the prototype's fixture data (findings, checklist, steps) — transcribe fixtures from it.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Design authority beats generic taste.** The handoff tokens are final and override any default from the `redesign-existing-projects` skill that conflicts. Specifically, DO NOT: swap the font (Helvetica/Arial body + JetBrains Mono only), add border-radius (everything is `0px` — use `rounded-none`), add box-shadows except the four band cards (`shadow-band` = `0 1px 2px rgba(38,40,44,0.06)`), add noise/grain/gradients/placeholder imagery, introduce a second accent color, or add asymmetric "zig-zag" layout. Apply the design skills only where the handoff is silent: interaction states (`hover:`/`active:`/`focus-visible:`), motion craft, reduced-motion, component decomposition, and React performance.

**Styling & motion conventions (authoritative — this supersedes any `*.module.css` / raw-`@keyframes` / `prefers-reduced-motion`-in-CSS phrasing that appears in later tasks):**
- **Styling = Tailwind utility classes.** Map every design token into the Tailwind v4 `@theme` block (Task 1.1) so tokens are available both as utilities (`bg-ink`, `text-muted`, `border-rule`, `bg-surface-soft`, `font-mono`) and as CSS vars (`var(--color-ink)`). Exact spec numbers with no token (type scale, field heights, grid columns) use **arbitrary values** (`text-[72px] leading-[0.94] tracking-[-0.045em]`, `min-h-[118px]`, `grid-cols-[54px_6px_1fr_26px]`). A component `*.module.css` file is created **only** for a selector Tailwind genuinely can't express; default to zero CSS files per component.
- **Motion = Framer Motion.** Screen entrances, hero/step **stagger**, finding-card **expand** (animate `height:auto`), tooltip origin-scale, and screen transitions (`AnimatePresence`) use `motion.*` components + shared **variants/transitions from `lib/motion.ts`** (Task 1.2). Never invent curves/durations — use the presets. `active:` press feedback on buttons can stay a Tailwind utility (`active:scale-[0.98]`); everything richer is Framer Motion.
- **Reduced motion ships with each animation** via Framer Motion's `useReducedMotion()` (the `lib/motion.ts` helpers return zero-movement variants when it's true). Do not rely on a global CSS media query.

**Product rules — non-negotiable (handoff "Product rules"), enforced by a guardrail test suite (Task 2.6):**
1. Risk is a **band** (LOW/MODERATE/HIGH/CRITICAL) — never a %, score/100, gauge, speedometer, radar, or letter grade.
2. **Confidence is separate** from band (Low/Medium/High) with a tooltip explaining it derives from how much could be verified.
3. Saturated alarm color (`--critical #A3241C`) is **CRITICAL only**. HIGH is serious (`--band-high`), not apocalyptic. LOW is calm — no confetti, no green-check hero, still shows caveats.
4. Suspicious URLs are **always defanged** (`hxxps://acme-globall[.]com`, `acme-globall[.]com`) and **never** rendered as `<a href>` / links anywhere.
5. Any finding from a user-pasted conversation carries a visible provenance label: "Based on the conversation you shared — we can't independently verify it."
6. "What we couldn't verify" is visually **neutral** — body weight, grey marker, light-grey background; never reads as a warning.
7. Copy is hedged/specific ("signals consistent with known scam patterns", never "this is a scam"); no legal-certainty claim; buttons say what happens ("Start investigation", not "Submit").
8. No skull/siren/shield/detective/noir/red-fear iconography. Every mark is a CSS rectangle; no image assets.

**Design tokens (authoritative — defined once in `globals.css`, Task 1.1):**

Colors: `--ink #26282C` · `--ink-hover #3D4046` · `--ink-muted #4A4D53` · `--body #1A1A1A` · `--secondary #444444` · `--muted #666666` · `--faint #888888` · `--page #FFFFFF` · `--surface-soft #F7F7F5` · `--surface-alt #FAFAF8` · `--neutral-row #FAFAFA` · `--rule #EDEDEA` · `--rule-soft #E8E8E5` · `--legit #3F6B4A` · `--suspicious #A8501F` · `--critical #A3241C` · `--critical-tint #FDF7F4` · `--critical-rule #E6C3BF` · `--warn-tint #FBF2EC` · `--warn-rule #E4CBB9` · `--band-low #8FB79C` · `--band-moderate #C79A4A` · `--band-high #E08A55` · `--band-high-on-white #B96A34` · `--band-critical #C6413A`.

Motion (encode as Framer Motion transitions/variants in `lib/motion.ts`): spec ease `cubic-bezier(.22,1,.36,1)` → `ease: [0.22, 1, 0.36, 1]`. Screen change = opacity 420ms + translateY(16px→0) 620ms. Entrance stagger 70–90ms between siblings (`staggerChildren: 0.08`; hero explicit delays: eyebrow 40ms, headline 110ms, copy 190ms, field 270ms, rail 360ms). Finding expand = `height` auto 620ms + opacity 380ms. Color/background transitions 220–400ms. **Every animation reads `useReducedMotion()` and falls back to an immediate, movement-free reveal.**

Spacing: 4px base. Section padding 44–64px vertical / 32px horizontal, `max-width: 1240px` centered. Card padding 18–22px. Field padding 13–16px. Border-radius `0` everywhere.

**API reconciliation (V0 reality — the real backend is posting-only and synchronous; see `apps/api/src/app/main.py`):**
- `POST /investigations` (header `X-Owner-Key`, body `{ job_text, company_name?, recruiter_email?, job_url? }`) **runs the whole graph in-request (~90s)** and returns `{ id }` (201). There is **no streaming and no progress endpoint** → the progress screen is a **client-side scripted animation** shown while the single POST promise is in flight; on resolve, route to the report. There is **no auth backend** → the sign-in gate is **client state only** (privacy already comes from the per-browser owner key). Conversation paste, company website, and recruiter name are **not accepted by the V0 API** (conversation node is dormant per the build spec) → the UI collects them (design shows them) but the service module sends only the four supported fields; document this at the send site.
- `GET /investigations/{id}` (header `X-Owner-Key`) returns `InvestigationResponse`: `{ id, status, assessment: {band, confidence: 'LOW'|'MODERATE'|'HIGH', summary, coverage} | null, findings: Finding[], sources: Source[], cost, check_count?: number|null, what_to_verify?: string[] }`. The richer report fields the design assumes are **not** in this response and are derived client-side by the adapter (Task 2.1): `bandMeaning` + `confidenceNote` (static copy maps), the record ids `F-0n` (from finding order), the `repeatChecks` line (from `check_count`; there is no `lastCheckedAt` → show count only), and the submitted-data grid (carried through flow state from the form; on a cold URL load it is absent → those rows are omitted). `Finding.mitigation` is the design's "However" block. `Finding.provenance === 'user_provided_unverified'` triggers the provenance label. `Source` maps: name ← defanged `url` (or a label from `kind`), stamp ← `retrieved_at`, excerpt ← `raw_excerpt ?? content_summary`.

**Testing conventions:** Vitest + @testing-library/react, jsdom (already configured in `vitest.config.ts` / `vitest.setup.ts`). Tailwind classes render as plain `class` strings under vitest (PostCSS doesn't run in the test), so **assert on roles, accessible names, visible text, and `data-*`/`aria-*`/inline `style` attributes — never on Tailwind class names.** Where a test must read visual state (band fill, filled segments, severity color, checked ticks, mobile order), expose an explicit `data-*` hook on the element and assert that. Enforce product rules with queries (e.g. `container.querySelector('a[href]')` must be null in report trees). **Framer Motion in jsdom:** add `import { MotionGlobalConfig } from "framer-motion"; MotionGlobalConfig.skipAnimations = true;` to `vitest.setup.ts` (Task 1.2) so `motion.*` components mount at their target state synchronously and `AnimatePresence` children appear/disappear deterministically; assert on the resulting DOM, not on animation frames. Each task is TDD: write the failing test, run it red, implement minimally, run it green. Per user preference: **no commit steps**, testing folded into each phase.

---

## File Structure

**Foundation & shared:**
- `apps/web/postcss.config.mjs` (create) — `{ plugins: { "@tailwindcss/postcss": {} } }`.
- `apps/web/package.json` (modify) — add deps `tailwindcss`, `@tailwindcss/postcss`, `framer-motion`.
- `app/globals.css` (create) — `@import "tailwindcss";` + `@theme { … }` design tokens + base layer reset.
- `app/layout.tsx` (modify) — load JetBrains Mono via `next/font`, import `globals.css`, set body base classes.
- `lib/motion.ts` (create) — Framer Motion shared transitions + variants (screen-enter, stagger parent/child, finding-expand, tooltip origin-scale) and reduced-motion-aware helpers built on `useReducedMotion()`.
- `components/ui/` (create) — `Button`, `TextField`, `TextArea`, `MicroLabel`, `SegmentBar`, `Tooltip`, `DefangedText` (Tailwind classes; `motion.*` where animated; colocated `__tests__`).

**Data layer:**
- `lib/api.ts` (modify) — add `createInvestigation`; keep `fetchInvestigation`.
- `lib/detect.ts` (create) — `detectInput(value): 'link' | 'text' | 'empty'`.
- `lib/format.ts` (create) — mono date/time/count formatting.
- `lib/report-view-model.ts` (create) — `toReportViewModel()` + copy maps + types.
- `lib/flow-context.tsx` (create) — `FlowProvider` + `useFlow()` (sessionStorage-backed).
- `lib/__fixtures__/sample-high.ts`, `sample-low.ts` (create) — `InvestigationResponse` + submitted fixtures.
- `lib/__tests__/product-rules.test.tsx` (create) — cross-cutting guardrail suite.

**Screens & sections:**
- `app/page.tsx` (create) — Landing. Sections in `components/landing/`.
- `app/sign-in/page.tsx` (create) — Auth gate. `components/auth/`.
- `app/check/new/page.tsx` (create) — Details step. `components/details/`.
- `app/check/running/page.tsx` (create) — Scripted progress. `components/progress/`.
- `app/report/[id]/page.tsx` (create) — Result. `components/report/` (rebuild existing).
- `app/investigations/[id]/page.tsx` (modify) — redirect to `/report/[id]` (preserve old links).
- `components/site/SiteHeader.tsx` (create) — sticky header shared by landing/auth/details.

**Rebuilt report components** (replace current stubs): `components/report/BandBanner.tsx`, `ConfidencePanel.tsx`, `SubmittedGrid.tsx`, `Summary.tsx`, `FindingCard.tsx`, `FindingGroup.tsx` (rebuild), `CountsStrip.tsx`, `VerifyChecklist.tsx` (rebuild → tickable), `ReportFooter.tsx`, `ReportRail.tsx`, `SourceList.tsx` (rebuild). `BandBadge.tsx` is superseded by `BandBanner.tsx` — delete it and its test.

---

## Phase 1 — Foundation: tokens, fonts, motion, UI primitives

**Skills to load first:** `apple-design` (feedback-on-press, `:active`, reduced-motion, tokens), `emil-design-eng` (transition specificity, `ease-out` for entrances, origin-aware popovers), `vercel-react-best-practices` (keep primitives client-cheap, no barrel imports).

Establishes the shared design spine every screen consumes. Build the tokens, wire fonts, and the primitive kit with their interaction states and reduced-motion baked in.

### Task 1.1: Install Tailwind v4 + Framer Motion, define `@theme` tokens, wire fonts

**Files:**
- Create: `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`
- Modify: `apps/web/package.json` (deps), `apps/web/app/layout.tsx`
- Test: `apps/web/app/__tests__/tokens.test.tsx`

**Interfaces:**
- Produces: a working Tailwind v4 pipeline where every design token exists as a utility (`bg-ink`, `text-muted`, `border-rule`, `bg-surface-soft`, `bg-band-high`, `font-mono`, `shadow-band`) and CSS var (`var(--color-ink)`). `globals.css` = `@import "tailwindcss";` then a `@theme` block declaring the tokens, then a `@layer base` reset. Fonts: `--font-sans: Helvetica, Arial, sans-serif`; `--font-mono` from `next/font` (JetBrains Mono 400/500). No component styling lives here.

- [ ] **Step 1: Install deps.** `pnpm --filter @job-hunt/web add -D tailwindcss @tailwindcss/postcss` and `pnpm --filter @job-hunt/web add framer-motion`. Create `postcss.config.mjs`: `export default { plugins: { "@tailwindcss/postcss": {} } };`. (Tailwind v4 needs no `tailwind.config.js`; content is auto-detected.)

- [ ] **Step 2: Write the failing test.** `tokens.test.tsx` reads `globals.css` and asserts the token declarations exist and no rounded corners are introduced:

```tsx
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("design tokens (@theme)", () => {
  const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8").replaceAll(" ", "");
  it("imports tailwind", () => expect(css).toContain('@import"tailwindcss"'));
  it.each([
    "--color-ink:#26282C", "--color-band-high:#E08A55", "--color-critical:#A3241C",
    "--color-surface-soft:#F7F7F5", "--shadow-band:0", "--font-mono:",
  ])("declares %s", (t) => expect(css).toContain(t));
  it("introduces no rounded corners", () => expect(css).not.toMatch(/border-radius:[1-9]/));
});
```

- [ ] **Step 3: Run red.** `pnpm --filter @job-hunt/web test tokens` → FAIL (file missing).

- [ ] **Step 4: Implement `globals.css`.** `@import "tailwindcss";` then:

```css
@theme {
  --color-ink: #26282C; --color-ink-hover: #3D4046; --color-ink-muted: #4A4D53;
  --color-body: #1A1A1A; --color-secondary: #444444; --color-muted: #666666; --color-faint: #888888;
  --color-page: #FFFFFF; --color-surface-soft: #F7F7F5; --color-surface-alt: #FAFAF8; --color-neutral-row: #FAFAFA;
  --color-rule: #EDEDEA; --color-rule-soft: #E8E8E5;
  --color-legit: #3F6B4A; --color-suspicious: #A8501F;
  --color-critical: #A3241C; --color-critical-tint: #FDF7F4; --color-critical-rule: #E6C3BF;
  --color-warn-tint: #FBF2EC; --color-warn-rule: #E4CBB9;
  --color-band-low: #8FB79C; --color-band-moderate: #C79A4A; --color-band-high: #E08A55;
  --color-band-high-on-white: #B96A34; --color-band-critical: #C6413A;
  --font-sans: Helvetica, Arial, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, "JetBrains Mono", monospace;
  --shadow-band: 0 1px 2px rgba(38,40,44,0.06);
}
@layer base {
  body { @apply bg-page text-body antialiased; font-family: var(--font-sans); }
}
```

- [ ] **Step 5: Wire fonts in `layout.tsx`.** `next/font/google`'s `JetBrains_Mono` (subsets `["latin"]`, weights `["400","500"]`, `variable: "--font-jetbrains-mono"`, `display:"swap"`); import `./globals.css`; put the font variable class on `<html>`. (If the build environment blocks font download, drop `next/font` and keep the `--font-mono` fallback stack already in `@theme` — the mono still resolves.)

- [ ] **Step 6: Run green.** Same command → PASS.

### Task 1.2: Motion presets (`lib/motion.ts`) + test setup + `Button` primitive

**Files:** Create `apps/web/lib/motion.ts`, `apps/web/components/ui/Button.tsx`; Modify `apps/web/vitest.setup.ts`; Test `apps/web/components/ui/__tests__/Button.test.tsx`, `apps/web/lib/__tests__/motion.test.ts`.

**Interfaces:**
- Produces `lib/motion.ts`: `SPRING = { ease: [0.22, 1, 0.36, 1] as const }`; transition presets `screenEnter` (`{ ...SPRING, duration: 0.62 }`), `fade` (`{ duration: 0.42 }`), `expand` (`{ ...SPRING, duration: 0.62 }`), `colorShift` (`{ duration: 0.3 }`); variants `screenEnterVariants` (`hidden:{opacity:0,y:16}` / `visible:{opacity:1,y:0}`), `staggerParent` (`visible:{transition:{staggerChildren:0.08}}`), `expandVariants` (`collapsed:{height:0,opacity:0}` / `open:{height:"auto",opacity:1}`); and a hook `useMotion()` that reads Framer Motion's `useReducedMotion()` and, when reduced, returns movement-free variants (opacity-only or instant) + zero-duration transitions. Components consume these — they never inline curves.
- Produces `Button({ variant?: 'primary'|'secondary', size?: 'md'|'wide', ...props })`: `primary` = `bg-ink text-page hover:bg-ink-hover`, `secondary` = `border border-ink bg-transparent`, both `rounded-none active:scale-[0.98] transition-transform` (press feedback, apple-design §1). `wide` = uppercase tracked label (`text-[14px] font-bold tracking-[0.1em] px-[19px] py-[15px]`). Renders a real `<button>`, `type` default `"button"`, forwards `onClick`/`disabled`/`aria-*`.

- [ ] **Step 1: Failing tests.** `motion.test.ts`: `screenEnter.ease` equals `[0.22,1,0.36,1]`; `staggerParent.visible.transition.staggerChildren === 0.08`; `expandVariants.open.height === "auto"`. `Button.test.tsx`: renders `<Button>Start investigation</Button>` → `role="button"` with that name; `variant="secondary"` still a button; click handler fires.
- [ ] **Step 2: Add `MotionGlobalConfig.skipAnimations = true` to `vitest.setup.ts`** (so `motion.*`/`AnimatePresence` resolve to target state synchronously in jsdom).
- [ ] **Step 4: Run red.**
- [ ] **Step 5: Implement** `lib/motion.ts` + `Button` with the Tailwind classes above (`active:scale-[0.98]`, `rounded-none`, no shadow).
- [ ] **Step 6: Run green.**

### Task 1.3: `TextField` + `TextArea` primitives

**Files:** Create `components/ui/TextField.tsx`, `TextArea.tsx`; Test `components/ui/__tests__/Field.test.tsx`.

**Interfaces:**
- Produces: `TextField({ label, value, onChange, mono?, placeholder, type?, rightSlot?, minWidth? })` and `TextArea({ label, value, onChange, mono?, placeholder, minHeight?, rightSlot? })`. `label` renders a micro label (`text-[10px] uppercase tracking-[0.12em] text-muted`); `rightSlot` is a right-aligned node in the label row (used for the live detection state). Control: `border border-ink rounded-none` (or `border-rule` for secondary fields), `p-[13px]`, `mono` → `font-mono text-[14px] leading-[1.6]`. Associates `<label htmlFor>`/`id` for a11y.

- [ ] **Step 1: Failing test** — `TextField` with `label="Job link or job text"` exposes an input with that accessible name; typing calls `onChange` with the value; `rightSlot` content renders. `TextArea` renders a `textbox` with the label.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** both with Tailwind classes; generate an `id` (`useId`) to link label+control.
- [ ] **Step 4: Run green.**

### Task 1.4: `MicroLabel` + `SegmentBar`

**Files:** Create `components/ui/MicroLabel.tsx`, `SegmentBar.tsx`; Test `components/ui/__tests__/SegmentBar.test.tsx`.

**Interfaces:**
- Produces: `MicroLabel({ children, tone? })` → `text-[10px] uppercase tracking-[0.15em] text-muted` (or `tone` override). `SegmentBar({ total, filled, fillColor, emptyColor, ariaHidden? })` → renders `total` rectangular segments (`flex rounded-none` with a thin gap), first `filled` painted `fillColor`, rest `emptyColor` (colors passed as inline `style.background` so any token works). Used for the 4-segment band bar (fill `--color-band-high`, empty `--color-ink-muted`) **and** the 3-segment confidence meter. Decorative → `aria-hidden` by default (band/confidence value is conveyed as text elsewhere).

- [ ] **Step 1: Failing test** — `SegmentBar total={4} filled={3}` renders 4 segments, exactly 3 with the fill color (assert via inline `style.background` / `data-filled`); confidence `total={3} filled={2}` → 2 filled. Assert the container is `aria-hidden`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** with a `data-filled="true|false"` attribute per segment so tests read state without class names.
- [ ] **Step 4: Run green.**

### Task 1.5: `Tooltip` (confidence `?` affordance) + `DefangedText`

**Files:** Create `components/ui/Tooltip.tsx`, `components/ui/DefangedText.tsx`; Test `components/ui/__tests__/Tooltip.test.tsx`, `DefangedText.test.tsx`.

**Interfaces:**
- Produces: `Tooltip({ label, children })` — a `?` trigger button (`aria-expanded`, `aria-controls`) toggling a panel containing `children`; opens on click and focus, closes on Escape/blur. The panel is a Framer Motion `motion.div` inside `AnimatePresence`, `style={{ transformOrigin: "top left" }}` (origin-aware, emil-design-eng), animating `opacity` + `scale` 0.96→1 with a fast `easeOut` (`{ duration: 0.15 }`); `useMotion()` collapses it to an instant show under reduced motion. `DefangedText({ value })` — renders `defang(value)` from `lib/defang.ts` as **plain inert text inside a `<span>` (never an `<a>`)**; product-rule #4.

- [ ] **Step 1: Failing tests.** Tooltip: `?` button has accessible name from `label`; panel hidden initially, shown after click (`aria-expanded="true"`), hidden after Escape. DefangedText: `value="https://acme-globall.com/x"` → text contains `hxxps://acme-globall[.]com`, and `container.querySelector("a")` is `null`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run green.**

---

## Phase 2 — Data layer: adapter, flow state, fixtures, guardrails

**Skills to load first:** `vercel-react-best-practices` (context/state without waterfalls, minimal re-renders), `emil-design-eng` (only tangential here).

The reconciliation spine. Everything downstream renders from the view-model; the flow context carries cross-route state; fixtures + the guardrail suite lock the product rules. Heavy TDD — this phase has the most logic.

### Task 2.1: Report view-model adapter + copy maps

**Files:** Create `apps/web/lib/report-view-model.ts`; Test `apps/web/lib/__tests__/report-view-model.test.ts`.

**Interfaces:**
- Consumes: `Investigation` (= `InvestigationResponse`) from `lib/api`; optional `submitted` (`{ jobTitle?, company?, recruiter?, contactChannel?, email? }`) from flow state.
- Produces:
```ts
export type ConfidenceLevel = "Low" | "Medium" | "High";
export interface SourceVM { name: string; stampMono: string; excerpt: string; defang: boolean; }
export interface FindingVM {
  recordId: string;            // "F-01"… by order
  direction: "legitimizing" | "suspicious" | "unverifiable";
  severity: "info"|"low"|"medium"|"high"|"critical"|null;
  claim: string;
  metaLine: string;            // "SUSPICIOUS · SEVERITY HIGH · 3 SOURCES"
  provenanceLabel: string | null; // set iff provenance === "user_provided_unverified"
  however: string | null;      // from Finding.mitigation
  sources: SourceVM[];
}
export interface ReportVM {
  caseId: string; band: "LOW"|"MODERATE"|"HIGH"|"CRITICAL"; bandIndex: number; // 1..4
  bandMeaning: string; confidence: ConfidenceLevel; confidenceSegments: number; // 1..3
  confidenceNote: string; summary: string;
  repeatLine: string;          // "CHECKED 3 TIMES IN THE PAST WEEK" | "FIRST CHECK ON THIS POSTING"
  submitted: { label: string; value: string; mono?: boolean }[]; // omit rows we don't have
  groups: { key: "legitimizing"|"suspicious"|"unverifiable"; heading: string; countMono: string; findings: FindingVM[] }[]; // empty groups omitted
  verifyChecklist: string[];
}
export function toReportViewModel(inv: Investigation, submitted?: Submitted): ReportVM;
export const BAND_MEANING: Record<Band, string>;      // exact sentences, see below
export const CONFIDENCE_NOTE: Record<ConfidenceLevel, string>;
```
- Static maps (exact copy from handoff; HIGH/LOW verbatim, MODERATE/CRITICAL written in the same hedged register):
  - `BAND_MEANING.HIGH` = "Multiple signals here match patterns common in job scams. Treat it with caution and verify independently before acting." (transcribe the prototype's exact band-meaning line if present; otherwise this hedged sentence.)
  - `BAND_MEANING.LOW` = "Nothing here matches the scam patterns we check for, and the company and posting line up with each other. That isn't a guarantee — two things below stayed unverified."
  - `CONFIDENCE_NOTE.Medium` = "Some claims rested on sources we couldn't fully reach."; `.High` = "Most claims were confirmed against sources that responded directly."; `.Low` = "Much of this rested on material we couldn't check independently."
- Mapping rules: `confidence` LOW→"Low"/1, MODERATE→"Medium"/2, HIGH→"High"/3. `bandIndex` LOW1 MOD2 HIGH3 CRIT4. `recordId` = `F-` + 2-digit (order across the whole findings array as returned). `metaLine` = `[DIRECTION label] · SEVERITY {severity}` (omit severity when null/info) ` · {n} SOURCES` (omit when 0). Direction labels: legitimizing→"SUPPORTS LEGITIMACY", suspicious→"SUSPICIOUS", unverifiable→"UNVERIFIED". `provenanceLabel` = "Based on the conversation you shared — we can't independently verify it." iff `provenance === "user_provided_unverified"`. Groups ordered legitimizing→suspicious→unverifiable; headings "What checks out"/"What looks suspicious"/"What we couldn't verify"; `countMono` = 2-digit count; **omit empty groups**. `repeatLine` from `check_count` (`>0` → "CHECKED {n} TIMES IN THE PAST WEEK", else "FIRST CHECK ON THIS POSTING"). `submitted` includes only rows present in `submitted` arg (email row `mono:true`). Source `name` = `defang(url)` when url present (`defang:true`) else a label from `kind` (`whois`→"registrar record", `dns`→"mail records", `user_provided`→"conversation you shared", `fetched_page`/`search_result`→host of url or "web source"); `stampMono` = `formatStamp(retrieved_at)` (Task 2.2); `excerpt` = `raw_excerpt ?? content_summary`.

- [ ] **Step 1: Failing test** using the HIGH fixture (Task 2.4) — assert `band==="HIGH"`, `bandIndex===3`, `confidence==="Medium"`, `confidenceSegments===2`; groups length 3 with counts `"02"/"03"/"02"`; the suspicious group's critical finding has `provenanceLabel !== null` and `severity==="critical"`; the cross-post finding has `however !== null`; record ids run `F-01`…`F-07`; a legitimizing finding's `metaLine` starts `"SUPPORTS LEGITIMACY"`. Then the LOW fixture — assert `groups` has **no** suspicious group (empty omitted), `confidence==="High"`, `bandIndex===1`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** `toReportViewModel` + maps.
- [ ] **Step 4: Run green.**

### Task 2.2: Formatting + input detection utils

**Files:** Create `apps/web/lib/format.ts`, `apps/web/lib/detect.ts`; Test `apps/web/lib/__tests__/format.test.ts`, `detect.test.ts`.

**Interfaces:**
- Produces: `formatStamp(iso: string): string` → `"Retrieved 18.08.2026"` (dd.mm.yyyy). `formatCaseStamp(iso, caseId): string` → `"18.08.2026 · 09:43 PDT · CASE {caseId}"`. `pad2(n): string`. `detectInput(value: string): "empty"|"link"|"text"` — trimmed empty→"empty"; matches `/^https?:\/\//i` or `/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i` (host.tld/…) →"link"; else "text".
- [ ] **Step 1: Failing tests** — `detectInput("")→"empty"`, `detectInput("https://x.co")→"link"`, `detectInput("acme.com/jobs")→"link"`, `detectInput("Virtual Assistant $2500")→"text"`; `formatStamp("2026-08-18T00:00:00Z")` contains `"18.08.2026"`; `pad2(3)==="03"`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 2.3: API service — add `createInvestigation`

**Files:** Modify `apps/web/lib/api.ts`; Test `apps/web/lib/__tests__/api.test.ts`.

**Interfaces:**
- Produces: `createInvestigation(input: CreateInput, ownerKey: string): Promise<{ id: string }>` where `CreateInput = { jobText: string; companyName?: string; recruiterEmail?: string; jobUrl?: string }`. POSTs to `${base}/investigations` with `X-Owner-Key` + JSON body `{ job_text, company_name, recruiter_email, job_url }` (snake_case; **only these four fields** — comment that conversation/site/recruiter-name are collected but unsupported by the V0 API). Throws `FetchError` (a named subclass) on non-2xx so the landing can show the fetch-error panel. Keep `fetchInvestigation` unchanged.
- [ ] **Step 1: Failing test** — stub `global.fetch`; assert `createInvestigation({jobText:"x"},"key")` POSTs to `/investigations`, sends header `X-Owner-Key: key`, body `job_text:"x"`, returns `{id}` from a 201; and throws `FetchError` on a 500.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 2.4: Fixtures (HIGH + LOW)

**Files:** Create `apps/web/lib/__fixtures__/sample-high.ts`, `sample-low.ts`; Test `apps/web/lib/__fixtures__/__tests__/fixtures.test.ts`.

**Interfaces:**
- Produces: `SAMPLE_HIGH: { inv: Investigation; submitted: Submitted }` and `SAMPLE_LOW: {...}`, matching the real `InvestigationResponse` shape. **Transcribe the exact finding claims, source names/stamps/excerpts, `however`/`note`, and checklist verbatim from `support.js`** (HIGH: `FINDINGS` `ok`/`susp`/`unv` F-01…F-07 + `HIGH_CHECKS`; LOW: `LOW_FINDINGS` + `LOW_CHECKS`). Map prototype fields → API fields: prototype `severity` → `Finding.severity`; prototype `provenance:true` → `provenance:"user_provided_unverified"` (+ source `kind:"user_provided"`); prototype `however` → `Finding.mitigation`; prototype `note` → append into the finding's rendered note (carry as `mitigation` only if no `however`, else drop `note` into a `note` field — **extend the fixture Source with the note as a trailing `content_summary`** is wrong; instead the FindingVM has no note field, so fold `note` into the design's "optional plain note" by storing it as `Finding.mitigation` ONLY when there is no `however`; when both exist (none of the samples have both) prefer `however`). Each prototype source → a `Source` with a synthetic `id` (`s-hi-01`…), `url` set for domain-like names (so `defang` fires) else null, `kind` per name, `retrieved_at:"2026-08-18T09:41:00Z"`, `content_summary` = short label, `raw_excerpt` = the excerpt. `Finding.source_ids` link them. `assessment`: HIGH `{band:"HIGH",confidence:"MODERATE",summary:<the HIGH summary string from support.js line 744>,coverage:0.6}`; LOW `{band:"LOW",confidence:"HIGH",summary:<LOW summary line 745>,coverage:0.9}`. `check_count`: HIGH `3`, LOW `null`. `what_to_verify`: HIGH_CHECKS / LOW_CHECKS. `submitted` HIGH `{jobTitle:"Virtual Assistant, $2,500/month",company:"Acme Global",recruiter:"John Smith · Telegram",contactChannel:"Telegram",email:"acmeglobalcareers@gmail.com"}`; LOW `{jobTitle:"Customer Operations Associate",company:"Northwind Systems",recruiter:"Dana Whitfield · email",email:"dana.whitfield@northwind-systems.com"}`.
- [ ] **Step 1: Failing test** — `SAMPLE_HIGH.inv.findings` has length 7; exactly one finding has `provenance:"user_provided_unverified"` and `severity:"critical"`; exactly one has a non-null `mitigation` that mentions "Cross-posting"; `assessment.band==="HIGH"`; `what_to_verify` length 4. `SAMPLE_LOW.inv.findings` has 5, zero `suspicious` direction, `assessment.band==="LOW"`, `check_count===null`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** by transcribing from `support.js` (cite the line ranges: HIGH findings 472–503, LOW 508–526, checks 528–540, summaries 744–745).
- [ ] **Step 4: Run green** — also feed both fixtures through `toReportViewModel` in this test to confirm the adapter accepts them.

### Task 2.5: Flow context (cross-route state)

**Files:** Create `apps/web/lib/flow-context.tsx`; Modify `apps/web/app/layout.tsx` (wrap children in `FlowProvider`); Test `apps/web/lib/__tests__/flow-context.test.tsx`.

**Interfaces:**
- Produces: `FlowProvider` + `useFlow()` returning `{ state, set, reset, submitted }` where `state` mirrors the handoff state model: `jobInput, company, site, recruiter, email, convo, signedIn, authEmail, authMode, fetchError`. `set(patch)` merges + persists the survivable subset (`jobInput, company, site, recruiter, email, convo, signedIn, authEmail`) to `sessionStorage` (key `jhv_flow`) so the pasted posting **survives the sign-in gate**; `reset()` clears state + storage ("Check another posting"). `submitted` is a derived memo shaped for the adapter's `submitted` arg. SSR-safe: read storage in an effect, not during render (guard `typeof window`).
- [ ] **Step 1: Failing test** — render a probe component in `<FlowProvider>`; `set({ jobInput:"x" })` then re-read → `state.jobInput==="x"` and `sessionStorage.getItem("jhv_flow")` includes `"x"`; `reset()` clears both; `authPass` is **not** persisted (never store the password).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** (note: password lives in local component state on the auth screen, never in flow storage — security).
- [ ] **Step 4: Run green.**

### Task 2.6: Product-rule guardrail suite

**Files:** Create `apps/web/lib/__tests__/product-rules.test.tsx`.

**Interfaces:**
- Consumes: adapter + fixtures + (later) report components. In this phase it tests the **adapter/data** guarantees; Phase 3 extends it to the rendered report tree.
- [ ] **Step 1: Failing test.** Assert, from `toReportViewModel(SAMPLE_HIGH…)`: (a) `band` is one of the four literals — no numeric score field exists on `ReportVM` (compile-time + `expect(vm).not.toHaveProperty("score")`); (b) `confidence` is separate (`Low|Medium|High`) and not equal-typed to band; (c) every `unverifiable` finding's `metaLine` starts "UNVERIFIED" (neutral, no "WARNING"); (d) the critical finding's `provenanceLabel` is exactly the mandated sentence; (e) any `SourceVM` with `defang:true` has a `name` containing `[.]` and no `http`/`hxxp`-less bare scheme (i.e. already defanged). Assert from `SAMPLE_LOW`: no group heading equals "What looks suspicious".
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** (the assertions drive nothing new if Task 2.1 is correct; if any fail, fix the adapter, not the test).
- [ ] **Step 4: Run green.**

---

## Phase 3 — Result screen (`/report/[id]`) + LOW variant

**Skills to load first:** `emil-design-eng` (finding-card hover fill, expand animation, table/data hairlines), `apple-design` (expand interruptibility + reduced-motion), `ui-ux-pro-max` (information hierarchy of the band banner / findings), `vercel-react-best-practices` (client fetch pattern, avoid re-render storms on expand toggles).

The product's core screen — build it before the flow so the flow has a real destination. Everything renders from `ReportVM` (Task 2.1). Cover HIGH and LOW fixtures. Delete the old `BandBadge`.

### Task 3.1: `BandBanner` (full-bleed ink block)

**Files:** Create `components/report/BandBanner.tsx`; Test `components/report/__tests__/BandBanner.test.tsx`.

**Interfaces:**
- Consumes: `{ vm: ReportVM }`. Renders the ink (`--ink`) full-bleed block, inner `.container` two columns. Left: micro `"BAND {bandIndex} OF 4 · CASE {caseId}"`, band title 68px uppercase (`"HIGH RISK"`), a `SegmentBar total={4} filled={bandIndex}` (fill = band color token per band: LOW `--band-low`, MOD `--band-moderate`, HIGH `--band-high`, CRIT `--band-critical`; empty `--ink-muted`), the `bandMeaning` sentence, a rule, then `repeatLine`. Right column is `ConfidencePanel` (Task 3.2). Text is white/`--page` on ink. Product rule #3: only CRITICAL uses `--band-critical` saturated fill; assert HIGH does not use the critical token.
- [ ] **Step 1: Failing test** — HIGH vm → heading "HIGH RISK" present; text "BAND 3 OF 4" present; segment bar 4 segments/3 filled with `--band-high` (not `--band-critical`); `repeatLine` "CHECKED 3 TIMES" shown. LOW vm → "LOW RISK", 1 filled `--band-low`, "FIRST CHECK ON THIS POSTING". No `<a href>` anywhere in the block.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 3.2: `ConfidencePanel` (with tooltip + submitted grid)

**Files:** Create `components/report/ConfidencePanel.tsx`, `SubmittedGrid.tsx`; Test `components/report/__tests__/ConfidencePanel.test.tsx`.

**Interfaces:**
- Consumes: `{ vm: ReportVM }`. Renders micro "CONFIDENCE" + a `Tooltip` (`?`, label = the confidence explanation from handoff: "Confidence reflects how much we could verify — how many sources responded, how directly they addressed the claim, and how much rested on material we can't check independently."), the value 34px uppercase (`"MEDIUM"`) + `SegmentBar total={3} filled={confidenceSegments}`, the `confidenceNote` one-liner, then `SubmittedGrid` (Job/Company/Recruiter/Email from `vm.submitted`, email `.mono`; omit rows not present).
- [ ] **Step 1: Failing test** — HIGH vm → "MEDIUM" shown, confidence tooltip trigger present (`?` button), opening it reveals the "Confidence reflects…" text; submitted grid shows "Acme Global" and the mono email. A vm with empty `submitted` renders no grid rows.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** (reuse `Tooltip`, `SegmentBar`, `DefangedText` only if a submitted value were a URL — email is plain mono text).
- [ ] **Step 4: Run green.**

### Task 3.3: `FindingCard` (collapsed/expanded/However/provenance)

**Files:** Create `components/report/FindingCard.tsx`, `SourceList.tsx` (rebuild); Test `components/report/__tests__/FindingCard.test.tsx`.

**Interfaces:**
- Consumes: `{ finding: FindingVM }`. Collapsed row grid `54px 6px 1fr 26px`: mono `recordId`, a 6×20px severity marker bar (color by severity: critical `--critical`, high/medium `--suspicious`, legit direction `--legit`, unverifiable `--muted`), claim (18/700; unverifiable → 500 weight, `--body`) + uppercase `metaLine`, and a `+`/`−` toggle button (`aria-expanded`). Critical rows sit on `--critical-tint`; unverifiable rows on `--neutral-row`. Hover fills `--surface-soft`. If `provenanceLabel`, render the provenance panel (white, thin border, 12/1.5) **inside the collapsed card, always visible** (product rule #5). Expanded body is a Framer Motion `motion.section` inside `AnimatePresence` using `expandVariants` from `lib/motion.ts` (animate `height` 0↔auto over 620ms + opacity 380ms; `useMotion()` → instant under reduced motion), indented ~74px: each `SourceVM` = mono `name` (via `DefangedText` when `defang`, else plain) + uppercase `stampMono` + excerpt with a 3px left rule; then the `however` block when present — `--surface-soft` panel, micro "HOWEVER". `SourceList` renders the sources; URLs **never** as anchors.
- [ ] **Step 1: Failing tests.** Collapsed: shows `recordId` "F-04", `metaLine`, toggle `aria-expanded="false"`; the critical finding shows its provenance sentence **without** expanding; row background is `--critical-tint`. Toggle click → `aria-expanded="true"` and a source excerpt becomes visible; the "HOWEVER" label appears only for the finding that has `however`. `container.querySelector("a[href]")` is `null` even when a source name is a domain (assert it renders as defanged text). Unverifiable finding claim uses weight 500 (assert inline style / data attr).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 3.4: `FindingGroup` (rebuild) + `Summary` + `CountsStrip`

**Files:** Rebuild `components/report/FindingGroup.tsx`; Create `Summary.tsx`, `CountsStrip.tsx`; Test `components/report/__tests__/FindingGroup.test.tsx` (rebuild existing).

**Interfaces:**
- Consumes: `FindingGroup({ group: ReportVM["groups"][number] })` — uppercase heading + mono zero-padded `countMono`, then the group's `FindingCard`s in order; the unverifiable group is preceded by the line "Open questions, not accusations. Each one is a gap in what we could reach." `Summary({ summary })` — micro "SUMMARY" + paragraph 18/1.62. `CountsStrip({ vm })` — three cells (NN checks out `--legit` / NN suspicious on `--warn-tint` `--suspicious` / NN unverified `--muted`), used in the sticky rail and mobile 3-up.
- [ ] **Step 1: Failing tests** — `FindingGroup` for the suspicious group renders heading "What looks suspicious", count "03", and 3 cards; the unverifiable group renders the "Open questions, not accusations." preamble; `Summary` renders the passed text under "SUMMARY"; `CountsStrip` shows "02"/"03"/"02" with the suspicious cell on `--warn-tint`.
- [ ] **Step 2: Run red.** (The existing `FindingGroup.test.tsx` will fail against the new signature — rewrite it here.)
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 3.5: `VerifyChecklist` (rebuild → tickable) + `ReportFooter` + `ReportRail`

**Files:** Rebuild `components/report/VerifyChecklist.tsx`; Create `ReportFooter.tsx`, `ReportRail.tsx`; Test `components/report/__tests__/VerifyChecklist.test.tsx` (rebuild), `ReportFooter.test.tsx`.

**Interfaces:**
- Consumes: `VerifyChecklist({ items })` — bordered first-class block: header row "VERIFY IT YOURSELF / 04", heading "FOUR CHECKS THAT WOULD SETTLE THIS" (LOW: "THREE CHECKS WORTH DOING ANYWAY"), sub "These close the gaps we couldn't. Each takes a few minutes.", then tickable rows (19px square, ink fill + white ✓ when checked, strikethrough text); two per row on desktop; checked state is local (`useState<Record<number,boolean>>`). Heading auto-adapts to `items.length` (4→"FOUR…", 3→"THREE CHECKS WORTH DOING ANYWAY"). `ReportFooter({ vm, onReport, reported })` — quiet "REPORT AN ISSUE WITH THIS ASSESSMENT" → "Thanks — we'll look at it" after click; "CHECK ANOTHER POSTING" (calls `useFlow().reset()` + routes `/`); mono `formatCaseStamp`; scope note "This assessment reflects what we could find and verify online. It is not a legal determination." `ReportRail({ vm, saved, onSave })` — sticky (top 90px) `CountsStrip` + "Save this report"→"Saved to your account" + "Check another posting" + "SAVED TO" card (account email + "Reports stay private to your account. Repeat checks on the same posting are counted, never published.").
- [ ] **Step 1: Failing tests** — `VerifyChecklist` with 4 items → heading "FOUR CHECKS THAT WOULD SETTLE THIS", 4 checkboxes; clicking one sets its `aria-checked`/checked visual; with 3 items → "THREE CHECKS WORTH DOING ANYWAY". `ReportFooter` → clicking report shows "Thanks — we'll look at it"; scope note present.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 3.6: Assemble `/report/[id]` page + redirect old route + extend guardrails

**Files:** Create `apps/web/app/report/[id]/page.tsx`; Modify `apps/web/app/investigations/[id]/page.tsx` (→ redirect); Delete `components/report/BandBadge.tsx` + its test; Extend `apps/web/lib/__tests__/product-rules.test.tsx`; Test `apps/web/app/report/__tests__/page.test.tsx`.

**Interfaces:**
- Consumes: fetches via `fetchInvestigation(id, getOwnerKey())` (client, in effect — same pattern as the current page), reads `useFlow().submitted` for the submitted grid, runs `toReportViewModel`, renders BandBanner → Summary → groups (FindingGroup) → VerifyChecklist → ReportFooter, with sticky `ReportRail`. Loading + not-found states use the datasheet styling (not the old `system-ui` stub). `investigations/[id]/page.tsx` becomes `redirect(`/report/${id}`)` (Next `redirect` from `next/navigation`) to preserve existing links/tests.
- [ ] **Step 1: Failing tests** — render `page.test.tsx` with `fetchInvestigation` stubbed to return `SAMPLE_HIGH.inv` and flow submitted set: asserts "HIGH RISK", the three group headings, the critical provenance sentence, the verify heading, and **zero `<a href>`** in the whole document (product rule #4, full-tree). Extend `product-rules.test.tsx` to render the assembled report for both fixtures and assert: no element text matches `/\b\d{1,3}\s*\/\s*100\b/` or `/score/i` in a numeric-grade sense (rule #1); exactly one provenance label in HIGH, zero in LOW; the unverified group markers use `--muted` not a warn color (rule #6).
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** page + redirect; delete `BandBadge`.
- [ ] **Step 4: Run green** (run the whole web test suite to confirm no orphaned imports from the deleted `BandBadge`).

---

## Phase 4 — Landing (`/`) + submission, detection, prior-check & fetch-error states

**Skills to load first:** `ui-ux-pro-max` (hero + primary-action hierarchy, the scan field as the page's focus), `emil-design-eng` (field focus states, button press), `apple-design` (respond-on-press, live detection feedback continuous), `animate` + `animation-vocabulary` (hero stagger = "Stagger" of "screen-enter" entrances; name the effect, use the spec curve), `vercel-react-best-practices` (client component boundaries, no barrel imports).

The landing is the product's front door; the scan field is its primary action. Detection state updates live as the user types (apple-design: continuous feedback). Wire submission into the flow: fetch-fail → show panel & stay; not-signed-in → route to `/sign-in` holding input; signed-in → `/check/new`.

### Task 4.1: `SiteHeader` (sticky, shared)

**Files:** Create `apps/web/components/site/SiteHeader.tsx`; Test `components/site/__tests__/SiteHeader.test.tsx`.

**Interfaces:**
- Consumes: `useFlow()` for signed-in email. Renders the 66px sticky header: 13px `--ink` square + "Wordmark" (17/700/-0.015em), a mono divider label "JOB LEGITIMACY INVESTIGATOR" (10px uppercase 0.16em `--muted`, left border), right nav "How it works" / "Risk bands" / "Sign in" (→ signed-in email in mono when authenticated) + primary ink `Button` "Check a job". Header bottom rule `--rule`.
- [ ] **Step 1: Failing test** — signed-out: "Sign in" link + "Check a job" button present. Signed-in (flow `signedIn:true, authEmail:"a@b.co"`): shows `a@b.co` in place of "Sign in".
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 4.2: `ScanField` with live detection + prior-check + fetch-error panels

**Files:** Create `components/landing/ScanField.tsx`, `PriorCheckNotice.tsx`, `FetchErrorPanel.tsx`; Test `components/landing/__tests__/ScanField.test.tsx`.

**Interfaces:**
- Consumes: `{ value, onChange, detection, prior?, fetchError?, onPasteInstead }`. Label "JOB LINK OR JOB TEXT" with a live right-aligned `rightSlot` state driven by `detectInput` → "Waiting for input" / "Link detected" / "Job text detected". `TextArea` mono, min-height 118px, placeholder "Paste the link, or the whole posting text". `PriorCheckNotice` (soft surface, "PRIOR CHECK ON FILE", "This posting was checked 2 days ago — view that report or run a fresh check.") shows only when `prior`. `FetchErrorPanel` (`--warn-tint`/`--warn-rule`, "FETCH FAILED", "We couldn't read that page — it may need a login.", "Paste the job text instead and we'll work from that.", button "PASTE THE JOB TEXT INSTEAD" → `onPasteInstead`) replaces the prior-check notice when `fetchError`.
- [ ] **Step 1: Failing tests** — typing "https://x.co" shows "Link detected"; typing "Assistant role" shows "Job text detected"; empty shows "Waiting for input". `prior` → prior notice text visible. `fetchError` → "FETCH FAILED" visible and prior notice hidden; clicking "PASTE THE JOB TEXT INSTEAD" calls `onPasteInstead`. No `<a href>` around any pasted value.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 4.3: Landing static sections (Hero rail, HowItRuns, FourBands, ClosingBlock)

**Files:** Create `components/landing/ThisWeekRail.tsx`, `HowItRuns.tsx`, `FourBands.tsx`, `ClosingBlock.tsx`; Test `components/landing/__tests__/sections.test.tsx`.

**Interfaces:**
- Produces: `ThisWeekRail` — "THIS WEEK" list (Postings checked `4,118` / Findings with sources attached `96%` / Median time to a report `1m 40s`, values mono) + bordered "WHAT WE WON'T DO" card ("We never stamp a posting a scam, never give it a score out of a hundred, and never link to a domain under investigation. You get a band, our confidence in it, and the evidence."). `HowItRuns` — "HOW A CHECK RUNS", four columns 28px gap: 01 Read the posting / 02 Gather evidence / 03 Weigh it / 04 Hand it to you (one-line each, transcribe from prototype). `FourBands` — "FOUR BANDS, NOT A SCORE" on `--surface-soft`; four cards (LOW/MODERATE/HIGH/CRITICAL) each a `SegmentBar` filled to its level + one sentence; CRITICAL card ink-filled white text "Reserved for money already requested or documents already sent." (shadow `0 1px 2px rgba(38,40,44,0.06)` — the only shadowed cards). `ClosingBlock` — "MID-CONVERSATION RIGHT NOW?" + conversation-provenance explanation + "CHECK A JOB NOW" button + one sample `FindingCard` (critical, with provenance) as proof-of-style.
- [ ] **Step 1: Failing tests** — `ThisWeekRail` shows "4,118" and the won't-do copy; `FourBands` renders 4 band cards, the CRITICAL one ink-filled; `HowItRuns` shows the four step numbers; `ClosingBlock` renders a sample finding carrying the provenance label.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 4.4: Assemble `/` page + wire submission + sample-case fill + hero stagger

**Files:** Create `apps/web/app/page.tsx`; Test `apps/web/app/__tests__/landing.test.tsx`.

**Interfaces:**
- Consumes: `useFlow()`, `createInvestigation`, `detectInput`. Composes `SiteHeader` + hero (eyebrow "Evidence-backed · no scam verdicts · no scores", H1 "CHECK A JOB / BEFORE YOU / ANSWER" hard breaks, sub copy, `ScanField`, action row: ink `Button` "START INVESTIGATION" + bordered "1–2 MIN" cell + secondary "TRY THE SAMPLE CASE" filling sample data, gate line signed-out/signed-in variants) + `ThisWeekRail` + `HowItRuns` + `FourBands` + `ClosingBlock`. **Submission handler** (`onStart`): set flow `jobInput`; if signed-out → `router.push("/sign-in")`; else `router.push("/check/new")`. (Fetch-error is surfaced when a `link` submission's later `createInvestigation` fails — in V0 the actual POST happens on the progress screen; the landing's fetch-error panel is driven by flow `fetchError`, which the progress screen sets and routes back with, OR by a HEAD-style pre-check — keep V0 simple: show the panel from flow `fetchError` and let "TRY THE SAMPLE CASE"/paste flows exercise it. Prior-check notice triggers when `jobInput` matches `jobs-hire-portal.co`, matching the prototype.) Hero is a Framer Motion `motion.div` with `staggerParent` variants (children use `screenEnterVariants`); give the five children explicit `transition.delay` (eyebrow 0.04, headline 0.11, copy 0.19, field 0.27, rail 0.36) via a `custom` prop or per-child transition; `useMotion()` reveals instantly under reduced motion.
- [ ] **Step 1: Failing tests** — renders H1 "CHECK A JOB…"; "TRY THE SAMPLE CASE" click fills the scan field with the sample posting text and flips detection to "Job text detected"; with flow signed-out, clicking "START INVESTIGATION" (after entering input) calls `router.push("/sign-in")` (mock `next/navigation`); typing `jobs-hire-portal.co` shows the prior-check notice; gate line shows the signed-out sentence.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

---

## Phase 5 — Auth gate, details step, scripted progress + full flow wiring

**Skills to load first:** `ui-ux-pro-max` (form layout, step indicators), `emil-design-eng` (segmented toggle, validation panel restraint), `apple-design` + `animate` (progress step rows: spring entrance 70ms apart, cross-fade on state change, **no spinner/percentage** — name the effect via `animation-vocabulary`: a "Stagger" of "screen-enter" + "Crossfade" on state), `vercel-react-best-practices` (timer cleanup, avoid re-render churn in the scripted loop).

Wire the three middle screens and the full transition graph. The progress screen is the load-bearing reconciliation: it fires the real (blocking) POST while playing the scripted 7-step animation, then routes to the report.

### Task 5.1: Auth gate `/sign-in`

**Files:** Create `apps/web/app/sign-in/page.tsx`, `components/auth/AuthForm.tsx`, `QueuedCard.tsx`; Test `components/auth/__tests__/AuthForm.test.tsx`, `apps/web/app/__tests__/sign-in.test.tsx`.

**Interfaces:**
- Consumes: `useFlow()`. Left column: micro "STEP 2 OF 3 · SIGN IN REQUIRED", H1 "SIGN IN TO RUN / THIS CHECK", the privacy explanation, then `QueuedCard` showing the pasted `jobInput` in mono + "{detection} · runs as soon as you're in" (detection via `detectInput`). Right card: `AuthForm` — segmented Sign in / Create account toggle (active = ink fill white text), Email + Password (min 8) fields (password in **local** state, never flow storage), inline validation panel on failure ("Enter an email and a password of at least 8 characters to continue."), CTA "SIGN IN AND RUN THE CHECK" / "CREATE ACCOUNT AND RUN THE CHECK", "WHY WE ASK" note, quiet "Back to the posting" link (→ `/`). On valid submit (email present + password ≥8) → set flow `{ signedIn:true, authEmail, authMode }` → `router.push("/check/new")`.
- [ ] **Step 1: Failing tests** — `AuthForm`: submitting with a 5-char password shows the validation panel and does not call the success callback; valid submit calls it with the email; toggling to "Create account" changes the CTA text. `sign-in.test.tsx`: `QueuedCard` shows the flow `jobInput` and detection label.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 5.2: Details step `/check/new`

**Files:** Create `apps/web/app/check/new/page.tsx`, `components/details/DetailsForm.tsx`, `FieldValueRail.tsx`; Test `components/details/__tests__/DetailsForm.test.tsx`.

**Interfaces:**
- Consumes: `useFlow()`. Micro "STEP 3 OF 3 · SIGNED IN AS {authEmail}", H1 "ADD ANYTHING ELSE / YOU KNOW", sub (all optional, raise confidence). Editable job field (prefilled from `jobInput`), then Company name, Company website, Recruiter name, Recruiter email (2-up, 240px min), then "Paste your conversation with the recruiter" `TextArea` with helper "Text only — copy and paste the messages. Screenshots aren't supported yet." Actions: primary "START INVESTIGATION" (+ "1–2 MIN") and secondary "SKIP THE EXTRAS AND RUN IT". Right rail `FieldValueRail` "WHAT EACH FIELD BUYS YOU" (company website / recruiter email / conversation — transcribe copy). Both actions set the flow fields then `router.push("/check/running")`. (Note at the form: `site`, `recruiter`, `convo` are collected for UX/V1 but the V0 POST will not send them — see the service module.)
- [ ] **Step 1: Failing tests** — job field prefilled from flow `jobInput`; editing Company updates flow; "SKIP THE EXTRAS AND RUN IT" routes to `/check/running` without requiring the optional fields; conversation helper text present.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.**

### Task 5.3: Scripted progress `/check/running` + step components

**Files:** Create `apps/web/app/check/running/page.tsx`, `components/progress/StepList.tsx`, `StepRow.tsx`, `EvidenceRail.tsx`, `progress-script.ts`; Test `components/progress/__tests__/StepList.test.tsx`, `apps/web/app/check/__tests__/running.test.tsx`.

**Interfaces:**
- Produces: `progress-script.ts` exporting `STEPS` — the seven steps with `{ id, title, note, runningNote?, soft?, completeAt }` in the prototype's out-of-order completion sequence (README §4): 1 Reading the posting "Pulled 14 checkable claims."; 2 Checking domain records "Registration date and registrar retrieved."; 3 Checking the company's web presence — **soft** "Couldn't reach the company site — noted as unverified."; 4 Searching for duplicate postings "Three boards read — one repost differs on contact email." (running "Reading job boards, 3 of 5 done."); 5 Analyzing the conversation you shared "Read 22 messages for known pressure and payment patterns."; 6 Weighing the evidence "Seven findings recorded, three of them suspicious."; 7 Writing your report "Report ready." Completion order: 1,3,4,2,5,6,7. `StepRow({ step, state })` — grid `88px 22px 1fr 108px`: mono timestamp / `running` / `queued`; 11px status square (done = ink fill; soft = white fill + `--suspicious` border; running = ink border; queued = `--rule` border); title 16/700 + note 13/1.5; right state ("Closed" / "Soft close" in `--suspicious` / "Open" / "Queued"). Running rows on `--neutral-row`. `EvidenceRail` — "EVIDENCE COLLECTED" list (registrar record retrieved 09:41 / job board listing ×3 retrieved 09:41–09:42 / conversation you shared — not independently verifiable) + "Every item here is listed again in the report, with the excerpt it came from." Header line `CASE {caseId} · {n} of 7 steps closed`, H1 "WORKING THROUGH / THE POSTING", sub "{company} · {job}. Steps close as their evidence comes in, not in order." Footer "You can leave this page — the case stays open on your account and we'll hold the report." + quiet "SKIP THE WAIT" (dev affordance).
- Page behavior: on mount, generate a cosmetic `caseId` (e.g. from `crypto.randomUUID()` sliced/formatted like `4F2C-1180`), fire `createInvestigation(flow.submitted-mapped, getOwnerKey())` **once** (real ~90s POST), and start the scripted timers advancing `doneSteps` on the spring curve (70ms row entrance, cross-fade on state change). **No spinner, no percentage.** When the POST resolves with `{id}` **and** the script has reached the last step (whichever is later), `router.push('/report/'+id)`. On POST failure (`FetchError`), set flow `{ fetchError:true }` and `router.push('/')` (landing shows the fetch-error panel). Clean up all timers on unmount (`vercel-react-best-practices`; the prototype's `clear()` pattern).
- [ ] **Step 1: Failing tests** — `StepList` given `doneSteps=[1,3]` renders step 1 and 3 as "Closed"/ink square, step 3 as "Soft close" `--suspicious` when soft, others "Queued"; `running.test.tsx` (fake timers + stubbed `createInvestigation` resolving `{id:"abc"}`) → after advancing timers, `router.push` called with `/report/abc`; a stubbed rejecting `createInvestigation` → flow `fetchError` set and `router.push("/")`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** (map flow → `createInvestigation` input: `jobText` from `jobInput`, `companyName` from `company`, `recruiterEmail` from `email`, `jobUrl` from `jobInput` when `detectInput==="link"`; `site`/`recruiter`/`convo` intentionally dropped).
- [ ] **Step 4: Run green.**

### Task 5.4: End-to-end flow test (transitions)

**Files:** Test `apps/web/app/__tests__/flow.test.tsx`.

**Interfaces:**
- Consumes: all screens + `FlowProvider` + mocked `next/navigation` + stubbed API. Verifies the transition graph from README "State model": start (signed-out) → auth holding input → details → progress → report; "Check another posting" resets flow and returns to `/`.
- [ ] **Step 1: Failing test** — drive: paste on landing → START → assert route `/sign-in` and `QueuedCard` shows the paste; valid sign-in → `/check/new` with job prefilled; SKIP → `/check/running`; timers+resolved POST → `/report/:id` rendering "HIGH RISK" (stub `fetchInvestigation`→`SAMPLE_HIGH.inv`); footer "CHECK ANOTHER POSTING" → flow cleared + route `/`.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Fix** any wiring gaps surfaced (the goal is zero new components — only glue).
- [ ] **Step 4: Run green.**

---

## Phase 6 — Responsive/mobile (≤430px) + accessibility + cross-screen review

**Skills to load first:** `redesign-existing-projects` (audit pass — but honor the token authority in Global Constraints; use it for states/whitespace/rhythm only), `apple-design` (touch targets ≥44px, reduced-motion final audit), `accessibility-compliance:a11y-auditor` agent (dispatch for a WCAG sweep), `emil-design-eng` (final polish table), `ui-ux-pro-max` (mobile hierarchy).

Cross-cutting refinement. The per-screen motion + reduced-motion already shipped in Phases 3–5; here we add the mobile frames, verify tap targets and keyboard/screen-reader behavior, and run the design-review pass.

### Task 6.1: Mobile layouts (≤430px) across all screens

**Files:** Modify each screen's components (add Tailwind `max-[430px]:` responsive variants / a `sm`-down breakpoint); Test `apps/web/app/__tests__/mobile.test.tsx`.

**Interfaces:**
- Per README §6 mobile + the 4a mobile frames: single column; hero H1 ~30px; band block full-width with the 4-segment bar spanning it and confidence moved to a right-aligned line **above** the band title; counts become a 3-up strip; finding rows drop the record-id column (marker + claim + affordance only); checklist single column; all tap targets ≥44px; primary buttons full-width. Use `min-height:100dvh` for any full-height section (redesign skill: avoid `100vh` iOS bug). Drive layout via CSS only where possible; where DOM order must change (confidence above title on mobile) use a CSS `order`/grid-area swap, not a second render tree.
- [ ] **Step 1: Failing test** — since jsdom has no real layout, assert the structural affordances that are testable: `FindingCard` exposes a `data-mobile-hide-recordid` hook (or the record-id cell has a class the media query targets — assert the element exists so the CSS has a target); `Button` primary has a `data-fullwidth-mobile` affordance; band banner marks the confidence node with `data-mobile-order="above"`. (These are lightweight contracts ensuring the CSS has stable targets; the visual truth is verified manually against the 390px frames.)
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** the media queries + the data hooks.
- [ ] **Step 4: Run green**, then **manually verify** at 390px against the canvas 4a mobile frames (note in the task: open the app at 390px width and compare each screen).

### Task 6.2: Accessibility pass

**Files:** Modify components as needed; Test `apps/web/components/**/__tests__/a11y.test.tsx` (targeted); Dispatch: `accessibility-compliance:a11y-auditor` agent over `apps/web`.

**Interfaces:**
- Ensure: the confidence `Tooltip` is keyboard-operable (Enter/Space toggles, Escape closes, `aria-expanded`/`aria-controls` correct); `FindingCard` toggle is a real `<button>` with `aria-expanded` and controls the expanded region (`aria-controls`/`id`); checklist items are real checkboxes (`role`/`aria-checked`), keyboard-tickable; the band banner conveys band + confidence as **text** (not color-only — rule #2/#3); every interactive element has a visible focus ring (not `outline:none` without replacement); defanged URLs are inert text with no tab stop. Heading order is sensible per screen (one H1). Color contrast of `--muted #666` on `--page` meets AA for its sizes.
- [ ] **Step 1: Failing tests** — targeted RTL tests: tooltip toggles via keyboard; finding toggle has `aria-controls` pointing at the expanded region's `id`; a checklist item is reachable as `role="checkbox"` and toggles on Space. 
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** fixes; then dispatch the `a11y-auditor` agent over `apps/web` and address its findings.
- [ ] **Step 4: Run green** + fold the auditor's actionable items back into the components.

### Task 6.3: Motion + design review pass

**Files:** Modify components/CSS per findings; no new test file (regression: full suite must stay green).

**Interfaces:**
- Run the `emil-design-eng` review format (Before/After table) over the final Framer Motion configs + Tailwind transitions: confirm no `transition-all`, entrances use the spec spring/`easeOut` not `ease-in`, buttons have `active:scale`, tooltip/expand scale from origin, no `scale(0)` (use `scale(.95/.96)+opacity`), durations match the spec (screen 420/620ms, expand 620/380ms, color 220–400ms). Confirm every `motion.*`/`AnimatePresence` reads `useMotion()`/`useReducedMotion()` and collapses to an instant reveal. Confirm the `animate` skill's gate: nothing high-frequency animates gratuitously (the scan-field detection state is a text swap, not a motion flourish; typing is 100+/day → no entrance animation on keystroke).
- [ ] **Step 1:** Produce the Before/After review table; list concrete fixes.
- [ ] **Step 2:** Apply fixes.
- [ ] **Step 3:** Run the **entire** web test suite (`pnpm --filter @job-hunt/web test`) → all green; verify no `<a href>` exists in the report tree via the guardrail suite; manually walk all five screens + LOW report + fetch-error + prior-check + mobile once more.

---

## Self-Review

**1. Spec coverage** (handoff → task):
- Landing (§1) → Phase 4 (4.1–4.4). Auth gate (§2) → 5.1. Details (§3) → 5.2. Progress (§4) → 5.3. Result (§5) → Phase 3. States §6 (fetch-error, prior-check) → 4.2; (LOW variant) → Phase 3 (3.1/3.5 adapt on `items.length`/band) + fixtures 2.4; (mobile) → 6.1. State model + transitions → 2.5 (flow) + 5.4 (e2e). Data model + API wiring → 2.1 (adapter) + 2.3/5.3 (service). Product rules 1–8 → 2.6 + 3.6 guardrails + enforced per component. Tokens/type/motion → 1.1 + per-component CSS + 6.3. Sample content (HIGH/LOW) → 2.4. Assets (no images, JetBrains Mono) → 1.1.
- **Deliberate V0 reconciliations (documented, not gaps):** no auth backend → client-only gate (5.1); no streaming → scripted progress + single blocking POST (5.3); API omits conversation/site/recruiter-name → collected in UI, not sent (5.2/5.3); API omits bandMeaning/confidenceNote/lastCheckedAt/submitted-grid → derived via copy maps + flow state (2.1). These follow the handoff's "wire to whatever the repo already has (or stub behind a single service module)".

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Bulk verbatim finding/source/checklist prose is transcribed from cited `support.js` line ranges (2.4) rather than re-typed here — that is the authoritative source, and duplicating ~60 lines of fixture prose into the plan invites transcription drift. All logic, types, tokens, and screen copy fragments are given inline.

**3. Type consistency:** `ReportVM`/`FindingVM`/`SourceVM` (2.1) are consumed unchanged by all Phase 3 components. `CreateInput` (2.3) is produced by the flow→service mapping (5.3). `useFlow()` state keys match the README state model (2.5) and are read by 4.x/5.x. `SegmentBar`/`Tooltip`/`DefangedText`/`Button`/`TextField`/`TextArea` (Phase 1) are referenced by name in Phases 3–5. `toReportViewModel`, `detectInput`, `formatStamp`, `formatCaseStamp`, `createInvestigation`, `fetchInvestigation` names are stable across their definition and call sites.

---

**Execution note:** Per your global rules, this plan uses ≤6 substantial phases, folds testing into each phase, uses red/green TDD cycles, and omits commit steps. The `redesign-existing-projects` skill's generic defaults (font swaps, radius, gradients, imagery, asymmetry) are explicitly overridden by the handoff's authoritative tokens — see Global Constraints.
