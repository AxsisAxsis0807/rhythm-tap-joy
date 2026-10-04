import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { GameSettings } from "@/game/settings";

/**
 * Placeholder settings sheet. New toggles get added as rows here; the game
 * only reads the values via the `settings` prop so the data flow stays simple.
 */
export function SettingsPanel({
  open,
  settings,
  onChange,
  onClose,
  fnf = false,
  saveError = false,
}: {
  open: boolean;
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onClose: () => void;
  fnf?: boolean;
  saveError?: boolean;
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
      <div role="dialog" aria-modal="true" aria-label="プレイ設定" className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-card p-5 text-foreground shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg tracking-[0.3em]">SETTINGS</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="設定を閉じる"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <ToggleRow
          label="タッチパネルの枠を表示"
          description="入力エリアの境界をハイライトします。"
          checked={settings.showTouchBorders}
          onChange={(v) => onChange({ ...settings, showTouchBorders: v })}
        />

        {fnf && <ToggleRow label="ミドルスクロール" checked={settings.middleScroll} onChange={(v) => onChange({ ...settings, middleScroll: v })} />}
        <div className="space-y-4 border-t border-border py-4">
          <div className="flex items-center justify-between text-sm">
            <span>スクロールスピード</span>
            <output className="tabular-nums">{settings.scrollSpeed.toFixed(2)}×</output>
          </div>
          <Slider aria-label="スクロールスピード" min={0.5} max={3} step={0.05} value={[settings.scrollSpeed]} onValueChange={([v]) => { if (v !== undefined) onChange({ ...settings, scrollSpeed: v }); }} />
        </div>
        <p role="status" className="text-xs text-muted-foreground">{saveError ? "この端末に設定を保存できませんでした" : "設定はこの端末に自動保存されます"}</p>
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
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="flex flex-col">
        <span className="text-sm text-foreground">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
