// /terms — disclaimer & terms of use. The load-bearing page: it frames every
// report as informational evidence, not a determination, and states the
// acceptable-use rules the rate limiter enforces.
import { ContactEmail, LegalLink, LegalPage, LegalSection } from "../../components/legal/LegalPage";

export const metadata = {
  title: "Disclaimer & Terms of Use — Jobverifai",
  description:
    "What Jobverifai's reports are (and aren't), and the rules for using the service.",
};

export default function Page() {
  return (
    <LegalPage
      kicker="THE FINE PRINT"
      title={
        <>
          DISCLAIMER &amp;
          <br />
          TERMS OF USE
        </>
      }
      intro="Jobverifai is a free tool that checks what can be verified about a job posting and shows the evidence. Using it means you accept the terms below — most importantly, that a report informs your judgement and never replaces it."
    >
      <LegalSection number="01" heading="What the service is">
        <p>
          You paste a job link or a recruiter message; we investigate what can be verified from
          public sources and return a report showing what we found, what we couldn&rsquo;t reach,
          and the evidence behind every finding. The service is free and we will never ask you to
          pay.
        </p>
      </LegalSection>

      <LegalSection number="02" heading="Reports are informational — not a determination">
        <p>
          A report is evidence-based, but it is <strong>not a legal determination</strong>, not a
          background check, not legal or financial advice, and not a guarantee that a posting is
          safe or fraudulent. Evidence can be incomplete, sources can be unreachable, and scammers
          adapt. A finding of &ldquo;nothing suspicious&rdquo; is not a promise of legitimacy, and
          a critical finding is not an accusation of a crime. Always do your own verification
          before sharing personal information, sending money, or accepting an offer.
        </p>
      </LegalSection>

      <LegalSection number="03" heading="No warranty and limitation of liability">
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          warranties of any kind. To the maximum extent permitted by applicable law, we are not
          liable for decisions made, or losses incurred, in reliance on a report or on the
          service&rsquo;s availability.
        </p>
      </LegalSection>

      <LegalSection number="04" heading="Acceptable use">
        <p>The service is for people checking jobs they are personally considering. You agree not to:</p>
        <ul>
          <li>run bots, scrapers, or bulk automation against it, or farm checks;</li>
          <li>attempt to bypass the rate limits that keep it available to everyone;</li>
          <li>submit content designed to manipulate or sabotage an investigation;</li>
          <li>use reports to harass, defame, or target any person or company.</li>
        </ul>
        <p>
          We enforce this with rate limiting and may throttle, suspend, or delete accounts that
          abuse the service.
        </p>
      </LegalSection>

      <LegalSection number="05" heading="Your submissions">
        <p>
          Submit only content you lawfully have — a posting or message that was sent to you or is
          publicly available. You keep whatever rights you have in it; you grant us what&rsquo;s
          needed to process it and produce your report, as described in{" "}
          <LegalLink href="/disclaimer">How we handle your data</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection number="06" heading="Changes and contact">
        <p>
          We may update these terms; the date at the top reflects the current version, and
          continuing to use the service after a change means you accept it. Questions go to{" "}
          <ContactEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
