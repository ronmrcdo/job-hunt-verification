// The scripted progress sequence for /check/running. Titles and notes are
// transcribed from the prototype (Investigator Prototype.dc.html, STEPS
// array). The DISPLAY order below is always 1..7 (the order the steps were
// dispatched in), but the COMPLETION order is deliberately out of order —
// 1, 3, 4, 2, 5, 6, 7 — to make the point that evidence closes as it comes
// in, not in the order it was requested. `completeAt` encodes that: it's
// monotonically increasing across the completion sequence, not across the
// display (id) sequence.
export interface ProgressStep {
  id: number;
  title: string;
  note: string;
  runningNote?: string;
  soft?: boolean;
  /** Ms offset (from script start) at which this step is marked done. */
  completeAt: number;
}

export const STEPS: ProgressStep[] = [
  {
    id: 1,
    title: "Reading the posting",
    note: "Pulled 14 checkable claims.",
    completeAt: 400,
  },
  {
    id: 2,
    title: "Checking domain records",
    note: "Registration date and registrar retrieved.",
    completeAt: 2100,
  },
  {
    id: 3,
    title: "Checking the company's web presence",
    note: "Couldn't reach the company site — noted as unverified.",
    soft: true,
    completeAt: 900,
  },
  {
    id: 4,
    title: "Searching for duplicate postings",
    note: "Three boards read — one repost differs on contact email.",
    runningNote: "Reading job boards, 3 of 5 done.",
    completeAt: 1500,
  },
  {
    id: 5,
    title: "Analyzing the conversation you shared",
    note: "Read 22 messages for known pressure and payment patterns.",
    completeAt: 2700,
  },
  {
    id: 6,
    title: "Weighing the evidence",
    note: "Seven findings recorded, three of them suspicious.",
    completeAt: 3300,
  },
  {
    id: 7,
    title: "Writing your report",
    note: "Report ready.",
    completeAt: 3900,
  },
];

// Completion order (ascending completeAt): 1, 3, 4, 2, 5, 6, 7.
export const COMPLETION_ORDER: number[] = [...STEPS]
  .sort((a, b) => a.completeAt - b.completeAt)
  .map((step) => step.id);
