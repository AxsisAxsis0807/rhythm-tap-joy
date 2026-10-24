import { LiveGrowthProvider } from "@/components/app/LiveGrowthProvider";
import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { buildSongList } from "@/game/songs";
import { TEST_CHART } from "@/game/charts/test-chart";
import { RhythmHub } from "@/components/app/RhythmHub";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { songSettings?: string } =>
    typeof search["songSettings"] === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      search["songSettings"],
    )
      ? { songSettings: search["songSettings"] }
      : {},
  head: () => ({
    meta: [
      { title: "Pulse Lane — 4レーン音楽ゲーム プロトタイプ" },
      {
        name: "description",
        content:
          "タッチとキーボードの両方で遊べる4レーン音楽ゲームのプロトタイプ。曲に同期したノーツを叩き、PERFECT/GREAT/GOOD/MISSで判定します。",
      },
      { property: "og:title", content: "Pulse Lane — 4レーン音楽ゲーム" },
      {
        property: "og:description",
        content:
          "スマートフォンのタッチ操作とD/F/J/Kキーに対応した4レーン音楽ゲームのプロトタイプ。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SONGS = buildSongList(TEST_CHART);

function Index() {
  return (
    <main>
      <ClientOnly fallback={<div className="h-[100dvh] bg-background" />}>
        <LiveGrowthProvider>
          <RhythmHub localSongs={SONGS} />
        </LiveGrowthProvider>
      </ClientOnly>
    </main>
  );
}
