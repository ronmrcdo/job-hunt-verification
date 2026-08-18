import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

MotionGlobalConfig.skipAnimations = true;

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
