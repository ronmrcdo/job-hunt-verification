"use client";

// The auth gate between pasting a posting and running the check. There is
// no auth backend in V0 (see AuthForm.tsx) — signing in just records local
// flow state and routes to the check screen.
import { useRouter } from "next/navigation";
import { SiteHeader } from "../../components/site/SiteHeader";
import { MicroLabel } from "../../components/ui/MicroLabel";
import { AuthForm } from "../../components/auth/AuthForm";
import { QueuedCard } from "../../components/auth/QueuedCard";
import { useFlow } from "../../lib/flow-context";
import type { AuthMode } from "../../lib/flow-context";

export default function Page() {
  const router = useRouter();
  const { set } = useFlow();

  function onSuccess(email: string, mode: AuthMode) {
    set({ signedIn: true, authEmail: email, authMode: mode });
    router.push("/check/new");
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-8 py-16 md:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-6">
          <MicroLabel>STEP 2 OF 3 · SIGN IN REQUIRED</MicroLabel>
          <h1 className="m-0 text-[48px] font-bold leading-[0.98] tracking-[-0.03em]">
            SIGN IN TO RUN
            <br />
            THIS CHECK
          </h1>
          <p className="max-w-[520px] text-[16px] leading-[1.6] text-secondary">
            We ask you to sign in so this report attaches to your account and you can find it
            later — not to see who you are. Privacy is enforced per-browser, via a private key
            your browser holds; we never share the posting you pasted.
          </p>
          <QueuedCard />
        </div>
        <AuthForm onSuccess={onSuccess} />
      </main>
    </>
  );
}
