import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The CLI tests exercise config/baseline/scenario discovery, which walks up
    // from the working directory — that needs a real process to chdir.
    pool: "forks",
  },
});
