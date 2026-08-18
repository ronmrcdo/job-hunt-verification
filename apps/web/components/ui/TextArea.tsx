"use client";

import { useId, type ReactNode } from "react";

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  minHeight?: string;
  rightSlot?: ReactNode;
}

export function TextArea({
  label,
  value,
  onChange,
  mono = false,
  placeholder,
  minHeight,
  rightSlot,
}: TextAreaProps) {
  const id = useId();

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[10px] uppercase tracking-[0.12em] text-muted"
        >
          {label}
        </label>
        {rightSlot}
      </div>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={minHeight ? { minHeight } : undefined}
        className={[
          "w-full border border-ink rounded-none p-[13px]",
          mono ? "font-mono text-[14px] leading-[1.6]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </div>
  );
}
