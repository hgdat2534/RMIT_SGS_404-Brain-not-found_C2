import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
