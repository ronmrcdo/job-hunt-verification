"use client";

// Live password feedback for create-account: a four-segment strength meter
// plus a requirements checklist. Both read from the same PASSWORD_CRITERIA the
// schema gates on, so what the meter shows and what the form accepts can't drift.
//
// Motion (Emil): typing a password is an occasional, first-time action, so a
// little feedback earns its place — but only color transitions on the bars and
// a check mark cross-fade. No width/layout animation (those hit the GPU's slow
// path and would jitter as the meter re-renders on every keystroke).
import { PASSWORD_CRITERIA, evaluatePassword } from "../../lib/password";

// Meter tone climbs red → amber → gold → green with the score. Indexed by
// score (1–4); index 0 is unused (empty passwords render no meter).
const BAR_FILL = ["", "bg-critical", "bg-suspicious", "bg-band-moderate", "bg-legit"];
const LABEL_TONE = ["", "text-critical", "text-suspicious", "text-band-moderate", "text-legit"];

export function PasswordStrength({ password }: { password: string }) {
  const { score, label } = evaluatePassword(password);
  if (password.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((seg) => (
            <span
              key={seg}
              className={[
                "h-1 flex-1 rounded-none transition-colors duration-200 [transition-timing-function:var(--ease-out)]",
                seg <= score ? BAR_FILL[score] : "bg-rule",
              ].join(" ")}
            />
          ))}
        </div>
        <span
          className={[
            "text-[10px] font-bold uppercase tracking-[0.12em] transition-colors duration-200",
            LABEL_TONE[score] || "text-muted",
          ].join(" ")}
        >
          {label}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {PASSWORD_CRITERIA.map((c) => {
          const met = c.test(password);
          return (
            <li
              key={c.id}
              className={[
                "flex items-center gap-2 text-[12px] leading-[1.4] transition-colors duration-150",
                met ? "text-secondary" : "text-muted",
              ].join(" ")}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className={[
                  "h-3.5 w-3.5 shrink-0 transition-colors duration-150",
                  met ? "text-legit" : "text-faint",
                ].join(" ")}
              >
                {met ? (
                  <path
                    d="M3.5 8.5l3 3 6-6.5"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                )}
              </svg>
              <span>{c.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
