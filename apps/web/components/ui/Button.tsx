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
  md: "",
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
    "rounded-none active:scale-[0.98] transition-transform",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...props} />;
}
