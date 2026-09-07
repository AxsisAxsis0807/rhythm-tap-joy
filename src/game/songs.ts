import type { Chart } from "./types";
import type { SongEntry } from "@/components/menu/MusicSelect";

/**
 * Song list for the select screen. Only entries with a chart are playable;
 * the rest are placeholders until their charts/audio exist.
 */
export function buildSongList(testChart: Chart): SongEntry[] {
  return [
    {
      id: testChart.id,
      title: testChart.title,
      artist: testChart.artist,
      chart: testChart,
    },
    { id: "ph-1", title: "Midnight Drive", artist: "Chroma" },
    { id: "ph-2", title: "Neon Steps", artist: "Kyutatsuki" },
    { id: "ph-3", title: "Overheat", artist: "CAMELLIA" },
    { id: "ph-4", title: "Star Fragment", artist: "Haraguchi Sasuke" },
    { id: "ph-5", title: "Signal Lost", artist: "HALLEY LABS" },
    { id: "ph-6", title: "Skybound", artist: "Various Artists" },
  ];
}
