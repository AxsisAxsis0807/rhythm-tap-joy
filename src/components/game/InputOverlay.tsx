import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DIRECTIONS, InputLedger } from "@/game/input";
import { resolveKeyMap, type GameSettings } from "@/game/settings";
import type { PlayStyleId } from "@/game/types";
import {
  inputOverlayLayout,
  inputOverlayMetrics,
  type OverlayViewport,
} from "@/game/inputOverlayLayout";
import { TouchInput } from "./TouchInput";

export function InputOverlay({
  inputs,
  settings,
  test = false,
  preview = false,
  playStyle = "mania",
}: {
  inputs: InputLedger;
  settings: GameSettings;
  test?: boolean;
  preview?: boolean;
  playStyle?: PlayStyleId;
}) {
  useSyncExternalStore(inputs.subscribe, inputs.snapshot, inputs.snapshot);
  const [now, setNow] = useState(() => performance.now());
  const historyRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  useEffect(() => {
    const node = historyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMeasuredHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (preview) return;
    let raf = 0;
    const tick = () => {
      const time = performance.now();
      inputs.prune(time);
      setNow(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inputs, preview]);
  const seconds = settings.inputOverlayDuration;
  const height = settings.inputOverlayHistoryHeight;
  const metrics = inputOverlayMetrics(settings);
  const gridStyle = {
    gridTemplateColumns: `repeat(4, ${settings.inputOverlayKeyWidth}px)`,
    gap: settings.inputOverlayGap,
  };
  const travelHeight = measuredHeight ?? height;
  const kinds = new Set(
    inputs.bars
      .filter((b) => b.end === undefined || now - b.end < seconds * 1000)
      .map((b) => b.kind),
  );
  const source = kinds.size > 1 ? "Mixed" : ([...kinds][0] ?? "Touch / Keyboard");
  return (
    <div
      data-testid="input-overlay"
      className="pointer-events-none shrink-0 rounded-lg border border-cyan-200/20 bg-[#0b1520]/90 p-1.5 text-cyan-100"
      style={{
        opacity: settings.inputOverlayOpacity,
        width: metrics.width,
        height: metrics.height,
        boxSizing: "border-box",
      }}
    >
      <div className="flex h-3 min-w-0 justify-between gap-1 overflow-hidden text-[8px] leading-3 tracking-widest">
        <span className="truncate">KEY OVERLAY</span>
        <span className="truncate">{preview ? "表示例" : `${source} · LIVE`}</span>
      </div>
      <div
        ref={historyRef}
        className="relative mt-1 grid overflow-hidden"
        style={{ ...gridStyle, height }}
      >
        {[0, 1, 2, 3].map((lane) => (
          <div key={lane} className="relative overflow-hidden rounded bg-cyan-200/[.035]">
            {inputs.bars
              .filter(
                (b) => b.lane === lane && (b.end === undefined || now - b.end < seconds * 1000),
              )
              .map((bar) => {
                const end = bar.end ?? now;
                const duration = Math.max(0, end - bar.start);
                const bottom =
                  bar.end === undefined
                    ? 0
                    : (Math.max(0, now - bar.end) / (seconds * 1000)) * travelHeight;
                return (
                  <i
                    key={bar.id}
                    data-source={bar.source}
                    data-duration={duration}
                    title={`${bar.kind}: ${duration.toFixed(0)}ms · ${bar.outcome ?? "test"}`}
                    className={`absolute rounded-sm ${bar.cancelled ? "bg-rose-300/70" : bar.kind === "Keyboard" ? "bg-cyan-200/85" : "bg-teal-400/85"}`}
                    style={{
                      left: bar.kind === "Keyboard" ? "12%" : "54%",
                      width: "34%",
                      bottom,
                      height: Math.max(3, (duration / (seconds * 1000)) * travelHeight),
                    }}
                  />
                );
              })}
          </div>
        ))}
      </div>
      <div className="mt-1 grid" style={{ ...gridStyle, height: settings.inputOverlayKeyHeight }}>
        {DIRECTIONS.map((label, lane) => (
          <div
            key={label}
            className={`flex min-w-0 flex-col items-center justify-center overflow-hidden rounded border text-center text-[8px] ${inputs.activeLanes.has(lane) ? "border-cyan-100 bg-cyan-200/25 text-white" : "border-cyan-200/15"}`}
          >
            <div className="w-full truncate">{label}</div>
            <div className="w-full truncate text-[9px]">
              {resolveKeyMap(settings, playStyle)
                [lane]?.map((k) => k.replace(/^Key/, ""))
                .join(" / ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InputTest({
  settings,
  playStyle = "mania",
}: {
  settings: GameSettings;
  playStyle?: PlayStyleId;
}) {
  const keySignature = JSON.stringify(resolveKeyMap(settings, playStyle));
  const [inputs] = useState(() => new InputLedger());
  useSyncExternalStore(inputs.subscribe, inputs.snapshot, inputs.snapshot);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!enabled) {
      inputs.clear();
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.defaultPrevented ||
        (e.target instanceof HTMLElement && e.target.closest("input,select,textarea"))
      )
        return;
      const lane = (JSON.parse(keySignature) as string[][]).findIndex((keys) =>
        keys.includes(e.code),
      );
      if (lane < 0) return;
      e.preventDefault();
      inputs.press(`key:${e.code}`, lane, e.timeStamp);
    };
    const up = (e: KeyboardEvent) => {
      inputs.release(`key:${e.code}`, e.timeStamp);
    };
    const clear = () => inputs.clear();
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
      clear();
    };
  }, [enabled, inputs, keySignature]);
  return (
    <div className="py-3">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        className="mb-2 rounded border border-cyan-200/30 px-3 py-2 text-xs"
      >
        {enabled ? "入力テストを終了" : "入力テストを開始"}
      </button>
      {enabled && (
        <>
          <div className="relative h-44 overflow-hidden rounded-lg border border-white/10">
            <InputOverlayLayer inputs={inputs} settings={settings} playStyle={playStyle} />
          </div>
          <div className="relative mt-2 h-20 rounded border border-cyan-200/20 bg-black/30">
            <TouchInput
              borders
              onPress={(lane, source, time) => {
                inputs.press(source, lane, time);
              }}
              onRelease={(source, time, cancel) => {
                inputs.release(source, time, cancel);
              }}
            />
          </div>
          <p className="mt-2 text-[10px] text-white/50">
            受信 {inputs.received} / 受理 {inputs.accepted} · 保持 {inputs.sources.size} ·
            キャンセルは赤
          </p>
        </>
      )}
    </div>
  );
}

/** Independent, click-through layer. It never participates in lane layout. */
type InputOverlayLayerProps = {
  inputs: InputLedger;
  settings: GameSettings;
  preview?: boolean;
  playStyle?: PlayStyleId;
};

export function InputOverlayLayer(props: InputOverlayLayerProps) {
  return props.settings.inputOverlayEnabled ? <MountedInputOverlayLayer {...props} /> : null;
}

function MountedInputOverlayLayer({
  inputs,
  settings,
  preview = false,
  playStyle = "mania",
}: InputOverlayLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<OverlayViewport>({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect(),
        css = getComputedStyle(node);
      setViewport({
        width: rect.width,
        height: rect.height,
        left: parseFloat(css.paddingLeft) || 0,
        right: parseFloat(css.paddingRight) || 0,
        top: parseFloat(css.paddingTop) || 0,
        bottom: parseFloat(css.paddingBottom) || 0,
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const layout = inputOverlayLayout(settings, viewport);
  return (
    <div
      ref={ref}
      data-testid="input-overlay-layer"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {settings.inputOverlayEnabled && (
        <div
          className="pointer-events-none absolute"
          data-testid="input-overlay-placement"
          style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
        >
          <div style={{ transform: `scale(${layout.scale})`, transformOrigin: "top left" }}>
            <InputOverlay
              inputs={inputs}
              settings={settings}
              preview={preview}
              playStyle={playStyle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function InputOverlayPreview({
  settings,
  playStyle = "mania",
}: {
  settings: GameSettings;
  playStyle?: PlayStyleId;
}) {
  const [inputs] = useState(() => {
    const input = new InputLedger(),
      now = performance.now();
    input.press("preview:tap", 0, now - 260);
    input.release("preview:tap", now - 210);
    input.press("preview:hold", 2, now - 700);
    return input;
  });
  return (
    <div className="min-w-0" aria-label="入力可視化のプレビュー">
      <p className="mb-2 text-xs tracking-widest text-cyan-100">入力可視化プレビュー（表示例）</p>
      <div className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-black/30 md:h-64">
        <div
          className="absolute inset-y-0 left-1/2 grid w-[40%] -translate-x-1/2 grid-cols-4 divide-x divide-white/15 border-x border-white/15 bg-white/[.04]"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((lane) => (
            <div key={lane} className="relative">
              <i
                className="absolute inset-x-1 h-2 border border-cyan-200/40"
                style={{ top: `${settings.judgeLinePct}%` }}
              />
            </div>
          ))}
        </div>
        <InputOverlayLayer inputs={inputs} settings={settings} preview playStyle={playStyle} />
        {!settings.inputOverlayEnabled && (
          <p className="absolute inset-x-0 top-4 text-center text-xs text-white/60">
            入力可視化は非表示です
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/50">
        枠内の配置見本です。中央のレーンは固定。大きい設定は枠内に収まるよう縮小されます。
      </p>
    </div>
  );
}
