import { Check } from "lucide-react";
import { RadioGroup } from "@/components/ui/radio-group";
import * as Radio from "@radix-ui/react-radio-group";
import type { PlayStyleId } from "@/game/types";

/** Style selection is independent of the chart's import format. */
export function ModePicker({
  value,
  onChange,
}: {
  value: PlayStyleId;
  onChange: (id: PlayStyleId) => void;
}) {
  return (
    <div className="w-full">
      <p id="play-style-label" className="mb-2 text-xs tracking-[.2em] text-muted-foreground">
        PLAY STYLE
      </p>
      <RadioGroup
        aria-labelledby="play-style-label"
        value={value}
        onValueChange={(id) => {
          if (id === "mania" || id === "fnf") onChange(id);
        }}
        className="grid grid-cols-2 gap-3"
      >
        {(
          [
            ["mania", "OSU!MANIA"],
            ["fnf", "FNF"],
          ] as const
        ).map(([id, name]) => (
          <Radio.Item
            key={id}
            value={id}
            className="flex min-h-12 min-w-0 items-center justify-center gap-1 sm:gap-2 rounded-xl border border-white/20 px-2 py-3 sm:px-3 font-display text-sm tracking-wider text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090a0f] data-[state=checked]:border-cyan-200 data-[state=checked]:bg-cyan-200/15 data-[state=checked]:text-cyan-100"
          >
            <span className="size-4 shrink-0">
              <Radio.Indicator>
                <Check aria-hidden="true" className="size-4" />
              </Radio.Indicator>
            </span>
            {name}
          </Radio.Item>
        ))}
      </RadioGroup>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        スタイルにより早すぎる入力の扱いが異なります。判定幅と得点係数は共通です。
      </p>
    </div>
  );
}
