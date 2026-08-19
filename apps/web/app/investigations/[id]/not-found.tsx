import { SiteHeader } from "../../../components/site/SiteHeader";
import { MicroLabel } from "../../../components/ui/MicroLabel";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-page px-6 py-16">
        <MicroLabel>NOT FOUND</MicroLabel>
        <p className="mt-2 font-mono text-[13px]">We couldn&apos;t find that report.</p>
      </main>
    </>
  );
}
