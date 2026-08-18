import type { HTMLAttributes } from "react";

export interface MicroLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: string;
}

export function MicroLabel({ children, tone, className, style, ...props }: MicroLabelProps) {
  const classes = ["text-[10px] uppercase tracking-[0.15em]", tone ? "" : "text-muted", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={tone ? { color: tone, ...style } : style} {...props}>
      {children}
    </span>
  );
}
