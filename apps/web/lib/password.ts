// Password complexity rules + strength scoring, shared by the create-account
// schema (hard gate) and the live strength meter (soft feedback) so the two
// never drift. One criterion = one point; the score IS the number of rules met.

export interface PasswordCriterion {
  id: "length" | "lower" | "upper" | "number";
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_CRITERIA: PasswordCriterion[] = [
  { id: "length", label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { id: "lower", label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { id: "upper", label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { id: "number", label: "A number", test: (pw) => /[0-9]/.test(pw) },
];

export type StrengthLabel = "Weak" | "Fair" | "Good" | "Strong";

const SCORE_LABEL: Record<number, StrengthLabel> = {
  1: "Weak",
  2: "Fair",
  3: "Good",
  4: "Strong",
};

export interface PasswordStrength {
  /** Number of criteria met, 0–4. Doubles as the number of filled meter bars. */
  score: number;
  /** null while the field is empty, so the meter stays hidden until typed into. */
  label: StrengthLabel | null;
}

export function unmetCriteria(pw: string): PasswordCriterion[] {
  return PASSWORD_CRITERIA.filter((c) => !c.test(pw));
}

export function evaluatePassword(pw: string): PasswordStrength {
  if (pw.length === 0) return { score: 0, label: null };
  const score = PASSWORD_CRITERIA.filter((c) => c.test(pw)).length;
  return { score, label: SCORE_LABEL[score] ?? null };
}
