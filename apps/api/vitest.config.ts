import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:test@127.0.0.1:5432/guitarhub_test?schema=public",
      LOG_LEVEL: "silent",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Baselines measured 2026-10 (92.9/85.0/95.3/93.8); floors catch regressions.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 93,
        lines: 91,
      },
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/test/**",
        "**/*.config.*",
        "**/scripts/**",
        "**/prisma/migrations/**",
      ],
    },
  },
});
