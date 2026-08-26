import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      // Next's webpack build no-ops "server-only" in server bundles and only
      // throws it in client bundles; vitest has no such split, and the raw
      // package throws unconditionally. Alias it to a no-op so server-only
      // modules (lib/admin/access.ts, lib/supabase/admin.ts) are importable
      // under test, matching how they actually behave in production.
      "server-only": fileURLToPath(new URL("./vitest.server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
