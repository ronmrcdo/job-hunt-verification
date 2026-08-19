import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

MotionGlobalConfig.skipAnimations = true;

// Global default mock for the browser Supabase client (SiteHeader calls it
// on every mount to read the session). Real Supabase creds are never set in
// tests, so unmocked, `createClient()` throws. Individual suites (AuthForm,
// SiteHeader) that assert on specific auth calls declare their own
// `vi.mock("../../lib/supabase/client", ...)`, which takes precedence over
// this default for that file.
vi.mock("./lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  }),
}));

// jsdom has no IntersectionObserver, which framer-motion's `whileInView`
// (used by the scroll-reveal sections) requires. Stub it to report the target
// as immediately intersecting so revealed content is present for assertions.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

afterEach(() => cleanup());
