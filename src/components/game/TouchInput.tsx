import { useEffect, useRef } from "react";
import { DIRECTIONS, laneAt } from "@/game/input";
/** A finger remains assigned to its initial lane until release; no slide remapping. */
export function TouchInput({
  onPress,
  onRelease,
  borders = false,
  height = 100,
  disabled = false,
}: {
  onPress: (lane: number, source: string, stamp: number) => void;
  onRelease: (source: string, stamp: number, cancelled: boolean) => void;
  borders?: boolean;
  height?: number;
  disabled?: boolean;
}) {
  const pointers = useRef(new Set<number>());
  const latestRelease = useRef(onRelease);
  latestRelease.current = onRelease;
  const release = (id: number, stamp: number, cancelled: boolean) => {
    if (!pointers.current.delete(id)) return;
    latestRelease.current(`pointer:${id}`, stamp, cancelled);
  };
  useEffect(() => {
    // Fallback when capture fails or is unavailable: only release pointers owned by this surface.
    const up = (e: PointerEvent) => release(e.pointerId, e.timeStamp, false);
    const cancel = (e: PointerEvent) => release(e.pointerId, e.timeStamp, true);
    const clear = () => {
      for (const id of [...pointers.current]) release(id, performance.now(), true);
    };
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
      clear();
    };
  }, []);
  useEffect(() => {
    if (disabled) for (const id of [...pointers.current]) release(id, performance.now(), true);
  }, [disabled]);
  return (
    <div
      data-testid="touch-input"
      className="absolute inset-x-0 bottom-0 z-20 flex select-none"
      style={{
        height: `${height}%`,
        touchAction: "none",
        WebkitTouchCallout: "none",
        pointerEvents: disabled ? "none" : "auto",
      }}
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        if (pointers.current.has(e.pointerId)) return;
        pointers.current.add(e.pointerId);
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onPress(laneAt(e.clientX, rect.left, rect.width), `pointer:${e.pointerId}`, e.timeStamp);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* OS may already have cancelled. */
        }
      }}
      onPointerUp={(e) => release(e.pointerId, e.timeStamp, false)}
      onPointerCancel={(e) => release(e.pointerId, e.timeStamp, true)}
      onLostPointerCapture={(e) => release(e.pointerId, e.timeStamp, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {DIRECTIONS.map((label) => (
        <div
          key={label}
          className={`pointer-events-none flex flex-1 items-end justify-center pb-[max(1.8rem,env(safe-area-inset-bottom))] text-[9px] text-cyan-100/45 ${borders ? "border-r border-cyan-200/20 last:border-r-0 bg-cyan-200/[.02]" : ""}`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
