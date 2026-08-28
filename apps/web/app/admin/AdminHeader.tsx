// Minimal admin top bar. Server component: admin identity is already proven at
// the CF Access edge, so no client JS, no account menu, no CTA. Reuses
// SiteHeader's shell tokens; two in-page anchors jump to the console sections.
export function AdminHeader() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:border focus:border-ink focus:bg-page focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-rule bg-page">
        <div className="mx-auto flex h-[66px] max-w-page items-center px-8 max-[430px]:px-5">
          <span className="flex items-center gap-3">
            <span className="h-[13px] w-[13px] bg-ink" aria-hidden="true" />
            <span className="text-[17px] font-bold tracking-[-0.015em]">Jobverifai</span>
            <span className="font-mono text-[11px] text-muted">Admin</span>
          </span>
          <nav className="ml-auto flex items-center gap-6">
            <a href="#overview" className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
              Overview
            </a>
            <a href="#feedback" className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
              Feedback
            </a>
            <a href="#export" className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
              Export
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}
