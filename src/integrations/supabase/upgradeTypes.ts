import type { Database, Json } from "./types";

// Repository migration contract; regenerate against staging after applying the expansion.
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
export type RevisionRow = {
  id: string;
  song_id: string | null;
  chart_key: string;
  revision_number: number;
  chart_path: string;
  audio_path: string;
  chart_hash: string;
  audio_hash: string;
  parser_version: string;
  duration_ms: number;
  note_count: number;
  lane_count: number;
  fnf_side: "left" | "right" | null;
  status: string;
  rights_confirmed_by: string;
  rights_confirmed_at: string;
  preview_allowed: boolean;
  created_at: string;
};
export type PreferencesRow = {
  user_id: string;
  level_public: boolean;
  background_asset_id: string | null;
  crop_x: number;
  crop_y: number;
  crop_zoom: number;
  metadata_version: number;
};
export type ImageAssetRow = {
  id: string;
  owner_id: string;
  purpose: string;
  target_id: string;
  path: string;
  content_hash: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  verified_at: string;
};
export type PlaySessionRow = {
  id: string;
  user_id: string;
  revision_id: string;
  configuration: Json;
  catalog_snapshot: Json;
  issued_at: string;
  expires_at: string;
  accepted_at: string | null;
  finish_hash: string | null;
  status: string;
  reward_date: string | null;
  side: string;
  group_id: string;
  rule_version: string;
};
export type RankingRow = {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  total_score: string;
  play_count: string;
  global_rank: string;
};
export type ResultRow = {
  id: string;
  user_id: string;
  song_id: string;
  score: number;
  accuracy: number;
  max_combo: number;
  perfect_count: number;
  great_count: number;
  good_count: number;
  miss_count: number;
  played_at: string;
};
export type UpgradeTables = {
  chart_revisions: Table<RevisionRow>;
  profile_preferences: Table<PreferencesRow>;
  image_assets: Table<ImageAssetRow>;
  play_results: Table<ResultRow>;
  player_stats: Table<{ user_id: string; total_score: number; play_count: number }>;
  xp_feature_flags: Table<{ name: string; enabled: boolean }>;
  play_sessions: Table<PlaySessionRow>;
  play_evidence: Table<{
    session_id: string;
    payload: Json;
    payload_hash: string;
    purge_after: string | null;
  }>;
  verification_jobs: Table<{
    session_id: string;
    status: string;
    attempts: number;
    leased_until: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
};
export type UpgradeFunctions = {
  record_play_result_v2: {
    Args: UpgradeFunctions["record_play_result"]["Args"] & {
      p_revision_id: string | null;
      p_play_style: string;
      p_policy_id: string;
      p_parser_version: string;
      p_scoring_side: string;
    };
    Returns: boolean;
  };
  record_play_result: {
    Args: {
      p_id: string;
      p_song_id: string;
      p_score: number;
      p_accuracy: number;
      p_max_combo: number;
      p_perfect_count: number;
      p_great_count: number;
      p_good_count: number;
      p_miss_count: number;
    };
    Returns: boolean;
  };
  get_global_leaderboard: { Args: Record<string, never>; Returns: RankingRow[] };
  get_player_ranking: { Args: { p_user_id: string }; Returns: RankingRow[] };
  update_chart_metadata: {
    Args: {
      p_song_id: string;
      p_expected_version: number;
      p_expected_revision: string | null;
      p_title: string;
      p_artist: string;
      p_chart_author: string;
      p_difficulty_name: string;
      p_description: string;
      p_recommended_play_style: string | null;
      p_preview_start_ms: number | null;
    };
    Returns: Database["public"]["Tables"]["songs"]["Row"];
  };
  publish_chart_revision: {
    Args: {
      p_actor: string;
      p_song_id: string;
      p_revision_id: string;
      p_expected_revision: string | null;
      p_expected_version: number;
      p_preview_start_ms: number;
    };
    Returns: Database["public"]["Tables"]["songs"]["Row"];
  };
  save_profile_preferences: {
    Args: {
      p_expected_version: number;
      p_level_public: boolean;
      p_crop_x: number;
      p_crop_y: number;
      p_crop_zoom: number;
      p_remove_image: boolean;
    };
    Returns: PreferencesRow;
  };
  get_own_xp_progress: { Args: Record<string, never>; Returns: Json };
  get_public_xp_progress: { Args: { p_user_id: string }; Returns: Json };
  get_xp_receipt: { Args: { p_play_id: string }; Returns: Json };
  begin_verified_play: {
    Args: {
      p_user_id: string;
      p_nonce: string;
      p_revision_id: string;
      p_side: string;
      p_configuration: Json;
    };
    Returns: Json;
  };
  accept_play_evidence: {
    Args: { p_user_id: string; p_session_id: string; p_hash: string; p_payload: Json };
    Returns: Json;
  };
  finalize_verified_play: {
    Args: { p_session_id: string; p_hash: string; p_result: Json };
    Returns: Json;
  };
};
