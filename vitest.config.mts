import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The suite is integration-style and talks to a real Postgres; running test
    // files in parallel would let them contend for the same tables.
    fileParallelism: false,
    // That database can be remote (Supabase), where a test firing 15 concurrent
    // checkouts takes seconds rather than milliseconds. The 5s default failed
    // those tests before they could prove anything, so a failure here should
    // mean broken logic rather than a slow network.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json.
    alias: { "@": resolve(process.cwd(), "src") },
  },
});
