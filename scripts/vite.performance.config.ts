/** Local measurement only. Default vite.config.ts and deployment output are unchanged. */
import base from "../vite.config";
import { mergeConfig, type ConfigEnv, type UserConfig } from "vite";

export default async (env: ConfigEnv): Promise<UserConfig> => {
  const config = typeof base === "function" ? await base(env) : await base;
  const notes = Array.from({ length: 14400 }, (_, i) => ({
    beat: 4 + i / 12,
    lane: i % 4,
    kind: "tap",
  }));
  const chart = {
    id: "performance-local",
    title: "Performance fixture",
    artist: "LOCAL SYNTHETIC — 24 notes/s per bank",
    audioUrl: "/audio/performance-local.wav",
    bpm: 120,
    offset: 0,
    laneCount: 4,
    difficultyName: "MEASUREMENT",
    notes,
    fnf: { playerSide: "right", left: notes, right: notes },
  };
  return mergeConfig(config, {
    build: { sourcemap: true },
    plugins: [
      {
        name: "local-performance-chart-data",
        enforce: "pre",
        load(id: string) {
          if (id.replaceAll("\\", "/").endsWith("/src/game/charts/test-chart.ts"))
            return `export const TEST_CHART = ${JSON.stringify(chart)};`;
        },
      },
    ],
  });
};
