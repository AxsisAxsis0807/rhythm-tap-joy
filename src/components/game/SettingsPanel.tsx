import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { InputTest } from "./InputOverlay";
import { applyPreset, DEFAULT_SETTINGS, type GameSettings } from "@/game/settings";

type Category = "play" | "controls" | "audio" | "visual" | "comfort";
const categories: { id: Category; label: string }[] = [
  { id: "play", label: "プレイ" },
  { id: "controls", label: "操作" },
  { id: "audio", label: "音声・タイミング" },
  { id: "visual", label: "見た目" },
  { id: "comfort", label: "快適性" },
];

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
  const [category, setCategory] = useState<Category>("play");
  const [query, setQuery] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value, preset: "custom" });
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const root = closeRef.current?.closest('[role="dialog"]');
        const items = Array.from(
          root?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),[tabindex="0"]',
          ) ?? [],
        );
        if (!items.length) return;
        const first = items[0]!,
          last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = oldOverflow;
      returnFocus.current?.focus();
    };
  }, [open, onClose]);

  const searching = query.trim().length > 0;
  const matches = (text: string) =>
    !searching || text.toLowerCase().includes(query.trim().toLowerCase());
  if (!open) return null;
  const show = (section: Category, text: string) =>
    searching ? matches(text) : category === section;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 md:items-center md:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="プレイ設定"
        className="flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#101522] shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-200 md:h-[min(820px,92dvh)] md:max-w-5xl md:rounded-2xl md:slide-in-from-bottom-1"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg tracking-[.2em]">SETTINGS</h2>
            <p className="text-xs text-white/45">変更はすぐプレビューされ、自動保存されます</p>
          </div>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="設定を閉じる"
          >
            <X className="size-5" />
          </Button>
        </header>
        <div className="grid min-h-0 flex-1 md:grid-cols-[190px_1fr_290px]">
          <aside className="shrink-0 border-b border-white/10 p-3 md:border-r md:border-b-0 md:p-4">
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
              <Search className="size-4 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="設定を検索"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <nav
              className="mt-3 flex gap-1 overflow-x-auto md:flex-col"
              aria-label="設定カテゴリー"
            >
              {categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setCategory(item.id);
                    setQuery("");
                  }}
                  className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors ${category === item.id && !searching ? "bg-cyan-300/15 text-cyan-100" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
          <main className="min-h-0 overflow-y-auto px-4 py-4 md:px-6">
            <div className="mb-5 flex flex-wrap gap-2">
              {(["simple", "readable", "effects"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChange(applyPreset(settings, p))}
                  className={`rounded-full border px-3 py-1.5 text-xs ${settings.preset === p ? "border-cyan-300 bg-cyan-300/15 text-cyan-100" : "border-white/10 text-white/60"}`}
                >
                  {p === "simple" ? "シンプル" : p === "readable" ? "視認性重視" : "演出重視"}
                </button>
              ))}
            </div>

            {show("play", "スクロール 方向 速度 ミドル") && (
              <Group title="スクロール">
                <SelectRow
                  label="スクロール方向"
                  description="モード標準、下方向、上方向を選べます。"
                  value={settings.scrollDirection}
                  onChange={(v) => set("scrollDirection", v as GameSettings["scrollDirection"])}
                  options={[
                    ["mode", "モード標準"],
                    ["down", "下スクロール"],
                    ["up", "上スクロール"],
                  ]}
                />
                <RangeRow
                  label="ノーツ速度"
                  description="見える時間だけを変え、曲や判定の時刻は変えません。"
                  value={settings.scrollSpeed}
                  min={0.5}
                  max={4}
                  step={0.05}
                  suffix="×"
                  onChange={(v) => set("scrollSpeed", v)}
                />
                {fnf && (
                  <ToggleRow
                    label="ミドルスクロール"
                    description="自分側の4レーンを中央に寄せます。判定ルールは変わりません。"
                    checked={settings.middleScroll}
                    onChange={(v) => set("middleScroll", v)}
                  />
                )}
              </Group>
            )}
            {show("play", "判定ライン 進行 FAST LATE 誤差") && (
              <Group title="プレイ表示">
                <RangeRow
                  label="判定ライン位置"
                  value={settings.judgeLinePct}
                  min={65}
                  max={92}
                  step={1}
                  suffix="%"
                  onChange={(v) => set("judgeLinePct", v)}
                />
                <ToggleRow
                  label="FAST / LATE"
                  checked={settings.showFastLate}
                  onChange={(v) => set("showFastLate", v)}
                />
                <ToggleRow
                  label="ヒット誤差メーター"
                  checked={settings.showErrorMeter}
                  onChange={(v) => set("showErrorMeter", v)}
                />
                <ToggleRow
                  label="曲の進行表示"
                  checked={settings.showProgress}
                  onChange={(v) => set("showProgress", v)}
                />
              </Group>
            )}

            {show("controls", "キー キーバインド 入力") && (
              <Group title="キーバインド">
                <p className="mb-3 text-xs text-white/45">
                  ボタンを押してからキーを入力してください。同じキーの重複は保存しません。
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {settings.keyBindings.map((code, lane) => (
                    <KeyCapture
                      key={lane}
                      lane={lane}
                      code={code}
                      bindings={settings.keyBindings}
                      onChange={(next) => {
                        const keys = [...settings.keyBindings] as GameSettings["keyBindings"];
                        keys[lane] = next;
                        set("keyBindings", keys);
                      }}
                    />
                  ))}
                </div>
              </Group>
            )}
            {show("controls", "入力 オーバーレイ 履歴 テスト") && (
              <Group title="入力オーバーレイ">
                <ToggleRow
                  label="入力表示"
                  checked={settings.inputOverlayEnabled}
                  onChange={(v) => set("inputOverlayEnabled", v)}
                />
                <SelectRow
                  label="PCの位置"
                  value={settings.inputOverlayPosition}
                  options={[
                    ["left", "左"],
                    ["right", "右"],
                  ]}
                  onChange={(v) =>
                    set("inputOverlayPosition", v as GameSettings["inputOverlayPosition"])
                  }
                />
                <RangeRow
                  label="サイズ"
                  value={settings.inputOverlaySize}
                  min={70}
                  max={140}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("inputOverlaySize", v)}
                />
                <RangeRow
                  label="不透明度"
                  value={settings.inputOverlayOpacity}
                  min={0.2}
                  max={1}
                  step={0.05}
                  percent
                  onChange={(v) => set("inputOverlayOpacity", v)}
                />
                <RangeRow
                  label="履歴の表示時間"
                  value={settings.inputOverlayDuration}
                  min={0.5}
                  max={5}
                  step={0.1}
                  suffix="秒"
                  onChange={(v) => set("inputOverlayDuration", v)}
                />
                <p className="py-2 text-xs text-white/45">
                  スマホはHUD下の専用領域に表示。保持時間を棒の長さで示します。判定時間外の入力も表示します。
                </p>
                <InputTest settings={settings} />
              </Group>
            )}
            {show("controls", "タッチ エリア 枠") && (
              <Group title="タッチ操作">
                <ToggleRow
                  label="タッチエリアの枠を表示"
                  checked={settings.showTouchBorders}
                  onChange={(v) => set("showTouchBorders", v)}
                />
                <RangeRow
                  label="タッチエリアの高さ"
                  value={settings.touchAreaHeight}
                  min={45}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("touchAreaHeight", v)}
                />
              </Group>
            )}

            {show("audio", "タイミング オフセット 補正") && (
              <Group title="タイミング補正">
                <OffsetRow
                  label="全体タイミングオフセット"
                  description="プラスにすると、より遅い入力が譜面時刻に合います。端末別に保存されます。"
                  value={settings.timingOffsetMs}
                  onChange={(v) => set("timingOffsetMs", v)}
                />
                <OffsetRow
                  label="視覚オフセット"
                  description="ノーツの見た目だけを前後させます。判定には影響しません。"
                  value={settings.visualOffsetMs}
                  onChange={(v) => set("visualOffsetMs", v)}
                />
                <Calibration onAdopt={(v) => set("timingOffsetMs", v)} />
              </Group>
            )}
            {show("audio", "音量 マスター 楽曲 ヒット音 メニュー") && (
              <Group title="音量">
                <RangeRow
                  label="マスター"
                  value={settings.masterVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  percent
                  onChange={(v) => set("masterVolume", v)}
                />
                <RangeRow
                  label="楽曲"
                  value={settings.musicVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  percent
                  onChange={(v) => set("musicVolume", v)}
                />
                <ToggleRow
                  label="ヒット音"
                  checked={settings.hitSoundEnabled}
                  onChange={(v) => set("hitSoundEnabled", v)}
                />
                <RangeRow
                  label="ヒット音量"
                  value={settings.hitSoundVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  percent
                  onChange={(v) => set("hitSoundVolume", v)}
                />
                <SoundTest volume={settings.masterVolume * settings.hitSoundVolume} />
                <RangeRow
                  label="メニュー効果音"
                  value={settings.menuVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  percent
                  onChange={(v) => set("menuVolume", v)}
                />
              </Group>
            )}

            {show("visual", "ノーツ 形 大きさ レーン 幅 背景") && (
              <Group title="レーンとノーツ">
                <SelectRow
                  label="ノーツ形状"
                  value={settings.noteShape}
                  onChange={(v) => set("noteShape", v as GameSettings["noteShape"])}
                  options={[
                    ["mode", "モード標準"],
                    ["bar", "バー"],
                    ["circle", "丸"],
                    ["arrow", "矢印"],
                  ]}
                />
                <RangeRow
                  label="ノーツの大きさ"
                  value={settings.noteScale}
                  min={70}
                  max={140}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("noteScale", v)}
                />
                <RangeRow
                  label="レーン幅"
                  value={settings.laneWidth}
                  min={70}
                  max={130}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("laneWidth", v)}
                />
                <RangeRow
                  label="背景の暗さ"
                  value={settings.backgroundDim}
                  min={0}
                  max={90}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("backgroundDim", v)}
                />
                <RangeRow
                  label="レーン背景の不透明度"
                  value={settings.laneOpacity}
                  min={25}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(v) => set("laneOpacity", v)}
                />
              </Group>
            )}
            {show("visual", "エフェクト 発光 揺れ 背景演出") && (
              <Group title="演出">
                <ToggleRow
                  label="ヒットエフェクト"
                  checked={settings.hitEffects}
                  onChange={(v) => set("hitEffects", v)}
                />
                <ToggleRow
                  label="発光"
                  checked={settings.glowEffects}
                  onChange={(v) => set("glowEffects", v)}
                />
                <ToggleRow
                  label="画面揺れ"
                  checked={settings.screenShake}
                  onChange={(v) => set("screenShake", v)}
                />
                <ToggleRow
                  label="背景演出"
                  checked={settings.backgroundEffects}
                  onChange={(v) => set("backgroundEffects", v)}
                />
              </Group>
            )}

            {show("comfort", "軽量 アニメーション FPS") && (
              <Group title="パフォーマンス">
                <ToggleRow
                  label="軽量モード"
                  description="装飾と一部のエフェクトを減らします。端末のFPS向上を保証するものではありません。"
                  checked={settings.lightweightMode}
                  onChange={(v) => set("lightweightMode", v)}
                />
                <ToggleRow
                  label="アニメーションを減らす"
                  description="OSの設定も尊重します。"
                  checked={settings.reducedMotion}
                  onChange={(v) => set("reducedMotion", v)}
                />
                <ToggleRow
                  label="FPS表示"
                  checked={settings.showFps}
                  onChange={(v) => set("showFps", v)}
                />
              </Group>
            )}
            <button
              type="button"
              onClick={() => onChange(DEFAULT_SETTINGS)}
              className="mb-6 flex items-center gap-2 text-xs text-white/50 hover:text-white"
            >
              <RotateCcw className="size-4" />
              すべて初期値に戻す
            </button>
          </main>
          <aside className="order-first border-b border-white/10 p-3 md:order-none md:border-l md:border-b-0 md:p-5">
            <Preview settings={settings} />
          </aside>
        </div>
        <footer
          className="shrink-0 border-t border-white/10 px-4 py-2 text-right text-[11px] text-white/40"
          role="status"
        >
          {saveError ? "この端末に保存できませんでした" : "● この端末に自動保存済み"}
        </footer>
      </section>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-semibold tracking-[.18em] text-cyan-200">{title}</h3>
      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[.025] px-4">
        {children}
      </div>
    </section>
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
    <label className="flex items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm">{label}</span>
        {description && (
          <span className="block text-xs leading-relaxed text-white/40">{description}</span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  suffix = "",
  percent,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  percent?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-3">
      <div className="mb-2 flex justify-between gap-3 text-sm">
        <span>
          {label}
          <span className="block text-xs text-white/40">{description}</span>
        </span>
        <output className="tabular-nums text-cyan-100">
          {percent ? Math.round(value * 100) : Number(value.toFixed(2))}
          {percent ? "%" : suffix}
        </output>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      />
    </div>
  );
}
function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: string[][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-3 text-sm">
      <span>
        {label}
        {description && <span className="block text-xs text-white/40">{description}</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-[#171d2b] px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
function OffsetRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm">
          {label}
          <span className="block text-xs leading-relaxed text-white/40">{description}</span>
        </span>
        <input
          type="number"
          min={-300}
          max={300}
          value={value}
          onChange={(e) => onChange(Math.max(-300, Math.min(300, Number(e.target.value))))}
          className="w-20 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-right tabular-nums"
          aria-label={`${label} ms`}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          className="rounded border border-white/10 px-2 py-1"
        >
          −1
        </button>
        <Slider
          min={-300}
          max={300}
          step={1}
          value={[value]}
          onValueChange={([v]) => v !== undefined && onChange(v)}
        />
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="rounded border border-white/10 px-2 py-1"
        >
          +1
        </button>
        <button type="button" onClick={() => onChange(0)} className="text-xs text-white/50">
          リセット
        </button>
      </div>
    </div>
  );
}

function KeyCapture({
  lane,
  code,
  bindings,
  onChange,
}: {
  lane: number;
  code: string;
  bindings: string[];
  onChange: (v: string) => void;
}) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!waiting) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setWaiting(false);
        return;
      }
      if (bindings.some((v, i) => i !== lane && v === e.code)) {
        setError("重複");
        setWaiting(false);
        return;
      }
      onChange(e.code);
      setError("");
      setWaiting(false);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [waiting, bindings, lane, onChange]);
  return (
    <button
      type="button"
      onClick={() => setWaiting(true)}
      className="rounded-lg border border-white/10 bg-black/20 px-1 py-3 text-center text-xs"
    >
      <span className="block text-white/40">L{lane + 1}</span>
      <span className="block truncate text-cyan-100">
        {waiting ? "入力…" : code.replace(/^Key/, "")}
      </span>
      {error && <span className="text-rose-300">{error}</span>}
    </button>
  );
}
function SoundTest({ volume }: { volume: number }) {
  const play = () => {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(Math.max(0.001, volume * 0.15), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close();
  };
  return (
    <div className="py-3">
      <button
        type="button"
        onClick={play}
        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs"
      >
        <Volume2 className="size-4" />
        ヒット音をテスト
      </button>
    </div>
  );
}
function Calibration({ onAdopt }: { onAdopt: (v: number) => void }) {
  const [start, setStart] = useState(0),
    [taps, setTaps] = useState<number[]>([]);
  const running = start > 0;
  const tap = () => {
    if (!running) {
      setStart(performance.now());
      setTaps([]);
      return;
    }
    setTaps((old) => [...old, performance.now() - start]);
  };
  const errors = taps.slice(1).map((t) => {
    const nearest = Math.round(t / 500) * 500;
    return t - nearest;
  });
  const sorted = [...errors].sort((a, b) => a - b);
  const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
  const suggestion = trimmed.length
    ? Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length)
    : null;
  return (
    <div className="py-3">
      <p className="text-sm">タップ・キャリブレーション</p>
      <p className="mb-3 text-xs leading-relaxed text-white/40">
        開始後、一定間隔の点滅に8回以上タップします。入力傾向からの推定で、機器遅延の完全な自動測定ではありません。
      </p>
      <button
        type="button"
        onClick={tap}
        className={`w-full rounded-xl border py-4 text-sm ${running ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10"}`}
      >
        {!running ? "開始" : `点滅に合わせてタップ (${taps.length}/8)`}
      </button>
      {running && (
        <div
          className="mt-2 h-1 animate-pulse bg-cyan-300 motion-reduce:animate-none"
          style={{ animationDuration: "500ms" }}
        />
      )}
      {suggestion !== null && taps.length >= 8 && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span>
            推奨値 {suggestion > 0 ? "+" : ""}
            {suggestion}ms
          </span>
          <button
            type="button"
            onClick={() => {
              onAdopt(suggestion);
              setStart(0);
            }}
            className="rounded bg-cyan-300 px-3 py-1.5 text-black"
          >
            採用
          </button>
        </div>
      )}
    </div>
  );
}
function Preview({ settings }: { settings: GameSettings }) {
  const direction = settings.scrollDirection === "up" ? "up" : "down";
  return (
    <div>
      <p className="mb-2 text-xs tracking-widest text-white/45">LIVE PREVIEW</p>
      <div
        className="relative mx-auto h-32 max-w-[280px] overflow-hidden rounded-xl border border-white/10 bg-black"
        style={{ opacity: 0.4 + settings.laneOpacity / 170 }}
      >
        <div className="absolute inset-0 grid grid-cols-4">
          {[0, 1, 2, 3].map((lane) => (
            <div key={lane} className="relative border-r border-white/10 last:border-0">
              <i
                className={`absolute left-1/2 block -translate-x-1/2 bg-cyan-300 ${settings.noteShape === "circle" ? "size-4 rounded-full" : settings.noteShape === "arrow" ? "size-4 rotate-45" : "h-2 w-[80%] rounded"} ${settings.reducedMotion ? "" : direction === "up" ? "animate-preview-up" : "animate-preview-down"}`}
                style={{
                  animationDuration: `${1.1 / settings.scrollSpeed}s`,
                  transform: `translateX(-50%) scale(${settings.noteScale / 100})`,
                }}
              />
            </div>
          ))}
        </div>
        <div
          className="absolute inset-x-0 h-px bg-cyan-100"
          style={{ top: `${settings.judgeLinePct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/35">
        速度・方向・形状・サイズ・判定ラインを反映
      </p>
    </div>
  );
}
