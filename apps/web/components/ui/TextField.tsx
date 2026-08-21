"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  rightSlot?: ReactNode;
  minWidth?: string;
  autoComplete?: string;
  /** Marks the field invalid: red border + aria-invalid for AT. */
  invalid?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  mono = false,
  placeholder,
  type = "text",
  rightSlot,
  minWidth,
  autoComplete,
  invalid = false,
}: TextFieldProps) {
  const id = useId();

  return (
    <div style={minWidth ? { minWidth } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[10px] uppercase tracking-[0.12em] text-muted"
        >
          {label}
        </label>
        {rightSlot}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={[
          // mt-2 keeps the focus ring (outline + 2px offset) from overlapping
          // the label sitting directly above. 14px/11px padding matches the
          // prototype's ~44px field height — the default 16px body size read
          // oversized against the handoff.
          "mt-2 w-full rounded-none border px-[13px] py-[11px] text-[14px] transition-colors duration-150",
          invalid ? "border-critical" : "border-ink",
          mono ? "font-mono leading-[1.6]" : "leading-[1.5]",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
}
