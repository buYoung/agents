import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const opencodeRoot = fileURLToPath(
  new URL("../../packages/opencode/", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@cli\/(.*)$/, replacement: `${root}src/$1` },
      {
        find: /^@opencode\/core\/(.*)$/,
        replacement: `${opencodeRoot}src/core/$1`,
      },
      {
        find: /^@opencode\/agents\/(.*)$/,
        replacement: `${opencodeRoot}src/agents/$1`,
      },
      { find: /^@opencode\/(.*)$/, replacement: `${opencodeRoot}src/$1` },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", ".git/**", ".opencode/**"],
  },
});
