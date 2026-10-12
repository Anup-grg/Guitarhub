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
