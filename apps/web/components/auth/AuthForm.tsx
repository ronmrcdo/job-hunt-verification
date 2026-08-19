"use client";

// The sign-in / create-account gate, backed by real Supabase auth.
// SECURITY: the password lives only in react-hook-form's field state — it
// is passed straight to Supabase and never written into flow state or
// storage (see flow-context.tsx).
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";
import { authSchema, type AuthInput } from "../../lib/validation";
import { createClient } from "../../lib/supabase/client";

type Mode = "signin" | "create";

const CTA_LABEL: Record<Mode, string> = {
  signin: "SIGN IN AND RUN THE CHECK",
  create: "CREATE ACCOUNT AND RUN THE CHECK",
};

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [authError, setAuthError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthInput>({ resolver: zodResolver(authSchema) });

  async function onSubmit(values: AuthInput) {
    setAuthError(null);
    setConfirmSent(false);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) {
        setAuthError(error.message);
        return;
      }
      router.push("/verify");
    } else {
      const { error } = await supabase.auth.signUp({
        ...values,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setConfirmSent(true);
    }
  }

  async function onGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  const fieldError = errors.email?.message ?? errors.password?.message ?? null;

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
          className={`flex-1 rounded-none p-[13px] text-[13px] font-bold uppercase tracking-[0.08em] ${
            mode === "signin" ? "bg-ink text-page" : "bg-transparent"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          aria-pressed={mode === "create"}
          className={`flex-1 rounded-none p-[13px] text-[13px] font-bold uppercase tracking-[0.08em] ${
            mode === "create" ? "bg-ink text-page" : "bg-transparent"
          }`}
        >
          Create account
        </button>
      </div>

      <Controller
        name="email"
        control={control}
        defaultValue=""
        render={({ field }) => (
          <TextField
            label="Email"
            type="email"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="you@example.com"
            autoComplete="email"
          />
        )}
      />
      <Controller
        name="password"
        control={control}
        defaultValue=""
        render={({ field }) => (
          <TextField
            label="Password"
            type="password"
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="At least 8 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        )}
      />

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

      {confirmSent ? (
        <div role="status" className="rounded-none border border-rule bg-page p-3">
          <p className="text-[13px] leading-[1.5]">
            Check your email to confirm your account before signing in.
          </p>
        </div>
      ) : null}

      <Button type="submit" variant="primary" size="wide">
        {CTA_LABEL[mode]}
      </Button>

      <Button type="button" variant="secondary" size="wide" onClick={onGoogle}>
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
