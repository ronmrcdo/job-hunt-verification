// @vitest-environment node
import { describe, it, expect } from "vitest";

// next/og renders through satori, which accepts only a strict subset of CSS and
// throws at *render* time — a mistake here compiles fine and only surfaces when
// the page is prerendered, i.e. it breaks `next build`. So actually read the
// body and check the PNG magic bytes rather than trusting the Response object.
import Image from "../opengraph-image";

describe("/opengraph-image", () => {
  it("renders to a PNG (satori accepts the markup)", async () => {
    const bytes = new Uint8Array(await Image().arrayBuffer());
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 30_000);
});
