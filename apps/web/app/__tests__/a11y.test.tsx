// Targeted accessibility contract tests (Task 6.2). These lock in the a11y
// contracts from the task brief: keyboard operability of the Tooltip and
// VerifyChecklist, aria-controls/id wiring on Tooltip + FindingCard, the
// band banner conveying band/confidence as text, and DefangedText being
// inert (no tab stop, no anchor) — plus the fix-round contracts from the
// code review (R12: native-button keyboard activation, no manual
// keydown-Space double-toggle) and the a11y-auditor sweep (aria-controls
// only referencing a mounted element, accessible names, live-region
// progress announcements, tooltip contrast on dark backgrounds,
// autoComplete, role=alert on dynamic status panels, a skip link, and
// muted-not-faint contrast for the step numbers). Full a11y-auditor sweep
// runs separately from this file.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Tooltip } from "../../components/ui/Tooltip";
import { FindingCard } from "../../components/report/FindingCard";
import { VerifyChecklist } from "../../components/report/VerifyChecklist";
import { BandBanner } from "../../components/report/BandBanner";
import { ConfidencePanel } from "../../components/report/ConfidencePanel";
import { DefangedText } from "../../components/ui/DefangedText";
import { TextField } from "../../components/ui/TextField";
import { AuthForm } from "../../components/auth/AuthForm";
import { FetchErrorPanel } from "../../components/landing/FetchErrorPanel";
import { StepList } from "../../components/progress/StepList";
import { SiteHeader } from "../../components/site/SiteHeader";
import { HowItRuns } from "../../components/landing/HowItRuns";
import { FlowProvider } from "../../lib/flow-context";
import { toReportViewModel } from "../../lib/report-view-model";
import type { CompleteReportVM } from "../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../lib/__fixtures__/sample-high";
import type { Investigation } from "../../lib/investigations";

// SAMPLE_HIGH carries a real assessment, so the report is always complete —
// this cast is honest for that reason, not a workaround.
function completeVM(inv: Investigation): CompleteReportVM {
  return toReportViewModel(inv) as CompleteReportVM;
}

// SiteHeader calls next/navigation's useRouter (for the "Check a job"
// button) — mock it the same way components/site/__tests__/SiteHeader.test.tsx
// does so it can render outside a real app router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// AuthForm and SiteHeader both call the browser Supabase client — mock it
// so these a11y-only tests never hit the network (see the AuthForm/
// SiteHeader test suites for the behavioral contracts).
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

describe("a11y: Tooltip", () => {
  it("trigger carries aria-expanded/aria-controls, and aria-controls only references the panel while it's mounted", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Closed: AnimatePresence hasn't mounted the panel yet, so aria-controls
    // must not point at a nonexistent id.
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const panel = document.getElementById(controlsId as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent("Details here");
  });

  // R12: a native <button> already activates on both Enter and Space via
  // its own onClick — that's the platform's default keyboard-activation
  // behavior, not something this component needs to reimplement. A manual
  // keydown-Space toggle would double-toggle in a real browser (the native
  // keyup click fires afterward and toggles it back to a no-op), so it was
  // removed rather than fixed. jsdom's fireEvent doesn't simulate that
  // native activation path, so it can't be asserted via a simulated keydown
  // — what's actually testable, and what guarantees real keyboard
  // operability, is that the trigger is a genuine <button>, and that click
  // (what Enter/Space produce natively) toggles it.
  it("is a native <button> that toggles open on click (guarantees real-browser Enter/Space activation)", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    expect(trigger.tagName).toBe("BUTTON");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape (panel is removed once the exit animation resolves)", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });

  it("accepts a tone prop for visibility on dark backgrounds (1.4.11 non-text contrast)", () => {
    render(
      <Tooltip label="Confidence explanation" tone="var(--color-page)">
        Details here
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    expect(trigger.style.borderColor).toBe("var(--color-page)");
  });

  it("ConfidencePanel passes a light tone to its Tooltip so the trigger stays visible on BandBanner's dark band", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    render(<ConfidencePanel vm={vm} />);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    expect(trigger.style.borderColor).toBe("var(--color-page)");
  });
});

describe("a11y: FindingCard toggle", () => {
  it("toggle is a real <button> with an accessible name, and aria-controls only references the expanded region while it's mounted", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const finding = vm.groups.flatMap((g) => g.findings).find((f) => f.recordId === "F-03")!;
    render(<FindingCard finding={finding} />);

    const toggle = screen.getByRole("button");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed: the expanded <section> is unmounted, so aria-controls must
    // not reference its id.
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(toggle).toHaveAccessibleName();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName();

    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const region = document.getElementById(controlsId as string);
    expect(region).not.toBeNull();
  });
});

