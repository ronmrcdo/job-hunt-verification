// Root 404 — served for any address with no route, and for any `notFound()`
// call that doesn't have a nearer boundary. Server component: the header and
// the error presentation do their own client work.
import { SiteHeader } from "../components/site/SiteHeader";
import { ErrorScreen } from "../components/site/ErrorScreen";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <ErrorScreen
        code="404"
        status="PAGE NOT FOUND"
        headline={"NOTHING LIVES\nAT THIS ADDRESS"}
        body="The link may be mistyped, or the page may have moved. Nothing has gone wrong with your account or with any check you've run — this address just doesn't point anywhere."
        details={[
          { label: "MEANING", value: "No page exists at the address you requested." },
          { label: "WHAT TO DO", value: "Re-check the link, or start again from the home page." },
        ]}
        actions={[
          { label: "GO TO HOME", href: "/", variant: "primary" },
          { label: "CHECK A JOB", href: "/verify", variant: "secondary" },
        ]}
      />
    </>
  );
}
