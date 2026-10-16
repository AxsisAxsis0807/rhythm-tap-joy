import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../fixtures/song-settings", import.meta.url)),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "fixture-upload",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith("/test-upload/")) return next();
          request.resume();
          request.on("end", () => {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json");
            response.end("{}");
          });
        });
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: "@/lib/songSettings.functions",
        replacement: fileURLToPath(new URL("./songSettings.functions.ts", import.meta.url)),
      },
      {
        find: "@/lib/ownerTransport",
        replacement: fileURLToPath(new URL("./ownerTransport.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("../../src", import.meta.url)) },
    ],
  },
  define: {
    __FIXTURE_AUDIO_HASH__: JSON.stringify(
      createHash("sha256")
        .update(readFileSync("tests/fixtures/song-settings/impulse.wav"))
        .digest("hex"),
    ),
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  build: { outDir: "../../work/e2e-build", emptyOutDir: true },
});
