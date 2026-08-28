"use client";
import { useFormStatus } from "react-dom";

// Mirrors PromoteButton: press-scale + disabled/aria-busy while the action runs,
// so a double-click can't fire the status flip twice.
export function MarkExportedButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="border border-ink px-3 py-1 text-[12px] transition-transform duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {pending ? "Marking…" : "Mark exported"}
    </button>
  );
}
