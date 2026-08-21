"use client";

// Route-segment error boundary — a crash anywhere below the root layout.
// The layout itself survives, so `reset()` can re-render the segment in
// place; that in-place retry is the primary action, and it beats telling
// someone to reload a page they may have reached mid-flow.
import { useEffect } from "react";
import { SiteHeader } from "../components/site/SiteHeader";
import { ErrorScreen } from "../components/site/ErrorScreen";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Client-side crashes never reach the server log on their own.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <SiteHeader />
      <ErrorScreen
        tone="critical"
        code="500"
        status="SOMETHING BROKE ON OUR SIDE"
        headline={"THIS PAGE\nDIDN'T LOAD"}
        body="This one is ours, not yours. Nothing you submitted was lost — any check already running keeps running, and you can pick it up again from your recent checks."
        details={[
          // The digest is the only handle that ties a report of this to the
          // server log, so it's shown verbatim when Next produced one — and
          // the row is dropped entirely rather than showing an empty value.
          ...(error.digest ? [{ label: "REFERENCE", value: error.digest }] : []),
          { label: "WHAT TO DO", value: "Try again. If it keeps failing, the reference above identifies this failure." },
        ]}
        actions={[
          { label: "TRY AGAIN", onClick: reset, variant: "primary" },
          { label: "GO TO HOME", href: "/", variant: "secondary" },
        ]}
      />
    </>
  );
}
