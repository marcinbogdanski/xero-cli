import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["other-repos/**", "dist/**", "node_modules/**"],
  },
});
