import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_MODE_ID } from "@/game/modes";
import { ClientOnly } from "@tanstack/react-router";
import { buildSongList } from "@/game/songs";
import { TEST_CHART } from "@/game/charts/test-chart";
import { BEWILDERMENT_CHART } from "@/game/charts/bewilderment";
import { RhythmHub } from "@/components/app/RhythmHub";

export const Route = createFileRoute("/")({
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

const SONGS = buildSongList(TEST_CHART, BEWILDERMENT_CHART);

function Index() {
  const [modeId, setModeId] = useState(DEFAULT_MODE_ID);

  return (
    <main>
      <ClientOnly fallback={<div className="h-[100dvh] bg-background" />}>
        <RhythmHub localSongs={SONGS} modeId={modeId} onModeChange={setModeId} />
      </ClientOnly>
    </main>
  );
}
