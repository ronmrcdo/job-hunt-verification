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
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
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
  // Cloudflare Turnstile is active only when a site key is configured. When it
  // is, GoTrue (captcha enabled server-side) rejects signup/sign-in without a
  // valid token, so the widget must produce one and we pass it on. Read at
  // render (not module scope) so Next inlines NEXT_PUBLIC_* per-occurrence and
  // tests can stub it.
  const captchaSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const captchaActive = Boolean(captchaSiteKey);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

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
    if (captchaActive && !captchaToken) {
      setAuthError("Please complete the verification challenge before continuing.");
      return;
    }
    setBusy("submit");
    let attempted = false;
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      if (mode === "signin") {
        attempted = true;
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
          ...(captchaToken ? { options: { captchaToken } } : {}),
        });
        if (error) {
          setAuthError(error.message);
          return;
        }
        router.push("/verify");
      } else {
        attempted = true;
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: values.fullName },
            ...(captchaToken ? { captchaToken } : {}),
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
      // Turnstile tokens are single-use — after any real attempt, discard the
      // spent token and reset the widget so a retry gets a fresh one.
      if (attempted && captchaActive) {
        turnstileRef.current?.reset();
        setCaptchaToken(null);
      }
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
        className="flex flex-col gap-4 border border-ink bg-page p-6"
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
      className="flex flex-col gap-4 border border-ink bg-page p-6"
    >
      {/* Card header row from the prototype — a quiet "SECURE" reassurance
          balanced against the section label. */}
      <div className="-mx-6 flex items-center justify-between border-b border-rule px-6 pb-4">
        <MicroLabel>Sign in</MicroLabel>
        <MicroLabel>Secure</MicroLabel>
      </div>

      <div className="flex border border-ink">
        <button
          type="button"
          onClick={() => setMode("signin")}
          aria-pressed={mode === "signin"}
          className={`flex-1 rounded-none px-[13px] py-[10px] text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-150 [transition-timing-function:var(--ease-out)] ${
            mode === "signin" ? "bg-ink text-page" : "bg-transparent hover:bg-surface-soft"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          aria-pressed={mode === "create"}
          className={`flex-1 rounded-none px-[13px] py-[10px] text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-150 [transition-timing-function:var(--ease-out)] ${
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

      {captchaActive ? (
        <Turnstile
          ref={turnstileRef}
          siteKey={captchaSiteKey as string}
          onSuccess={setCaptchaToken}
          onExpire={() => setCaptchaToken(null)}
          onError={() => setCaptchaToken(null)}
          options={{ theme: "light", size: "flexible" }}
        />
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

      <hr className="m-0 border-0 border-t border-rule" />

      <div className="text-[13px] leading-[1.5] text-muted">
        <MicroLabel>WHY WE ASK</MicroLabel>
        <p className="mt-1">
          Your reports stay private to your account · we hold an unfinished check for you ·
          repeat checks on the same posting are counted, never published.
        </p>
      </div>

      <Link
        href="/"
        className="text-[10px] uppercase tracking-[0.15em] text-muted underline underline-offset-2 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink"
      >
        Back to the posting
      </Link>
    </form>
  );
}
