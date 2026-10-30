import { memo } from "react";
import { laneColor, type GameMode } from "@/game/modes";

/** Renders a single note (or a receptor outline) in the current mode's skin. */
export function NoteSprite({
  mode,
  lane,
  receptor = false,
  pressed = false,
  fluid = false,
  glow = true,
}: {
  mode: GameMode;
  lane: number;
  receptor?: boolean;
  pressed?: boolean;
  fluid?: boolean;
  glow?: boolean;
}) {
  // Snapshot only presentation scalars. A fresh or mutated mode object is safe;
  // mutable runtime notes, play and activeLanes never cross this memo boundary.
  return (
    <Sprite
      shape={mode.noteShape}
      color={laneColor(mode, lane)}
      size={mode.noteSize}
      rotation={[180, 90, 270, 0][lane % 4] ?? 0}
      receptor={receptor}
      pressed={pressed}
      fluid={fluid}
      glow={glow}
    />
  );
}

const Sprite = memo(function Sprite({
  shape,
  color,
  size,
  rotation,
  receptor,
  pressed,
  fluid,
  glow,
}: {
  shape: GameMode["noteShape"];
  color: string;
  size: number;
  rotation: number;
  receptor: boolean;
  pressed: boolean;
  fluid: boolean;
  glow: boolean;
}) {
  if (shape === "bar") {
    return (
      <div
        className={`rounded-sm ${glow ? "shadow-note" : ""}`}
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

  if (shape === "circle") {
    return (
      <div
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: receptor ? "transparent" : color,
          border: `${receptor ? 3 : 2}px solid ${color}`,
          opacity: receptor ? (pressed ? 0.95 : 0.45) : 1,
          boxShadow: receptor || !glow ? undefined : `0 0 12px ${color}`,
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
      style={{
        width: fluid ? "100%" : size,
        maxWidth: fluid ? size * 1.5 : size,
        color,
        opacity: receptor ? (pressed ? 1 : 0.85) : 1,
      }}
    >
      <path
        transform={`rotate(${rotation} 32 32)`}
        d="M5 23 H32 V6 L59 32 L32 58 V41 H5 Z"
        fill={receptor && !pressed ? "var(--muted-foreground)" : "currentColor"}
        stroke="var(--arrow-foreground)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
});
