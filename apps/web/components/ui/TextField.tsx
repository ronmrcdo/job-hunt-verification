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
        onChange={(event) => onChange(event.target.value)}
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
