import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The suite is integration-style and talks to a real Postgres; running test
    // files in parallel would let them contend for the same tables.
    fileParallelism: false,
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json.
    alias: { "@": resolve(process.cwd(), "src") },
  },
});
