import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Database as AppliedDatabase } from "@/integrations/supabase/song-settings.generated";
import { toJson } from "./xpContract";
type Functions = AppliedDatabase["public"]["Functions"];
/** PostgreSQL accepts SQL NULL for these arguments; the CLI cannot infer that
 * from pg_proc. Preserve generated definitions and adapt only this transport boundary.
 */
export type SongSettingsDatabase = Omit<AppliedDatabase, "public"> & {
  public: Omit<AppliedDatabase["public"], "Functions"> & {
    Functions: Omit<Functions, "begin_song_settings_source" | "finish_song_asset_cleanup"> & {
      begin_song_settings_source: Omit<Functions["begin_song_settings_source"], "Args"> & {
        Args: Omit<Functions["begin_song_settings_source"]["Args"], "p_revision"> & {
          p_revision: string | null;
        };
      };
      finish_song_asset_cleanup: Omit<Functions["finish_song_asset_cleanup"], "Args"> & {
        Args: Omit<Functions["finish_song_asset_cleanup"]["Args"], "p_error"> & {
          p_error?: string | null;
        };
      };
    };
  };
};
/** Plain validated records remain JSON objects; SQL NOT NULL does not imply a number conversion. */
export const settingsJson = (value: Record<string, unknown>) =>
  toJson(value) as { [key: string]: Json | undefined };
/** Owner versions come from SQL text projections, never generated bigint numbers. */
export const settingsDatabase = (client: SupabaseClient<Database>) =>
  client as unknown as SupabaseClient<SongSettingsDatabase>;
