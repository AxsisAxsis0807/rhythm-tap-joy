import { laneColor, type GameMode } from "@/game/modes";

/** Renders a single note (or a receptor outline) in the current mode's skin. */
export function NoteSprite({
  mode,
  lane,
  receptor = false,
  pressed = false,
  fluid = false,
}: {
  mode: GameMode;
  lane: number;
  receptor?: boolean;
  pressed?: boolean;
  fluid?: boolean;
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
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      className="block aspect-square w-full"
      style={{ width: fluid ? "100%" : size, maxWidth: fluid ? size * 1.5 : size, color, opacity: receptor ? (pressed ? 1 : 0.85) : 1 }}
    >
      <path transform={`rotate(${[180, 90, 270, 0][lane % 4] ?? 0} 32 32)`} d="M5 23 H32 V6 L59 32 L32 58 V41 H5 Z" fill={receptor && !pressed ? "var(--muted-foreground)" : "currentColor"} stroke="var(--arrow-foreground)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
