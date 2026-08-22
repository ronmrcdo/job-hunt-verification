// /disclaimer — "How we handle your data": the plain-language explanation of
// the AI investigation pipeline the footer link promises. The privacy policy
// lists what's collected; this page explains what happens to a submission
// when a check runs, and the things we commit to never doing.
import { ContactEmail, LegalLink, LegalPage, LegalSection } from "../../components/legal/LegalPage";

export const metadata = {
  title: "How We Handle Your Data — Jobverifai",
  description:
    "What happens to a job posting when you run a check: how the AI processes it, and what we never do with it.",
};

export default function Page() {
  return (
    <LegalPage
      kicker="THE FINE PRINT"
      title={
        <>
          HOW WE HANDLE
          <br />
          YOUR DATA
        </>
      }
      intro="Running a check means handing us a job posting or a recruiter's message. Here is exactly what happens to it — in the order it happens — and the lines we don't cross."
    >
      <LegalSection number="01" heading="What happens when you run a check">
        <p>
          The content you paste is fed to an AI model running on our infrastructure, with our
          instructions, to investigate it: extracting the company, recruiter, and claims, then
          checking them against publicly available sources — official registries, company sites,
          and the like. The AI works only from your submission and that public evidence.
        </p>
      </LegalSection>

      <LegalSection number="02" heading="What the AI sees — and doesn't">
        <p>
          The AI receives your submitted content and the public pages it fetches while
          investigating. It does not receive your password or your account details beyond what the
          investigation needs. Fetched content is treated as untrusted: it&rsquo;s evidence to be
          verified, never instructions to be followed.
        </p>
      </LegalSection>

      <LegalSection number="03" heading="Your report stays yours">
        <p>
          Reports name companies and people, so they don&rsquo;t sit on a public page. Each report
          is private to the account that ran it, stored on our self-hosted servers.
        </p>
      </LegalSection>

      <LegalSection number="04" heading="What we never do">
        <ul>
          <li>
            We <strong>never sell</strong> your data — submissions, reports, email, any of it.
          </li>
          <li>We never use your submissions to train AI models.</li>
          <li>We never run ad tracking or share data with ad networks or data brokers.</li>
          <li>We never charge you, and we never ask for payment details.</li>
        </ul>
      </LegalSection>

      <LegalSection number="05" heading="Removing your data">
        <p>
          Email <ContactEmail /> to delete your account — your submissions and reports go with
          it, and we&rsquo;ll confirm when it&rsquo;s done. The full inventory of what we collect
          is in the{" "}
          <LegalLink href="/privacy">privacy policy</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
