import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    env: {
      NODE_ENV: "test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Baselines measured 2026-10 (76.6/69.3/72.8/79.2); floors catch regressions.
      thresholds: {
        statements: 74,
        branches: 66,
        functions: 70,
        lines: 76,
      },
      exclude: [
        "**/node_modules/**",
        "**/.next/**",
        "**/coverage/**",
        "**/*.config.*",
        "**/next-env.d.ts",
      ],
    },
  },
});
