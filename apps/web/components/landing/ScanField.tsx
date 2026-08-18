"use client";

import { TextArea } from "../ui/TextArea";
import { PriorCheckNotice } from "./PriorCheckNotice";
import { FetchErrorPanel } from "./FetchErrorPanel";

export type DetectionState = "empty" | "link" | "text";

export interface ScanFieldProps {
  value: string;
  onChange: (value: string) => void;
  detection: DetectionState;
  prior?: boolean;
  fetchError?: boolean;
  onPasteInstead: () => void;
}

const DETECTION_LABEL: Record<DetectionState, string> = {
  empty: "Waiting for input",
  link: "Link detected",
  text: "Job text detected",
};

export function ScanField({ value, onChange, detection, prior, fetchError, onPasteInstead }: ScanFieldProps) {
  return (
    <div>
      <TextArea
        label="JOB LINK OR JOB TEXT"
        value={value}
        onChange={onChange}
        mono
        minHeight="118px"
        placeholder="Paste the link, or the whole posting text"
        rightSlot={<span className="text-[10px] uppercase tracking-[0.12em] text-muted">{DETECTION_LABEL[detection]}</span>}
      />
      {fetchError ? (
        <FetchErrorPanel onPasteInstead={onPasteInstead} />
      ) : prior ? (
        <PriorCheckNotice />
      ) : null}
    </div>
  );
}
