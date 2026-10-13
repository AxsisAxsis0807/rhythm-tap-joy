import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DEFAULT_CARD_CROP,
  levelCardGeometry,
  validCardCrop,
  type CardCrop,
  type CardPreferences,
  type CardPreferencePatch,
} from "@/lib/accountGrowth";
import "./accountGrowth.css";

export function ProfileLevelCard({
  imageUrl,
  crop = DEFAULT_CARD_CROP,
  children,
  className = "",
}: {
  imageUrl?: string | undefined;
  crop?: CardCrop;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 190 });
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const geometry = levelCardGeometry(size.width, size.height);
  const style = {
    "--growth-polygon": geometry.polygon,
    "--growth-inset": `${geometry.inset}px`,
  } as CSSProperties;
  const safeCrop = validCardCrop(crop) ? crop : DEFAULT_CARD_CROP;
  return (
    <div ref={ref} className={`profile-level-card ${className}`} style={style}>
      <div className="profile-level-card__background" aria-hidden="true">
        {imageUrl && failedImage !== imageUrl && (
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            onError={() => setFailedImage(imageUrl)}
            style={{
              objectPosition: `${safeCrop.x * 100}% ${safeCrop.y * 100}%`,
              transformOrigin: `${safeCrop.x * 100}% ${safeCrop.y * 100}%`,
              transform: `scale(${safeCrop.zoom})`,
            }}
          />
        )}
        <div className="profile-level-card__scrim" />
      </div>
      <div className="profile-level-card__content">{children}</div>
      <svg className="profile-level-card__outline" aria-hidden="true" focusable="false">
        <path d={geometry.path} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function ProfileCardEditor({
  preferences,
  saving,
  onSave,
}: {
  preferences: CardPreferences;
  saving: boolean;
  onSave: (patch: CardPreferencePatch) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="growth-control px-3 text-xs"
        onClick={() => setOpen(true)}
        aria-label="Levelカードを編集"
      >
        編集
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        {open && (
          <CardEditorDialog
            preferences={preferences}
            saving={saving}
            onSave={onSave}
            onClose={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

function CardEditorDialog({
  preferences,
  saving,
  onSave,
  onClose,
}: {
  preferences: CardPreferences;
  saving: boolean;
  onSave: (patch: CardPreferencePatch) => Promise<void>;
  onClose: () => void;
}) {
  // Keep the version captured when this editor opens. A concurrent update must conflict.
  const [original] = useState(preferences);
  const [crop, setCrop] = useState(original.crop);
  const [removeImage, setRemoveImage] = useState(false);
  const [levelPublic, setLevelPublic] = useState(original.levelPublic);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = removeImage ? undefined : original.cardImage?.url;
  const save = async () => {
    setError(null);
    try {
      await onSave({ expectedVersion: original.version, crop, levelPublic, removeImage });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存できませんでした。再試行してください。",
      );
    }
  };
  return (
    <DialogContent
      className="max-h-[90dvh] max-w-2xl overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>button]:min-h-11 [&>button]:min-w-11"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key))
          event.stopPropagation();
      }}
    >
      <DialogTitle>Levelカードを編集</DialogTitle>
      <DialogDescription>
        背景の位置と公開設定を変更できます。画像の設定は無料です。
      </DialogDescription>
      <div className="space-y-3" aria-label="背景の表示プレビュー">
        <div>
          <p className="mb-1 text-xs text-white/65">モバイル表示</p>
          <ProfileLevelCard imageUrl={imageUrl} crop={crop} className="max-w-[320px]">
            <p className="text-xs text-white/80">LEVEL CARD</p>
            <p className="mt-5 text-sm text-white">背景プレビュー</p>
          </ProfileLevelCard>
        </div>
        <div>
          <p className="mb-1 text-xs text-white/65">横長表示（画面幅に応じて縮小）</p>
          <ProfileLevelCard imageUrl={imageUrl} crop={crop}>
            <p className="text-xs text-white/80">LEVEL CARD</p>
            <p className="mt-5 text-sm text-white">背景プレビュー</p>
          </ProfileLevelCard>
        </div>
      </div>
      <fieldset disabled={saving || !imageUrl} className="space-y-2 disabled:opacity-60">
        <legend className="mb-2 text-sm">画像の位置</legend>
        {(
          [
            ["x", "横位置", 0, 100],
            ["y", "縦位置", 0, 100],
            ["zoom", "ズーム", 100, 300],
          ] as const
        ).map(([key, label, min, max]) => (
          <label
            key={key}
            className="grid min-h-11 grid-cols-[5rem_1fr_3rem] items-center gap-2 text-sm"
          >
            <span>{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={Math.round(crop[key] * 100)}
              onChange={(event) =>
                setCrop((current) => ({ ...current, [key]: Number(event.target.value) / 100 }))
              }
              className="min-h-11 min-w-0 accent-cyan-200"
              aria-valuetext={
                key === "zoom" ? `${crop.zoom.toFixed(2)}倍` : `${Math.round(crop[key] * 100)}%`
              }
            />
            <output className="text-right tabular-nums">{Math.round(crop[key] * 100)}%</output>
          </label>
        ))}
        <button
          type="button"
          className="growth-control px-3 text-sm"
          onClick={() => setCrop(DEFAULT_CARD_CROP)}
        >
          位置を初期化
        </button>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="growth-control px-3 text-sm"
          disabled
          aria-describedby="card-upload-unavailable"
        >
          {original.cardImage ? "画像を変更" : "画像をアップロード"}
        </button>
        {original.cardImage && (
          <button
            type="button"
            disabled={saving}
            className="growth-control px-3 text-sm"
            onClick={() => setRemoveImage(!removeImage)}
          >
            {removeImage ? "画像の削除を取り消す" : "画像を削除"}
          </button>
        )}
      </div>
      <p id="card-upload-unavailable" className="text-xs text-white/65">
        画像のアップロードは準備中です。利用可能になるまでは、保存済みの画像の位置変更・削除ができます。
      </p>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={levelPublic}
          disabled={saving}
          onChange={(event) => setLevelPublic(event.target.checked)}
          className="size-5 accent-cyan-200"
        />
        LevelとXPを公開する
      </label>
      <p className="text-xs text-white/65">非公開にしても、自分のLevelとXPは確認できます。</p>
      {error && (
        <p role="alert" className="text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="growth-control px-4" disabled={saving} onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className="growth-control bg-cyan-200/10 px-4"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </DialogContent>
  );
}
