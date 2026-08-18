"use client";

// The landing page — the product's front door. Composes the hero (scan
// field + submission gate) with the supporting sections transcribed from
// the prototype (RULING R9): Investigator Prototype.dc.html lines 49-80.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { SiteHeader } from "../components/site/SiteHeader";
import { ScanField } from "../components/landing/ScanField";
import { ThisWeekRail } from "../components/landing/ThisWeekRail";
import { HowItRuns } from "../components/landing/HowItRuns";
import { FourBands } from "../components/landing/FourBands";
import { ClosingBlock } from "../components/landing/ClosingBlock";
import { Button } from "../components/ui/Button";
import { useFlow } from "../lib/flow-context";
import { detectInput } from "../lib/detect";
import { useMotion } from "../lib/motion";

// Sample posting text for "TRY THE SAMPLE CASE" — plain job-posting prose
// (not a link) so detection flips to "text" per the task brief, unlike the
// prototype's SAMPLE.job (a URL). Faithful to the prototype's Acme Global /
// Virtual Assistant sample case, transcribed as posting text rather than a
// link — NOTE: not verbatim, since no plain-text sample posting appears in
// the prototype (RULING R9 — faithful, not transcribed).
const SAMPLE_POSTING = `Virtual Assistant — $2,500/month, immediate start

Acme Global is hiring a remote Virtual Assistant. Flexible hours, no experience required.

To apply, message us on Telegram @acme_hiring_jsmith or email acmeglobalcareers@gmail.com.

A small training fee is required before onboarding begins.`;

// The domain that triggers the prior-check notice (RULING R9):
// Investigator Prototype.dc.html line 567 (isSamplePosting).
const PRIOR_CHECK_DOMAIN = "jobs-hire-portal.co";

export default function Page() {
  const router = useRouter();
  const { state, set } = useFlow();
  const [value, setValue] = useState(state.jobInput ?? "");
  const fieldRef = useRef<HTMLDivElement>(null);
  const motionPreset = useMotion();

  const detection = detectInput(value);

  function onStart() {
    set({ jobInput: value });
    if (!state.signedIn) {
      router.push("/sign-in");
    } else {
      router.push("/check/new");
    }
  }

  function onFillSample() {
    setValue(SAMPLE_POSTING);
    set({ jobInput: SAMPLE_POSTING });
  }

  function onPasteInstead() {
    set({ fetchError: false });
  }

  function onClosingScan() {
    if (value.trim()) {
      onStart();
      return;
    }
    fieldRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-[1240px] px-8">
        <motion.div
          className="flex flex-col gap-[26px] py-16"
          variants={motionPreset.staggerParent}
          initial="hidden"
          animate="visible"
        >
          <motion.div
            variants={motionPreset.screenEnterVariants}
            transition={{ ...motionPreset.screenEnter, delay: 0.04 }}
            className="text-[11px] uppercase tracking-[0.18em] text-muted"
          >
            Evidence-backed · no scam verdicts · no scores
          </motion.div>

          <motion.h1
            variants={motionPreset.screenEnterVariants}
            transition={{ ...motionPreset.screenEnter, delay: 0.11 }}
            className="m-0 text-[72px] font-bold leading-[0.94] tracking-[-0.045em] max-[430px]:text-[30px]"
          >
            CHECK A JOB
            <br />
            BEFORE YOU
            <br />
            ANSWER
          </motion.h1>

          <motion.p
            variants={motionPreset.screenEnterVariants}
            transition={{ ...motionPreset.screenEnter, delay: 0.19 }}
            className="m-0 max-w-[560px] text-[19px] leading-[1.55] text-secondary"
          >
            Paste the link or the message a recruiter sent you. We check what can be verified, say plainly
            what we couldn&rsquo;t reach, and show the evidence behind every finding.
          </motion.p>

          <motion.div
            ref={fieldRef}
            variants={motionPreset.screenEnterVariants}
            transition={{ ...motionPreset.screenEnter, delay: 0.27 }}
            className="flex max-w-[620px] flex-col gap-2"
          >
            <ScanField
              value={value}
              onChange={setValue}
              detection={detection}
              prior={value.includes(PRIOR_CHECK_DOMAIN)}
              fetchError={state.fetchError}
              onPasteInstead={onPasteInstead}
            />
          </motion.div>

          <motion.div
            variants={motionPreset.screenEnterVariants}
            transition={{ ...motionPreset.screenEnter, delay: 0.36 }}
            className="flex max-w-[620px] flex-col gap-2"
          >
            <div className="flex flex-wrap gap-[10px] pt-1">
              <div className="flex flex-1 items-stretch border border-ink" style={{ flexBasis: "300px" }}>
                <Button variant="primary" size="wide" className="flex-1" onClick={onStart}>
                  START INVESTIGATION
                </Button>
                <div className="flex items-center whitespace-nowrap px-4 text-[11px] uppercase tracking-[0.08em] text-muted">
                  1–2 MIN
                </div>
              </div>
              <Button variant="secondary" size="wide" onClick={onFillSample}>
                TRY THE SAMPLE CASE
              </Button>
            </div>
            <div className="text-[13px] text-muted">
              {state.signedIn
                ? `Signed in as ${state.authEmail || "you@example.com"} — your report is saved to your account.`
                : "You’ll be asked to sign in before the check runs, so the report stays private to you."}
            </div>
          </motion.div>
        </motion.div>

        <ThisWeekRail />
        <HowItRuns />
        <FourBands />
        <ClosingBlock onScan={onClosingScan} />
      </main>
    </>
  );
}
