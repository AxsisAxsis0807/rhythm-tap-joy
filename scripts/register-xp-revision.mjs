/** Operator-only, dry-run by default. Never imported by the application. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
const args = process.argv.slice(2);
const option = (key) => {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
};
const duration = Number(option("--audio-duration"));
if (!Number.isFinite(duration) || duration <= 0 || duration > 7200)
  throw new Error(
    "Provide independently measured --audio-duration seconds (ffprobe), not browser-reported time.",
  );
const vite = await createServer({
  configFile: false,
  resolve: { alias: { "@": resolve("src") } },
  server: { middlewareMode: true, ws: false, hmr: false },
  appType: "custom",
});
try {
  const { chartRevision, sha256 } = await vite.ssrLoadModule("/src/game/replay.ts");
  let source;
  if (option("--built-in") === "test-120")
    source = (await vite.ssrLoadModule("/src/game/charts/test-chart.ts")).TEST_CHART;
  else if (option("--built-in") === "bewilderment-insane")
    source = (await vite.ssrLoadModule("/src/game/charts/bewilderment.ts")).BEWILDERMENT_CHART;
  else if (option("--file")) source = JSON.parse(await readFile(option("--file"), "utf8"));
  else throw new Error("Use --built-in test-120|bewilderment-insane or --file reviewed-chart.json");
  if (source.fnf) {
    const side = option("--side") ?? source.fnf.playerSide;
    if (!["left", "right"].includes(side)) throw new Error("Invalid side");
    source = { ...source, notes: source.fnf[side], fnf: { ...source.fnf, playerSide: side } };
  }
  const chart = chartRevision(source),
    digest = await sha256(chart);
  if (chart.fnf && JSON.stringify(chart.notes) !== JSON.stringify(chart.fnf[chart.fnf.playerSide]))
    throw new Error("Selected side does not match revision");
  if (chart.notes.some((n) => chart.offset + (n.beat * 60) / chart.bpm > duration + 0.2))
    throw new Error("Chart extends beyond independently measured audio");
  const record = {
    digest,
    song_id: chart.id,
    chart,
    audio_duration: duration,
    verifier_version: 1,
    approved: args.includes("--approve"),
  };
  if (option("--write")) await writeFile(option("--write"), JSON.stringify(record, null, 2) + "\n");
  if (args.includes("--apply")) {
    const url = process.env.SUPABASE_URL,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error(
        "Set server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the existing project",
      );
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: old, error: readError } = await client
      .from("chart_revisions")
      .select("digest,approved")
      .eq("digest", digest)
      .maybeSingle();
    if (readError) throw new Error("Cannot inspect revision registry; verify connection/migration");
    if (old) {
      console.log(
        `Revision already exists (${digest}); no mutation performed. Approval changes require explicit operator SQL.`,
      );
    } else {
      const { error } = await client.from("chart_revisions").insert(record);
      if (error)
        throw new Error(
          "Revision registration failed; inspect server logs without exposing credentials",
        );
      console.log(`Registered ${digest}; approved=${record.approved}`);
    }
  } else
    console.log(
      JSON.stringify({
        dryRun: true,
        digest,
        songId: chart.id,
        side: chart.fnf?.playerSide ?? "mania",
        notes: chart.notes.length,
        audioDuration: duration,
        approved: record.approved,
      }),
    );
} finally {
  await vite.close();
}
