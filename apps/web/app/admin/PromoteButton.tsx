"use client";
import { useFormStatus } from "react-dom";

// Client submit button so the operator's repeated action feels responsive:
// press-scale (Emil) + disabled/aria-busy while the server action runs, so a
// double-click can't double-promote.
export function PromoteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="border border-ink px-3 py-1 text-[12px] transition-transform duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {pending ? "Promoting…" : "Promote"}
    </button>
  );
}