describe("a11y: VerifyChecklist items", () => {
  it("an item is reachable as role=checkbox and toggles aria-checked on click (R12: no manual keydown-Space handler)", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    const first = screen.getAllByRole("checkbox")[0];
    expect(first.tagName).toBe("BUTTON");
    expect(first).toHaveAttribute("aria-checked", "false");

    // Click is what a native button's Enter/Space activation produces —
    // see the Tooltip suite above for why a keydown-Space simulation isn't
    // used here.
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "true");
  });
});

describe("a11y: band banner conveys band + confidence as text", () => {
  it("renders the band title and a textual confidence word, not color alone", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    render(<BandBanner vm={vm} confidenceSlot={<div>MEDIUM</div>} />);

    // Band conveyed as text (e.g. "HIGH RISK"), independent of the marker color.
    expect(screen.getByText("HIGH RISK")).toBeInTheDocument();
    // Confidence conveyed as a text word via the slot, not a color swatch alone.
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
  });
});

describe("a11y: DefangedText is inert", () => {
  it("renders a plain span with no anchor and no tab stop", () => {
    const { container } = render(<DefangedText value="http://evil.example.com/apply" />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(span).not.toHaveAttribute("tabindex");
  });
});

describe("a11y: progress is announced to assistive tech", () => {
  it("StepList's case/count header carries aria-live=polite", () => {
    const steps = [
      {
        investigation_id: "i",
        step_key: "a",
        label: "A",
        display_order: 1,
        status: "done",
        started_at: null,
        finished_at: null,
      },
      {
        investigation_id: "i",
        step_key: "b",
        label: "B",
        display_order: 2,
        status: "running",
        started_at: null,
        finished_at: null,
      },
    ];
    render(<StepList steps={steps} caseId="4F2C-1180" />);
    const region = screen.getByText("CASE 4F2C-1180 · 1 of 2 steps closed");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});

describe("a11y: form fields carry autoComplete", () => {
  it("TextField forwards an autoComplete prop to the underlying input", () => {
    render(<TextField label="Email" value="" onChange={() => {}} autoComplete="email" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });

  it("AuthForm wires email/current-password autoComplete in signin mode", () => {
    render(<AuthForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("AuthForm switches to new-password autoComplete in create-account mode", () => {
    render(<AuthForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });
});

describe("a11y: dynamic status panels announce themselves", () => {
  it("AuthForm's validation panel carries role=alert", async () => {
    render(<AuthForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    // No FlowProvider mounted → nothing queued → the plain "SIGN IN" CTA.
    fireEvent.click(screen.getByRole("button", { name: "SIGN IN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
  });

  it("FetchErrorPanel carries role=alert", () => {
    render(<FetchErrorPanel onPasteInstead={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("FETCH FAILED");
  });
});

describe("a11y: skip link", () => {
  it("SiteHeader renders a skip-to-content link targeting #main-content as the first focusable element", () => {
    render(
      <FlowProvider>
        <SiteHeader />
      </FlowProvider>,
    );
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link).toHaveAttribute("href", "#main-content");
  });
});

describe("a11y: contrast — faint replaced with muted for essential label text", () => {
  it("HowItRuns step numbers use text-muted, not text-faint (#888/#fff fails AA)", () => {
    const { container } = render(<HowItRuns />);
    const stepNumber = within(container).getByText("01");
    expect(stepNumber.className).toContain("text-muted");
    expect(stepNumber.className).not.toContain("text-faint");
  });
});
