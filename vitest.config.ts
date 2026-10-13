import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
