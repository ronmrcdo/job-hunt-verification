import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "md" | "wide";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-ink text-page hover:bg-ink-hover",
  secondary: "border border-ink bg-transparent",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // Compact button — the nav "Check a job" and inline "skip" actions.
  // Matches the prototype's header CTA: 11px bold uppercase, 13/17 padding
  // (Investigator Prototype.dc.html line 41). Without real padding a primary
  // button reads as bare text, not a button.
  md: "text-[11px] font-bold tracking-[0.1em] px-[17px] py-[13px] uppercase",
  wide: "text-[14px] font-bold tracking-[0.1em] px-[19px] py-[15px] uppercase",
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const classes = [
    "rounded-none active:scale-[0.98] transition-transform max-[430px]:min-h-[44px]",
    // Primary buttons go full-width on mobile per README §6 mobile spec.
    variant === "primary" ? "max-[430px]:w-full" : "",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Stable hook for the CSS target + a lightweight structural contract
  // that this affordance exists — mirrors the max-[430px]:w-full class
  // above rather than driving layout itself.
  const mobileProps = variant === "primary" ? { "data-fullwidth-mobile": true } : {};

  return <button type={type} className={classes} {...mobileProps} {...props} />;
}
