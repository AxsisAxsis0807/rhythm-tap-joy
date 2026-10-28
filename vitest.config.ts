import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    {
      name: "test-static-wasm",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".wasm?module")) {
          const bytes = readFileSync(id.slice(0, -7));
          return `export default new WebAssembly.Module(Uint8Array.from(${JSON.stringify([...bytes])}));`;
        }
        return null;
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    server: { deps: { inline: [/@jsquash/] } },
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    testTimeout: 15000,
  },
});
