import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "md" | "wide";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button, and marks it aria-busy. */
  pending?: boolean;
  /** Optional label shown next to the spinner while `pending`. */
  pendingLabel?: ReactNode;
  /**
   * A completed, non-repeatable action (e.g. "Saved"). Non-pressable like
   * `disabled`, but NOT dimmed — a success confirmation must read affirmed,
   * never greyed-out like a blocked action. Pair with an `aria-live` region
   * at the call site to announce the state change.
   */
  confirmed?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-ink text-page hover:bg-ink-hover",
  secondary: "border border-ink bg-transparent hover:bg-surface-soft",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // Compact button — the nav "Check a job" and inline "skip" actions.
  // Matches the prototype's header CTA: 11px bold uppercase, 13/17 padding
  // (Investigator Prototype.dc.html line 41). Without real padding a primary
  // button reads as bare text, not a button.
  md: "text-[11px] font-bold tracking-[0.1em] px-[17px] py-[13px] uppercase",
  wide: "text-[14px] font-bold tracking-[0.1em] px-[19px] py-[15px] uppercase",
};

/**
 * The button's visual contract, extracted so a *link* that must read as a
 * button (e.g. "GO TO HOME" on an error screen — real navigation, so a real
 * anchor) shares one source of truth with <Button> instead of restating it.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  isDisabled = false,
  confirmed = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isDisabled?: boolean;
  confirmed?: boolean;
  className?: string;
} = {}) {
  return [
    // Colour/hover transition on its own clock; the press scale uses the
    // shared strong ease-out. `active:scale` is suppressed once the button is
    // non-pressable so a dead/done button never feels pressable. A `confirmed`
    // button is non-pressable too but stays full-opacity — dimming a success
    // state would read as a failure.
    "rounded-none inline-flex items-center justify-center gap-2 max-[430px]:min-h-[44px]",
    "transition-[transform,background-color,color] duration-150 [transition-timing-function:var(--ease-out)]",
    isDisabled
      ? "cursor-not-allowed opacity-55"
      : confirmed
        ? "cursor-default"
        : "active:scale-[0.98]",
    // Primary buttons go full-width on mobile per README §6 mobile spec.
    variant === "primary" ? "max-[430px]:w-full" : "",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  pending = false,
  pendingLabel,
  confirmed = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || pending;

  const classes = buttonClasses({ variant, size, isDisabled, confirmed, className });

  // Stable hook for the CSS target + a lightweight structural contract
  // that this affordance exists — mirrors the max-[430px]:w-full class
  // above rather than driving layout itself.
  const mobileProps = variant === "primary" ? { "data-fullwidth-mobile": true } : {};

  // A confirmed button stays in the a11y tree and focusable (native `disabled`
  // would drop it, so its call-site aria-live could go unread) — it's marked
  // aria-disabled and its click is swallowed instead.
  const { onClick, ...rest } = props;

  return (
    <button
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-disabled={confirmed || undefined}
      aria-busy={pending || undefined}
      onClick={confirmed ? undefined : onClick}
      {...mobileProps}
      {...rest}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
