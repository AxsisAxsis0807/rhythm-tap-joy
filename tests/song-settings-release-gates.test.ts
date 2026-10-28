// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  row: {
    schema_version: 1,
    settings_enabled: true,
    background_enabled: true,
    timing_enabled: true,
  } as Record<string, unknown> | null,
  error: null as object | null,
  readiness: true as unknown,
  readinessError: null as object | null,
  throws: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (state.throws) throw new Error("unavailable");
            return { data: state.row, error: state.error };
          },
        }),
      }),
    }),
    rpc: async () => ({ data: state.readiness, error: state.readinessError }),
  },
}));
import { songSettingsCapabilities } from "@/lib/songSettings.server";
import { validCleanupCredential } from "@/lib/assetCleanup.server";
const names = [
  "PULSE_SONG_SETTINGS_ENABLED",
  "PULSE_SONG_BACKGROUND_ENABLED",
  "PULSE_SONG_TIMING_ENABLED",
  "PULSE_REVISIONS_ENABLED",
] as const;
const disabled = {
  songSettingsEnabled: false,
  songBackgroundUploadEnabled: false,
  songTimingRevisionEnabled: false,
};
beforeEach(() => {
  Object.assign(state, {
    row: {
      schema_version: 1,
      settings_enabled: true,
      background_enabled: true,
      timing_enabled: true,
    },
    error: null,
    readiness: true,
    readinessError: null,
    throws: false,
  });
  for (const name of names) vi.stubEnv(name, "true");
});
afterEach(() => vi.unstubAllEnvs());
it("requires explicit environment flags even when the schema and DB gates are ready", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    vi.stubEnv("PULSE_SONG_SETTINGS_ENABLED", value);
    expect(await songSettingsCapabilities()).toEqual(disabled);
  }
});
it("checks every environment and database gate independently", async () => {
  for (let mask = 0; mask < 16; mask++) {
    names.forEach((name, bit) => vi.stubEnv(name, mask & (1 << bit) ? "true" : "false"));
    for (let dbMask = 0; dbMask < 8; dbMask++) {
      state.row = {
        schema_version: 1,
        settings_enabled: !!(dbMask & 1),
        background_enabled: !!(dbMask & 2),
        timing_enabled: !!(dbMask & 4),
      };
      const settings = !!(mask & 1) && !!(dbMask & 1);
      expect(await songSettingsCapabilities()).toEqual({
        songSettingsEnabled: settings,
        songBackgroundUploadEnabled: settings && !!(mask & 2) && !!(dbMask & 2),
        songTimingRevisionEnabled: settings && !!(mask & 4) && !!(mask & 8) && !!(dbMask & 4),
      });
    }
  }
});
it("fails closed on missing/version-mismatched schema, readiness errors and transport failures", async () => {
  for (const row of [null, { schema_version: 0 }, { schema_version: 2 }]) {
    state.row = row;
    expect(await songSettingsCapabilities()).toEqual(disabled);
  }
  state.row = {
    schema_version: 1,
    settings_enabled: true,
    background_enabled: true,
    timing_enabled: true,
  };
  for (const readiness of [false, null, "true", 1]) {
    state.readiness = readiness;
    expect(await songSettingsCapabilities()).toEqual(disabled);
  }
  state.readiness = true;
  state.readinessError = { code: "PGRST202" };
  expect(await songSettingsCapabilities()).toEqual(disabled);
  state.readinessError = null;
  state.error = { code: "42P01" };
  expect(await songSettingsCapabilities()).toEqual(disabled);
  state.error = null;
  state.throws = true;
  expect(await songSettingsCapabilities()).toEqual(disabled);
});
it("requires a configured, exact Bearer credential for cleanup", async () => {
  vi.stubEnv("PULSE_CLEANUP_TOKEN", undefined);
  expect(await validCleanupCredential("Bearer local-only")).toBe(false);
  vi.stubEnv("PULSE_CLEANUP_TOKEN", "local-only");
  for (const header of [
    null,
    "",
    "local-only",
    "bearer local-only",
    "Bearer wrong",
    "Bearer local-only ",
  ])
    expect(await validCleanupCredential(header)).toBe(false);
  expect(await validCleanupCredential("Bearer local-only")).toBe(true);
});
