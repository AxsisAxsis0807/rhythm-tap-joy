import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SongSettingsDialog } from "../../src/components/app/song-settings/SongSettingsDialog";
import { MySongManagementMenu } from "../../src/components/app/song-settings/MySongManagementMenu";
import type { SongRow } from "../../src/lib/chartRepository";
import { getSongSettings, ownerId, songId, control } from "./songSettings.functions";
import "../../src/styles.css";
import { getAudioSession } from "../../src/game/audioSession";
Object.assign(window, { songSettingsPreview: () => getAudioSession().getSnapshot() });
Object.assign(window, {
  songSettingsCodecProbe: async (extension: string) => {
    const url = new URL(`/impulse.${extension}`, window.location.href).href;
    const bytes = await (await fetch(url)).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const worker = new Worker(new URL("../../src/workers/waveform.worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      const peaks = await new Promise<{ durationMs: number; minMax: Int16Array }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Worker timed out")), 15000);
          worker.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Worker load failed"));
          };
          worker.onmessage = ({ data }) => {
            if (data.type === "ready") {
              clearTimeout(timer);
              resolve(data.peaks);
            }
            if (data.type === "error") {
              clearTimeout(timer);
              reject(new Error(data.code));
            }
          };
          worker.postMessage({ id: extension, url, hash, durationMs: 1125 });
        },
      );
      let bin = 0;
      for (let i = 0; i < peaks.minMax.length / 2; i++)
        if (peaks.minMax[i * 2 + 1]! > peaks.minMax[bin * 2 + 1]!) bin = i;
      const audio = new Audio(url);
      const mediaDurationMs = await new Promise<number>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve(audio.duration * 1000);
        audio.onerror = () => reject(new Error("Media load failed"));
      });
      audio.removeAttribute("src");
      audio.load();
      return { durationMs: peaks.durationMs, impulseMs: bin * 10, mediaDurationMs };
    } finally {
      worker.terminate();
    }
  },
});
getAudioSession().subscribe(() =>
  control.previewStates.push(getAudioSession().getSnapshot().status),
);
const initial = (await getSongSettings({ data: { songId } })).song;
export function Harness() {
  const [selected, setSelected] = useState(false),
    [row, setRow] = useState(initial);
  const { songSettings } = useSearch({ from: "/" }),
    navigate = useNavigate({ from: "/" }),
    router = useRouter();
  return (
    <div className="min-h-screen bg-[#090a0f] p-4 text-white">
      <main id="profile-fixture">
        <h1 tabIndex={-1} id="my-tracks-heading">
          MY TRACKS
        </h1>
        <p>Profile remains mounted</p>
        <MySongManagementMenu
          song={row as SongRow}
          selected={selected}
          onSelect={() => setSelected(true)}
          onPlay={() => {
            control.plays++;
          }}
          onEdit={() => void navigate({ search: { songSettings: songId } })}
        />
        <button
          type="button"
          className="min-h-11"
          onClick={() => void navigate({ search: { songSettings: songId } })}
        >
          Deep link fixture
        </button>
      </main>
      {songSettings && (
        <SongSettingsDialog
          ownerId={ownerId}
          songId={songSettings}
          onSaved={setRow}
          onClose={() => router.history.back()}
        />
      )}
    </div>
  );
}
const root = createRootRoute(),
  route = createRoute({
    getParentRoute: () => root,
    path: "/",
    validateSearch: (search: Record<string, unknown>) => ({
      songSettings: typeof search["songSettings"] === "string" ? search["songSettings"] : undefined,
    }),
    component: Harness,
  });
const router = createRouter({ routeTree: root.addChildren([route]) });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
