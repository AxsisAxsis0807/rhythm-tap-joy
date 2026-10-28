// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "@wasm-audio-decoders/opus-ml": new URL(
          "./src/lib/codecs/opusMlUnavailable.ts",
          import.meta.url,
        ).pathname,
      },
    },
    plugins: [
      {
        name: "song-settings-server-wasm",
        enforce: "pre",
        async resolveId(source, importer, options) {
          if (!options.ssr || !source.endsWith(".wasm?module")) return null;
          const resolved = await this.resolve(source.slice(0, -7), importer, { skipSelf: true });
          return resolved ? { id: `${resolved.id}?module`, external: "absolute" as const } : null;
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
