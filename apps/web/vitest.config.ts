import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // Pass even with no test files — dashboard tests added in Phase 4.
    passWithNoTests: true,
  },
});

