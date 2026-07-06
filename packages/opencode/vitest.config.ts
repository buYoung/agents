import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@opencode\/core\/(.*)$/, replacement: `${root}src/core/$1` },
      {
        find: /^@opencode\/agents\/(.*)$/,
        replacement: `${root}src/agents/$1`,
      },
      { find: /^@opencode\/(.*)$/, replacement: `${root}src/$1` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", ".git/**", ".opencode/**"],
  },
});
