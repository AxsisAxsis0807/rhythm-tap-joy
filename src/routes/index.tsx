import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_MODE_ID } from "@/game/modes";
import { ClientOnly } from "@tanstack/react-router";
import { GameScreen } from "@/components/game/GameScreen";
import { TitleScreen } from "@/components/menu/TitleScreen";
import { MusicSelect, type SongEntry } from "@/components/menu/MusicSelect";
import { buildSongList } from "@/game/songs";
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

type Screen = "title" | "select" | "play";

const SONGS = buildSongList(TEST_CHART);

function Index() {
  const [modeId, setModeId] = useState(DEFAULT_MODE_ID);
  const [screen, setScreen] = useState<Screen>("title");
  const [song, setSong] = useState<SongEntry>(SONGS[0]);

  return (
    <main>
      <ClientOnly fallback={<div className="h-[100dvh] bg-background" />}>
        {screen === "title" && (
          <TitleScreen onContinue={() => setScreen("select")} />
        )}
        {screen === "select" && (
          <MusicSelect
            songs={SONGS}
            onBack={() => setScreen("title")}
            onPlay={(s) => {
              setSong(s);
              setScreen("play");
            }}
          />
        )}
        {screen === "play" && song.chart && (
          <GameScreen
            key={song.id}
            chart={song.chart}
            modeId={modeId}
            onModeChange={setModeId}
            onExit={() => setScreen("select")}
          />
        )}
      </ClientOnly>
    </main>
  );
}

