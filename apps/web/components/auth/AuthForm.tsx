"use client";

// The sign-in / create-account gate. There is no auth backend in V0 —
// "signing in" is purely local validation followed by the caller writing
// flow state and routing. SECURITY: the password never leaves this
// component's own state — it is passed to nothing, stored nowhere else,
// and never handed to onSuccess or flow storage (see flow-context.tsx).
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { TextField } from "../ui/TextField";
import { Button } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";
import type { AuthMode } from "../../lib/flow-context";

export interface AuthFormProps {
  onSuccess: (email: string, mode: AuthMode) => void;
}

const CTA_LABEL: Record<AuthMode, string> = {
  signin: "SIGN IN AND RUN THE CHECK",
  create: "CREATE ACCOUNT AND RUN THE CHECK",
};

export function AuthForm({ onSuccess }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showInvalid, setShowInvalid] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || password.length < 8) {
      setShowInvalid(true);
      return;
    }
    setShowInvalid(false);
    onSuccess(email, mode);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 border border-ink p-6">
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

      <TextField label="Email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <TextField
        label="Password"
        value={password}
        onChange={setPassword}
        type="password"
        placeholder="At least 8 characters"
      />

      {showInvalid ? (
        <div className="rounded-none border border-warn-rule bg-warn-tint p-3">
          <p className="text-[13px] leading-[1.5]">
            Enter an email and a password of at least 8 characters to continue.
          </p>
        </div>
      ) : null}

      <Button type="submit" variant="primary" size="wide">
        {CTA_LABEL[mode]}
      </Button>

      <div className="text-[13px] leading-[1.5] text-muted">
        <MicroLabel>WHY WE ASK</MicroLabel>
        <p className="mt-1">
          Signing in attaches this report to your account so you can find it later. We don&apos;t
          share your posting — privacy is enforced per-browser, not by who you tell us you are.
        </p>
      </div>

      <Link href="/" className="text-[13px] text-muted underline-offset-2 hover:underline">
        Back to the posting
      </Link>
    </form>
  );
}
