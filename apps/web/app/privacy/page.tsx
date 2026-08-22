// /privacy — the full privacy policy. Plain-language and specific to what the
// product actually does: self-hosted infrastructure, Google sign-in and
// Resend as the only named third parties, IP-based rate limiting, and
// visitor-count-only analytics gated by the cookie banner.
import { ContactEmail, LegalPage, LegalSection } from "../../components/legal/LegalPage";

export const metadata = {
  title: "Privacy Policy — Jobverifai",
  description:
    "What Jobverifai collects, the services it relies on, and how to reach us about your data.",
};

export default function Page() {
  return (
    <LegalPage
      kicker="THE FINE PRINT"
      title={
        <>
          PRIVACY
          <br />
          POLICY
        </>
      }
      intro="Jobverifai runs on our own self-hosted infrastructure. We collect the minimum the product needs to work, we never sell any of it, and this page lists all of it — nothing is collected that isn't described here."
    >
      <LegalSection number="01" heading="What we collect">
        <p>
          <strong>Your account.</strong> An email address and a password (stored only as a hash),
          or — if you sign in with Google — the name and email address Google shares with us.
        </p>
        <p>
          <strong>Your submissions.</strong> The job links, postings, and recruiter messages you
          paste in to run a check, and the reports we produce from them. Reports are private to
          your account.
        </p>
        <p>
          <strong>Operational data.</strong> Your IP address, used for rate limiting (see section
          03) and basic security logs. We don&rsquo;t build browsing profiles from it.
        </p>
      </LegalSection>

      <LegalSection number="02" heading="Services we rely on">
        <p>
          Everything runs on servers we operate ourselves, with two exceptions — both used only
          for what&rsquo;s named here:
        </p>
        <ul>
          <li>
            <strong>Google</strong> — optional sign-in. If you choose &ldquo;Sign in with
            Google&rdquo;, Google authenticates you and shares your name and email with us. Your
            use of Google sign-in is governed by Google&rsquo;s own privacy policy.
          </li>
          <li>
            <strong>Resend</strong> — transactional email. Resend receives your email address to
            deliver verification emails and password resets. It sends nothing else, and no
            marketing.
          </li>
        </ul>
        <p>We don&rsquo;t use ad networks, tracking pixels, or data brokers.</p>
      </LegalSection>

      <LegalSection number="03" heading="Rate limiting">
        <p>
          To keep the service free and available to real job seekers, we rate-limit requests by IP
          address. This is an anti-bot and anti-abuse measure: IPs are processed to enforce the
          limits, not to identify or profile you, and are kept only as long as the limits need.
        </p>
      </LegalSection>

      <LegalSection number="04" heading="Analytics">
        <p>
          Our analytics is self-hosted and used for one thing: aggregate visitor counts, so we
          know whether people use the product. It only runs if you allow it in the cookie notice.
          We don&rsquo;t track you across other sites, we don&rsquo;t build individual profiles,
          and analytics data — like everything else here — is never sold or shared.
        </p>
      </LegalSection>

      <LegalSection number="05" heading="Cookies">
        <p>
          We set an essential session cookie when you sign in — the service can&rsquo;t work
          without it, so it doesn&rsquo;t require consent. Analytics only runs after you choose
          &ldquo;Allow analytics&rdquo; in the cookie notice; your choice is stored in your
          browser and you can change it by clearing site data.
        </p>
      </LegalSection>

      <LegalSection number="06" heading="Retention and your rights">
        <p>
          Your account, submissions, and reports are kept while your account exists. Email{" "}
          <ContactEmail /> to ask what we hold about you, correct it, or have your account and
          everything tied to it deleted — we&rsquo;ll confirm when it&rsquo;s done.
        </p>
      </LegalSection>

      <LegalSection number="07" heading="Changes and contact">
        <p>
          If this policy changes, the date at the top changes with it, and material changes will
          be called out in the product. Questions about your data go to <ContactEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
