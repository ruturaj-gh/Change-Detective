import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Give file-system tests enough time.
    testTimeout: 30_000,
    hookTimeout: 10_000,
  },
});

