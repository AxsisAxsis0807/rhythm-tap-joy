import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DIRECTIONS, InputLedger } from "@/game/input";
import type { GameSettings } from "@/game/settings";
import { TouchInput } from "./TouchInput";

export function InputOverlay({
  inputs,
  settings,
  test = false,
}: {
  inputs: InputLedger;
  settings: GameSettings;
  test?: boolean;
}) {
  useSyncExternalStore(inputs.subscribe, inputs.snapshot, inputs.snapshot);
  const [now, setNow] = useState(0);
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
    let raf = 0;
    const tick = () => {
      const time = performance.now();
      inputs.prune(time);
      setNow(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inputs]);
  const seconds = settings.inputOverlayDuration;
  const height = test ? 90 : (72 * settings.inputOverlaySize) / 100;
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
      className="pointer-events-none mx-auto w-full max-w-[300px] rounded-lg border border-cyan-200/20 bg-[#0b1520]/90 p-1.5 text-cyan-100"
      style={{ opacity: settings.inputOverlayOpacity }}
    >
      <div className="flex justify-between text-[8px] tracking-widest">
        <span>KEY OVERLAY</span>
        <span>{source} · LIVE</span>
      </div>
      <div
        ref={historyRef}
        className="relative mt-1 grid grid-cols-4 gap-1 overflow-hidden"
        style={{ height }}
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
      <div className="grid grid-cols-4 gap-1">
        {DIRECTIONS.map((label, lane) => (
          <div
            key={label}
            className={`rounded border py-1 text-center text-[8px] ${inputs.activeLanes.has(lane) ? "border-cyan-100 bg-cyan-200/25 text-white" : "border-cyan-200/15"}`}
          >
            <div>{label}</div>
            <div className="truncate text-[9px]">
              {(settings.keyBindings[lane] ?? "").replace(/^Key/, "")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InputTest({ settings }: { settings: GameSettings }) {
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
      const lane = settings.keyBindings.indexOf(e.code);
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
  }, [enabled, inputs, settings.keyBindings]);
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
          <InputOverlay inputs={inputs} settings={settings} test />
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
