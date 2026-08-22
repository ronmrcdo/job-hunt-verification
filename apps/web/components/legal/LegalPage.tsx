// Shared chrome for the three legal routes (/privacy, /terms, /disclaimer) —
// one clean version of the "fine print" layout so the pages differ only in
// their content. Mirrors the sign-in page idiom: white header, off-white
// surface-alt canvas, MicroLabel kicker, oversized tracking-tight h1, then a
// single readable prose column. Sections are numbered with mono labels, the
// same small-mono-against-big-type contrast the rest of the system uses.
import type { ReactNode } from "react";
import { SiteHeader } from "../site/SiteHeader";
import { SiteFooter } from "../site/SiteFooter";
import { MicroLabel } from "../ui/MicroLabel";

/** Inline link inside legal prose — underlined so it reads in a text block. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-semibold text-body underline decoration-rule-strong underline-offset-2 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:decoration-ink"
    >
      {children}
    </a>
  );
}

/** The one address legal/privacy requests go to, rendered as a real mailto. */
export function ContactEmail() {
  return <LegalLink href="mailto:contact@ronmrcdo.dev">contact@ronmrcdo.dev</LegalLink>;
}

export function LegalSection({
  number,
  heading,
  children,
}: {
  number: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-rule pt-8">
      <div className="flex items-baseline gap-4">
        <span aria-hidden="true" className="font-mono text-[11px] text-faint">
          {number}
        </span>
        <h2 className="m-0 text-[20px] font-bold leading-[1.2] tracking-[-0.02em]">{heading}</h2>
      </div>
      {/* Prose column: 15px/1.65 secondary, the report body scale. Lists and
          paragraphs inherit it so page content stays plain HTML. */}
      <div className="flex flex-col gap-3 pl-[31px] text-[15px] leading-[1.65] text-secondary max-[430px]:pl-0 [&_li]:mt-1 [&_p]:m-0 [&_strong]:text-body [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  kicker,
  title,
  intro,
  children,
}: {
  kicker: string;
  title: ReactNode;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <div className="min-h-[calc(100dvh-66px)] bg-surface-alt">
        <main
          id="main-content"
          className="mx-auto flex max-w-page flex-col px-8 py-16 max-[430px]:px-5"
        >
          <div className="flex max-w-[720px] flex-col gap-6">
            <MicroLabel>{kicker} · LAST UPDATED AUGUST 22, 2026</MicroLabel>
            <h1 className="m-0 text-[48px] font-bold leading-[0.98] tracking-[-0.03em] max-[430px]:text-[34px]">
              {title}
            </h1>
            <p className="m-0 text-[16px] leading-[1.6] text-secondary">{intro}</p>
          </div>
          <div className="mt-12 flex max-w-[720px] flex-col gap-8">{children}</div>
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
