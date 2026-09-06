import { useEffect } from "react";
import { X } from "lucide-react";

export interface GameSettings {
  /** Show borders around the 4 touch-panel areas so players can see their hit zones. */
  showTouchBorders: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  showTouchBorders: false,
};

/**
 * Placeholder settings sheet. New toggles get added as rows here; the game
 * only reads the values via the `settings` prop so the data flow stays simple.
 */
export function SettingsPanel({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onClose: () => void;
}) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-overlay px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg tracking-[0.3em]">SETTINGS</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="設定を閉じる"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <ToggleRow
          label="タッチパネルの枠を表示"
          description="入力エリアの境界をハイライトします。"
          checked={settings.showTouchBorders}
          onChange={(v) => onChange({ ...settings, showTouchBorders: v })}
        />

        <p className="mt-4 text-[10px] tracking-[0.3em] text-muted-foreground">
          その他の設定は今後追加予定
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="flex flex-col">
        <span className="text-sm text-foreground">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-secondary"
        }`}
      >
        <span
          className={`absolute top-1 size-4 rounded-full bg-foreground transition-transform ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </label>
  );
}
