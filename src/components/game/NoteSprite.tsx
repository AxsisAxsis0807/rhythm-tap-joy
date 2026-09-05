import { ARROW_GLYPHS, laneColor, type GameMode } from "@/game/modes";

/** Renders a single note (or a receptor outline) in the current mode's skin. */
export function NoteSprite({
  mode,
  lane,
  receptor = false,
  pressed = false,
}: {
  mode: GameMode;
  lane: number;
  receptor?: boolean;
  pressed?: boolean;
}) {
  const color = laneColor(mode, lane);
  const size = mode.noteSize;

  if (mode.noteShape === "bar") {
    return (
      <div
        className="rounded-sm shadow-note"
        style={{
          height: receptor ? 4 : size,
          width: "100%",
          background: receptor ? "transparent" : color,
          border: receptor ? `2px solid ${color}` : undefined,
          opacity: receptor ? 0.5 : 1,
        }}
      />
    );
  }

  if (mode.noteShape === "circle") {
    return (
      <div
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: receptor ? "transparent" : color,
          border: `${receptor ? 3 : 2}px solid ${color}`,
          opacity: receptor ? (pressed ? 0.95 : 0.45) : 1,
          boxShadow: receptor ? undefined : `0 0 12px ${color}`,
        }}
      />
    );
  }

  // arrow
  return (
    <div
      className="flex items-center justify-center rounded-md font-display leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.62,
        color: receptor ? color : "var(--arrow-foreground)",
        background: receptor ? "transparent" : color,
        border: `3px solid ${color}`,
        opacity: receptor ? (pressed ? 1 : 0.4) : 1,
        boxShadow: receptor ? undefined : `0 0 14px ${color}`,
      }}
    >
      {ARROW_GLYPHS[lane % ARROW_GLYPHS.length]}
    </div>
  );
}
