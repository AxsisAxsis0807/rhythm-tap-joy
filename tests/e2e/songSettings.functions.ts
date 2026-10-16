/** Browser UI harness only. Authorization/transactions use separate real API tests. */
import {
  saveSongSettingsSchema,
  type SongSettingsRow,
  type SaveSongSettingsInput,
  type PreparedSongSource,
  type SongSettingsReceipt,
} from "../../src/lib/songSettingsContract";
export const ownerId = "22222222-2222-4222-8222-222222222222",
  songId = "11111111-1111-4111-8111-111111111111";
let song: SongSettingsRow = {
  id: songId,
  user_id: ownerId,
  title: "Fixture Song",
  artist: "Fixture Artist",
  chart_author: "",
  difficulty_name: "NORMAL",
  description: null,
  recommended_play_style: null,
  preview_start_ms: null,
  metadata_version: "0",
  current_revision_id: "33333333-3333-4333-8333-333333333333",
  background_asset_id: null,
  is_published: false,
  published_at: null,
  bpm: 120,
  offset_sec: 0,
  lane_count: 4,
  note_count: 2,
  chart_type: "mania",
  fnf_side: "right",
};
type Call<T> = { data: T; fetch?: typeof fetch };
const receipts = new Map<string, SongSettingsReceipt>();
export const control = {
  mode: "success" as "success" | "lost" | "conflict",
  saveCalls: 0,
  plays: 0,
  previewStates: [] as string[],
  payload: null as SaveSongSettingsInput | null,
};
Object.assign(window, { songSettingsTest: control });
const asset = {
  assetId: "44444444-4444-4444-8444-444444444444",
  hash: "a".repeat(64),
  url: "/image.jpg",
  expiresAt: Date.now() + 600000,
  width: 16,
  height: 9,
};
export async function getSongSettings(_call: Call<{ songId: string }>) {
  return {
    song: structuredClone(song),
    capabilities: {
      songSettingsEnabled: true,
      songBackgroundUploadEnabled: true,
      songTimingRevisionEnabled: true,
    },
    background: song.background_asset_id ? asset : null,
    revision: { durationMs: 1125 },
  };
}
export async function saveSongSettings({ data }: Call<SaveSongSettingsInput>) {
  control.saveCalls++;
  const input = saveSongSettingsSchema.parse(data),
    existing = receipts.get(input.requestId);
  if (existing) return existing;
  if (control.mode === "conflict" || input.expectedVersion !== song.metadata_version)
    throw new Error("STALE_VERSION");
  control.payload = structuredClone(input);
  song = {
    ...song,
    title: input.metadata.title,
    artist: input.metadata.artist,
    chart_author: input.metadata.chartAuthor,
    difficulty_name: input.metadata.difficultyName,
    description: input.metadata.description,
    recommended_play_style: input.metadata.recommendedPlayStyle,
    preview_start_ms: input.metadata.previewStartMs,
    metadata_version: String(BigInt(song.metadata_version) + 1n),
    background_asset_id:
      input.background.action === "remove"
        ? null
        : input.background.action === "replace"
          ? input.background.assetId
          : song.background_asset_id,
    current_revision_id:
      input.gameplay.action === "keep" ? song.current_revision_id : crypto.randomUUID(),
  };
  const receipt = {
    requestId: input.requestId,
    version: song.metadata_version,
    revisionId: song.current_revision_id,
    song: structuredClone(song),
  };
  receipts.set(input.requestId, receipt);
  if (control.mode === "lost") throw new Error("SIMULATED_RESPONSE_LOSS");
  return receipt;
}
export async function getSongSettingsOperation({ data }: Call<{ operationId: string }>) {
  const receipt = receipts.get(data.operationId);
  return receipt
    ? { id: data.operationId, songId, state: "committed", errorCode: null, receipt }
    : null;
}
export async function resumeSongSettingsSave({ data }: Call<{ operationId: string }>) {
  const receipt = receipts.get(data.operationId);
  if (!receipt) throw new Error("NOT_FOUND_OR_FORBIDDEN");
  return receipt;
}
export async function prepareSongSettingsSource({
  data,
}: Call<{
  songId: string;
  operationId: string;
  expectedVersion: string;
  expectedRevisionId: string | null;
}>): Promise<PreparedSongSource> {
  return {
    operationId: data.operationId,
    audioHash: __FIXTURE_AUDIO_HASH__,
    durationMs: 1125,
    audioUrl: "/impulse.wav",
    chartUrl: "/chart.json",
    expiresAt: Date.now() + 600000,
    bpm: 120,
    offset: 0,
    sourceFormat: "native",
    timingBasis: "beats",
    previewAllowed: false,
  };
}
export async function abandonSongSettingsOperation(_call: Call<{ operationId: string }>) {
  return { abandoned: true };
}
export async function reserveSongBackground({
  data,
}: Call<{ songId: string; reservationId: string; mime: string; expectedBytes: number }>) {
  return {
    reservationId: data.reservationId,
    url: `/test-upload/${data.reservationId}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
}
export async function verifySongBackground(_call: Call<{ songId: string; reservationId: string }>) {
  return asset;
}
export async function reserveChartReplacement({
  data,
}: Call<{
  songId: string;
  operationId: string;
  expectedVersion: string;
  expectedRevisionId: string | null;
  audioBytes: number;
  chartBytes: number;
  audioMime: string;
  chartType: string;
  side: string;
}>) {
  return {
    prepared: false,
    audioUrl: `/test-upload/${data.operationId}/audio`,
    chartUrl: `/test-upload/${data.operationId}/chart`,
  };
}
export const prepareChartReplacement = prepareSongSettingsSource;
export async function getSongBackground(_call: Call<{ songId: string }>) {
  return song.background_asset_id ? asset : null;
}
declare const __FIXTURE_AUDIO_HASH__: string;
