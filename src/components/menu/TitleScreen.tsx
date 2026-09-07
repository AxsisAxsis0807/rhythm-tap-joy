/**
 * Placeholder title screen. The real logo/artwork will be dropped in later,
 * so this stays intentionally simple: app name + tap-to-continue.
 */
export function TitleScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <button
      type="button"
      onClick={onContinue}
      className="relative flex h-[100dvh] w-full flex-col items-center justify-center gap-6 overflow-hidden bg-background select-none"
      aria-label="はじめる"
    >
      {/* soft background glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, oklch(0.35 0.08 80 / 0.35), transparent 70%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-2">
        <span className="text-xs tracking-[0.6em] text-muted-foreground">
          RHYTHM GAME PROTOTYPE
        </span>
        <h1 className="font-display text-5xl font-bold tracking-[0.15em] text-foreground sm:text-7xl">
          PULSE LANE
        </h1>
      </div>
      <span className="relative animate-pulse font-display text-sm tracking-[0.4em] text-muted-foreground">
        TAP TO CONTINUE
      </span>
    </button>
  );
}
