import { expect, it } from "vitest";
import { SongTapGesture } from "@/lib/songTapGesture";
import { formatSongTime } from "@/lib/songTime";
import {
  initialSettingsDraft,
  settingsDraftReducer,
  settingsDraftDirty,
} from "@/components/app/song-settings/useSongSettingsDraft";
import type { SongSettingsRow } from "@/lib/songSettingsContract";
it("touch selects immediately and plays once on a nearby second tap within 350ms", () => {
  const gesture = new SongTapGesture();
  gesture.start(1, "touch", true, 10, 20, 0);
  expect(gesture.end(1, 10, 20, 50)).toBe("select");
  gesture.start(2, "touch", true, 15, 20, 200);
  expect(gesture.end(2, 15, 20, 300)).toBe("play");
  expect(gesture.end(2, 15, 20, 301)).toBe("none");
});
it("scroll, long press, another pointer family and a second pointer do not accidentally play", () => {
  const g = new SongTapGesture();
  g.start(1, "touch", true, 0, 0, 0);
  g.move(1, 0, 9);
  expect(g.end(1, 0, 0, 30)).toBe("none");
  g.start(1, "touch", true, 0, 0, 100);
  expect(g.end(1, 0, 0, 451)).toBe("none");
  g.start(1, "touch", true, 0, 0, 500);
  expect(g.end(1, 0, 0, 510)).toBe("select");
  g.start(2, "pen", true, 0, 0, 520);
  expect(g.end(2, 0, 0, 530)).toBe("select");
  g.start(1, "touch", true, 0, 0, 600);
  g.start(2, "touch", false, 0, 0, 610);
  expect(g.end(1, 0, 0, 620)).toBe("none");
  g.start(1, "touch", true, 0, 0, 700);
  expect(g.end(1, 0, 0, 710)).toBe("select");
  g.reset();
  g.start(1, "touch", true, 0, 0, 720);
  expect(g.end(1, 0, 0, 730)).toBe("select");
});
it("a distant second tap selects and an expired double tap never plays", () => {
  const g = new SongTapGesture();
  g.start(1, "touch", true, 0, 0, 0);
  g.end(1, 0, 0, 10);
  g.start(2, "touch", true, 13, 0, 100);
  expect(g.end(2, 13, 0, 110)).toBe("select");
  g.start(3, "touch", true, 13, 0, 500);
  expect(g.end(3, 13, 0, 510)).toBe("select");
});
it("draft keeps nullable legacy values and exact versions; undoing a field clears dirty", () => {
  const row = {
    id: "x",
    metadata_version: "9007199254740994",
    title: "曲",
    artist: "",
    chart_author: "",
    difficulty_name: "NORMAL",
    description: null,
    recommended_play_style: null,
    preview_start_ms: null,
  } as SongSettingsRow;
  const initial = initialSettingsDraft(row);
  expect(settingsDraftDirty(initial)).toBe(false);
  const changed = settingsDraftReducer(initial, {
    type: "metadata",
    value: { ...initial.metadata, title: "変更" },
  });
  expect(settingsDraftDirty(changed)).toBe(true);
  const undone = settingsDraftReducer(changed, { type: "metadata", value: initial.metadata });
  expect(settingsDraftDirty(undone)).toBe(false);
  expect(undone.base.metadata_version).toBe(row.metadata_version);
  expect(undone.metadata.previewStartMs).toBeNull();
  expect(settingsDraftDirty(settingsDraftReducer(initial, { type: "timing", offsetMs: 1 }))).toBe(
    true,
  );
  expect(settingsDraftReducer(changed, { type: "reset", row })).toEqual(initial);
});
it("time labels preserve the final millisecond", () => {
  expect(formatSongTime(1)).toBe("00:00.001");
  expect(formatSongTime(60001)).toBe("01:00.001");
  expect(formatSongTime(7199999)).toBe("119:59.999");
});
