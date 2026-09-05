import { GAME_MODES, getMode } from "@/game/modes";

/** Mode switcher. New entries in GAME_MODES appear here automatically. */
export function ModePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="w-full max-w-xs">
      <p className="mb-2 text-[10px] tracking-[0.4em] text-muted-foreground">
        MODE
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {GAME_MODES.map((m) => {
          const active = m.id === value;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={`rounded-full border px-4 py-1.5 font-display text-xs tracking-widest transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {getMode(value).description}
      </p>
    </div>
  );
}
