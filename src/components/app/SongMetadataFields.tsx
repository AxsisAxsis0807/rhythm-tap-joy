import type { PlayStyleId } from "@/game/types";

export interface SongMetadataForm {
  title: string;
  artist: string;
  chartAuthor: string;
  difficultyName: string;
  description: string;
  recommendedPlayStyle: PlayStyleId | null;
  previewStartMs: number | null;
}

export function SongMetadataFields({
  value,
  onChange,
  previewEditable = true,
  extendedEditable = true,
}: {
  previewEditable?: boolean;
  extendedEditable?: boolean;
  value: SongMetadataForm;
  onChange: (value: SongMetadataForm) => void;
}) {
  const set = <K extends keyof SongMetadataForm>(key: K, next: SongMetadataForm[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="label sm:col-span-2">
        曲名
        <input
          className="field"
          required
          maxLength={120}
          value={value.title}
          onChange={(event) => set("title", event.target.value)}
        />
      </label>
      <label className="label">
        楽曲作成者
        <input
          className="field"
          maxLength={120}
          value={value.artist}
          onChange={(event) => set("artist", event.target.value)}
        />
      </label>
      <label className="label">
        譜面作成者
        <input
          className="field"
          maxLength={120}
          value={value.chartAuthor}
          onChange={(event) => set("chartAuthor", event.target.value)}
        />
      </label>
      <label className="label">
        難易度名
        <input
          className="field"
          maxLength={40}
          value={value.difficultyName}
          onChange={(event) => set("difficultyName", event.target.value)}
        />
      </label>
      <label className="label">
        おすすめスタイル
        <select
          disabled={!extendedEditable}
          className="field"
          value={value.recommendedPlayStyle ?? ""}
          onChange={(event) =>
            set(
              "recommendedPlayStyle",
              event.target.value === "mania" || event.target.value === "fnf"
                ? event.target.value
                : null,
            )
          }
        >
          <option value="">指定なし</option>
          <option value="mania">OSU!MANIA</option>
          <option value="fnf">FNF</option>
        </select>
      </label>
      <label className="label sm:col-span-2">
        説明
        <textarea
          disabled={!extendedEditable}
          className="field min-h-24 resize-y"
          maxLength={2000}
          value={value.description}
          onChange={(event) => set("description", event.target.value)}
        />
        <span className="text-xs text-white/50">
          テキストのみ · {value.description.length}/2000
        </span>
      </label>
      <label className="label sm:col-span-2">
        試聴開始位置（秒）
        <input
          disabled={!previewEditable}
          type="number"
          min={0}
          step={0.001}
          className="field"
          placeholder="指定なし"
          value={value.previewStartMs === null ? "" : value.previewStartMs / 1000}
          onChange={(event) =>
            set(
              "previewStartMs",
              event.target.value === "" ? null : Math.round(Number(event.target.value) * 1000),
            )
          }
        />
        <span className="text-xs text-white/50">
          {previewEditable
            ? "対象音源の試聴許可を確認できた場合に有効になります。"
            : "試聴位置は新しいRevisionを作成するときに指定できます。"}
        </span>
      </label>
    </div>
  );
}
