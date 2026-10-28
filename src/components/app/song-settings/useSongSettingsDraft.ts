import { useReducer } from "react";
import { canonicalJson } from "@/lib/xpContract";
import {
  settingsMetadata,
  type SaveSongSettingsInput,
  type SongSettingsMetadata,
  type SongSettingsRow,
} from "@/lib/songSettingsContract";
export type SettingsDraft = {
  base: SongSettingsRow;
  metadata: SongSettingsMetadata;
  background: SaveSongSettingsInput["background"];
  bpm?: number;
  offsetMs?: number;
};
type Action =
  | { type: "metadata"; value: SongSettingsMetadata }
  | { type: "background"; value: SettingsDraft["background"] }
  | { type: "timing"; bpm?: number; offsetMs?: number }
  | { type: "reset"; row: SongSettingsRow };
export function initialSettingsDraft(row: SongSettingsRow): SettingsDraft {
  return { base: row, metadata: settingsMetadata(row), background: { action: "keep" } };
}
export function settingsDraftReducer(state: SettingsDraft, action: Action): SettingsDraft {
  if (action.type === "reset") return initialSettingsDraft(action.row);
  if (action.type === "metadata") return { ...state, metadata: action.value };
  if (action.type === "background") return { ...state, background: action.value };
  const next = { ...state };
  if (action.bpm === undefined) delete next.bpm;
  else next.bpm = action.bpm;
  if (action.offsetMs === undefined) delete next.offsetMs;
  else next.offsetMs = action.offsetMs;
  return next;
}
export function settingsDraftDirty(draft: SettingsDraft) {
  return (
    canonicalJson(draft.metadata) !== canonicalJson(settingsMetadata(draft.base)) ||
    draft.background.action !== "keep" ||
    draft.bpm !== undefined ||
    draft.offsetMs !== undefined
  );
}
export function useSongSettingsDraft(row: SongSettingsRow) {
  const [draft, dispatch] = useReducer(settingsDraftReducer, row, initialSettingsDraft);
  return { draft, dispatch, dirty: settingsDraftDirty(draft) };
}
