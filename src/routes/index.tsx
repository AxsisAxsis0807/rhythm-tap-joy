import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { GameScreen } from "@/components/game/GameScreen";
import { TEST_CHART } from "@/game/charts/test-chart";

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

function Index() {
  return (
    <main>
      <ClientOnly fallback={<div className="h-[100dvh] bg-background" />}>
        <GameScreen chart={TEST_CHART} />
      </ClientOnly>
    </main>
  );
}
