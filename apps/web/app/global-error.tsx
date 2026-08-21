"use client";

// Last-resort boundary: the root layout itself threw, so it is NOT in the
// tree. This file has to supply its own <html>/<body> and its own stylesheet
// import, and it deliberately renders no SiteHeader — the header reads the
// Supabase session, and whatever took down the layout may well take that
// down too. Fonts are gone as well, so the body falls back to the same
// Helvetica stack --font-sans resolves to.
import "./globals.css";
import { ErrorScreen } from "../components/site/ErrorScreen";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen
          tone="critical"
          code="500"
          status="THE APP FAILED TO START"
          headline={"WE COULDN'T\nLOAD THE APP"}
          body="Something failed before the page could be built. This is on our side. Reloading usually clears it."
          details={[
            ...(error.digest ? [{ label: "REFERENCE", value: error.digest }] : []),
            { label: "WHAT TO DO", value: "Reload. If it keeps failing, try again in a few minutes." },
          ]}
          actions={[{ label: "TRY AGAIN", onClick: reset, variant: "primary" }]}
        />
      </body>
    </html>
  );
}
