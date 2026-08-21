// Report-scoped 404, reached from `notFound()` in the report page. RLS scopes
// the SELECT to the owning user, so a missing report and someone else's
// report are the same outcome here — and the copy deliberately keeps them the
// same, rather than confirming a report exists to an account that can't open
// it.
import { SiteHeader } from "../../../components/site/SiteHeader";
import { ErrorScreen } from "../../../components/site/ErrorScreen";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <ErrorScreen
        code="404"
        status="REPORT NOT FOUND"
        headline={"WE COULDN'T OPEN\nTHAT REPORT"}
        body="Either no report exists at this address, or it belongs to another account. Reports are private to the person who ran the check, so we don't say which."
        details={[
          { label: "MEANING", value: "No report at this address is readable by you." },
          { label: "WHAT TO DO", value: "Open it from your own recent checks, or run a new check." },
        ]}
        actions={[
          { label: "YOUR RECENT CHECKS", href: "/verify", variant: "primary" },
          { label: "GO TO HOME", href: "/", variant: "secondary" },
        ]}
      />
    </>
  );
}
