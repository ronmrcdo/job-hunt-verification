"use client";

// The sign-in / create-account gate, backed by real Supabase auth.
// SECURITY: the password lives only in react-hook-form's field state — it
// is passed straight to Supabase and never written into flow state or
// storage (see flow-context.tsx).
import { useMemo, useRef, useState } from "react";
import { useForm, Controller, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";
import { PasswordStrength } from "./PasswordStrength";
import { authSchema, createAccountSchema } from "../../lib/validation";
import { createClient } from "../../lib/supabase/client";
import { useFlowOptional } from "../../lib/flow-context";
import { SPRING } from "../../lib/motion";

type Mode = "signin" | "create";

// One form, two shapes: sign-in uses email+password; create-account adds a
// full name and a confirmation. All fields are always registered (default "")
// so react-hook-form keeps them controlled across mode switches.
interface AuthFormValues {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const PRIMARY_LABEL: Record<Mode, string> = {
  signin: "SIGN IN",
  create: "CREATE ACCOUNT",
};

const PENDING_LABEL: Record<Mode, string> = {
  signin: "SIGNING IN…",
  create: "CREATING ACCOUNT…",
};

export function AuthForm() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const flow = useFlowOptional();
  // The gate only promises to "run the check" when there's actually a posting
  // queued behind it (see QueuedCard). Otherwise the CTA is a plain action.
  const hasQueuedCheck = (flow?.state.jobInput ?? "").trim().length > 0;
  const [mode, setMode] = useState<Mode>("signin");
  const [authError, setAuthError] = useState<string | null>(null);
  // Holds the address a confirmation link was just sent to. Non-null = the
  // form has been replaced by the "check your email" success panel.
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  // Which async action is in flight, so exactly one button spins and both
  // (plus repeat submits) are locked out until it resolves.
  const [busy, setBusy] = useState<null | "submit" | "google">(null);

  // The active schema follows `mode`. A ref keeps the resolver stable while
  // still reading the current mode, so validation switches the instant the
  // user toggles tabs — no stale schema from a memoised closure.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const resolver = useMemo<Resolver<AuthFormValues>>(
    () => (values, context, options) =>
      zodResolver(modeRef.current === "create" ? createAccountSchema : authSchema)(
        values,
        context,
        options,
      ),
    [],
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthFormValues>({
    resolver,
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  const password = useWatch({ control, name: "password" }) ?? "";

  async function onSubmit(values: AuthFormValues) {
    if (busy) return;
    setAuthError(null);
    setBusy("submit");
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        });
        if (error) {
          setAuthError(error.message);
          return;
        }
        router.push("/verify");
      } else {
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: values.fullName },
          },
        });
        if (error) {
          setAuthError(error.message);
          return;
        }
        setConfirmedEmail(values.email);
      }
    } finally {
      setBusy(null);
    }
  }

  async function onGoogle() {
    if (busy) return;
    setAuthError(null);
    setBusy("google");
    try {
      const supabase = createClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    } finally {
      // A successful OAuth call navigates away; clearing here only matters if
      // the redirect never happens (e.g. it errored before leaving).
      setBusy(null);
    }
  }

  const fieldError =
    errors.fullName?.message ??
    errors.email?.message ??
    errors.password?.message ??
    errors.confirmPassword?.message ??
    null;
  const submitting = busy === "submit";
  const runSuffix = hasQueuedCheck ? " AND RUN THE CHECK" : "";
  const ctaLabel = `${PRIMARY_LABEL[mode]}${runSuffix}`;

  // Account created — swap the whole form for a prominent, first-time
  // confirmation. This is a rare moment, so a little entrance delight earns
  // its place (Emil: rare/first-time interactions can be delightful).
  if (confirmedEmail) {
    return (
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(4px)" }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.42, ...SPRING }}
        className="flex flex-col gap-4 border border-ink p-6"
        role="status"
      >
        <div className="flex h-9 w-9 items-center justify-center bg-legit text-page">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
            <path
              d="M4 10.5l3.5 3.5L16 5.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <MicroLabel>ACCOUNT CREATED</MicroLabel>
          <h2 className="m-0 text-[22px] font-bold leading-[1.15] tracking-[-0.01em]">
            Confirm your email
          </h2>
          <p className="text-[14px] leading-[1.6] text-secondary">
            We sent a confirmation link to{" "}
            <span className="font-mono text-body">{confirmedEmail}</span>. Open it, then sign in
            {hasQueuedCheck
              ? " to run your check — the posting stays queued for you."
              : " to start your first check."}
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="wide"
          onClick={() => {
            setConfirmedEmail(null);
            setMode("signin");
          }}
        >
          Back to sign in
        </Button>

        <Link href="/" className="text-[13px] text-muted underline-offset-2 hover:underline">
          Back to the posting
        </Link>
      </motion.div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 border border-ink p-6"
    >
      <div className="flex border border-ink">
        <button
          type="button"
          onClick={() => setMode("signin")}
          aria-pressed={mode === "signin"}
          className={`flex-1 rounded-none p-[13px] text-[13px] font-bold uppercase tracking-[0.08em] transition-colors duration-150 [transition-timing-function:var(--ease-out)] ${
            mode === "signin" ? "bg-ink text-page" : "bg-transparent hover:bg-surface-soft"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          aria-pressed={mode === "create"}
          className={`flex-1 rounded-none p-[13px] text-[13px] font-bold uppercase tracking-[0.08em] transition-colors duration-150 [transition-timing-function:var(--ease-out)] ${
            mode === "create" ? "bg-ink text-page" : "bg-transparent hover:bg-surface-soft"
          }`}
        >
          Create account
        </button>
      </div>

      {mode === "create" ? (
        <Controller
          name="fullName"
          control={control}
          render={({ field }) => (
            <TextField
              label="Full name"
              type="text"
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Ada Lovelace"
              autoComplete="name"
              invalid={Boolean(errors.fullName)}
            />
          )}
        />
      ) : null}

      <Controller
        name="email"
        control={control}
        render={({ field }) => (
          <TextField
            label="Email"
            type="email"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="you@example.com"
            autoComplete="email"
            invalid={Boolean(errors.email)}
          />
        )}
      />
      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <TextField
            label="Password"
            type="password"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="At least 8 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            invalid={Boolean(errors.password)}
          />
        )}
      />

      {mode === "create" ? (
        <>
          <PasswordStrength password={password} />
          <Controller
            name="confirmPassword"
            control={control}
            render={({ field }) => (
              <TextField
                label="Confirm password"
                type="password"
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                invalid={Boolean(errors.confirmPassword)}
              />
            )}
          />
        </>
      ) : null}

      {fieldError ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{fieldError}</p>
        </div>
      ) : null}

      {authError ? (
        <div role="alert" className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">{authError}</p>
        </div>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="wide"
        pending={submitting}
        pendingLabel={PENDING_LABEL[mode]}
        disabled={busy === "google"}
      >
        {ctaLabel}
      </Button>

      <Button
        type="button"
        variant="secondary"
        size="wide"
        onClick={onGoogle}
        pending={busy === "google"}
        pendingLabel="CONNECTING…"
        disabled={submitting}
      >
        Continue with Google
      </Button>

      <div className="text-[13px] leading-[1.5] text-muted">
        <MicroLabel>WHY WE ASK</MicroLabel>
        <p className="mt-1">
          Your reports stay private to your account · we hold an unfinished check for you ·
          repeat checks on the same posting are counted, never published.
        </p>
      </div>

      <Link href="/" className="text-[13px] text-muted underline-offset-2 hover:underline">
        Back to the posting
      </Link>
    </form>
  );
}
