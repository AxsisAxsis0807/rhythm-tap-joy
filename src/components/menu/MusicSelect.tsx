import { useState } from "react";
import { ArrowUpRight, Menu } from "lucide-react";
import type { Chart } from "@/game/types";

export interface SongEntry {
  id: string;
  title: string;
  artist: string;
  chart?: Chart;
}

/** Orange skewed button used for Select / Back, matching the reference UI. */
function SlantButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group relative -skew-x-12 border border-orange-200/40 px-10 py-2.5 shadow-lg transition-transform active:scale-95 disabled:opacity-50"
      style={{
        background:
          "linear-gradient(180deg, oklch(0.72 0.19 55), oklch(0.5 0.16 45))",
      }}
    >
      <span className="block skew-x-12 font-display text-lg font-bold tracking-widest text-white drop-shadow">
        {label}
      </span>
    </button>
  );
}

export function MusicSelect({
  songs,
  onBack,
  onPlay,
}: {
  songs: SongEntry[];
  onBack: () => void;
  onPlay: (song: SongEntry) => void;
}) {
  const [selectedId, setSelectedId] = useState(songs[0]?.id ?? "");
  const selected = songs.find((s) => s.id === selectedId) ?? songs[0];

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden select-none"
      style={{
        background:
          "radial-gradient(ellipse 120% 90% at 70% 20%, oklch(0.55 0.09 75), oklch(0.35 0.06 70) 45%, oklch(0.2 0.04 70) 100%)",
      }}
    >
      {/* decorative blobs + big circle behind the list */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 85% 15%, oklch(0.75 0.1 80 / 0.5), transparent 35%), radial-gradient(circle at 20% 80%, oklch(0.45 0.07 65 / 0.6), transparent 40%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute top-1/2 right-[-10%] h-[130%] aspect-square -translate-y-1/2 rounded-full border-4 border-white/40"
      />

      {/* top-left menu pill */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-black/70">
          <span className="block size-3 rotate-45 bg-white" />
        </span>
        <span className="flex h-9 items-center rounded-full bg-black/70 px-4">
          <Menu className="size-5 text-white" aria-hidden="true" />
        </span>
      </div>

      {/* rotated MUSIC SELECT banner */}
      <div
        aria-hidden="true"
        className="absolute -top-2 -right-14 z-10 rotate-[24deg] border-y-2 border-white/60 bg-black/40 px-16 py-1"
      >
        <span className="font-display text-xl font-bold tracking-[0.35em] text-white/90">
          MUSIC SELECT
        </span>
      </div>

      <div className="relative z-10 flex h-full">
        {/* left: selected song details + Select */}
        <div className="flex w-[42%] flex-col justify-center gap-4 p-5 sm:p-8">
          <div className="rounded-sm bg-black/35 p-4 backdrop-blur-[2px]">
            <h2 className="text-xl font-bold text-white italic sm:text-2xl">
              {selected.title}
            </h2>
            <p className="mt-1 text-sm text-white/70 italic">
              {selected.artist}
            </p>
            {!selected.chart && (
              <p className="mt-3 text-xs tracking-widest text-orange-200">
                COMING SOON
              </p>
            )}
          </div>
          <div className="mt-6">
            <SlantButton
              label="Select"
              disabled={!selected.chart}
              onClick={() => selected.chart && onPlay(selected)}
            />
          </div>
        </div>

        {/* right: song list */}
        <div className="flex flex-1 flex-col justify-center p-4 sm:p-8">
          <ul className="flex max-h-full flex-col gap-1.5 overflow-y-auto py-8 pr-2">
            {songs.map((song) => {
              const active = song.id === selectedId;
              return (
                <li key={song.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(song.id)}
                    className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-2 border-white/90 bg-white/10"
                        : "border-2 border-transparent bg-black/40 hover:bg-black/55"
                    }`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-violet-600">
                      <ArrowUpRight
                        className="size-5 text-white"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="truncate text-base font-bold text-white italic sm:text-lg">
                      {song.artist}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* bottom-right Back */}
      <div className="absolute right-5 bottom-4 z-20">
        <SlantButton label="Back" onClick={onBack} />
      </div>
    </div>
  );
}
