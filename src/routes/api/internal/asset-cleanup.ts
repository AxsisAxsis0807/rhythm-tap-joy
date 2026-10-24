import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/internal/asset-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { runAssetCleanup, validCleanupCredential } =
          await import("@/lib/assetCleanup.server");
        if (!process.env["PULSE_CLEANUP_TOKEN"])
          return new Response("Cleanup is not configured", { status: 503 });
        if (!(await validCleanupCredential(request.headers.get("authorization"))))
          return new Response("Forbidden", { status: 403 });
        try {
          const result = await runAssetCleanup();
          return Response.json(result, {
            status: result.failed > 0 ? 503 : 200,
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return new Response("Cleanup failed; inspect job state", { status: 503 });
        }
      },
    },
  },
});
