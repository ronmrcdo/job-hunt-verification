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
          // the label sitting directly above.
          "mt-2 w-full rounded-none border p-[13px] transition-colors duration-150",
          invalid ? "border-critical" : "border-ink",
          mono ? "font-mono text-[14px] leading-[1.6]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
}
