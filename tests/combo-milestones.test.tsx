import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComboCounter } from "@/components/game/ComboCounter";
import { SettingsPanel } from "@/components/game/SettingsPanel";
import {
  DEFAULT_COMBO_RIPPLE_COLOR,
  FIXED_COMBO_RIPPLE_RED,
  getComboMilestone,
  isFixedRedComboMilestone,
} from "@/game/comboMilestone";
import { DEFAULT_SETTINGS, sanitizeSettings, createGameSettingsStore } from "@/game/settings";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("combo milestone arithmetic", () => {
  it.each([
    [0, 0],
    [1, 0],
    [99, 0],
    [100, 100],
    [199, 100],
    [200, 200],
    [900, 900],
    [999, 900],
    [1000, 1000],
    [1099, 1000],
    [1100, 1100],
    [1900, 1900],
    [2000, 2000],
    [2100, 2100],
    [3000, 3000],
    [3900, 3900],
    [-1, 0],
    [Infinity, 0],
    [101.5, 0],
  ])("maps %s to milestone %s", (combo, expected) => {
    expect(getComboMilestone(combo)).toBe(expected);
  });

  it.each([1000, 2000, 3000, 10000])("%s is fixed red", (milestone) => {
    expect(isFixedRedComboMilestone(milestone)).toBe(true);
  });
  it.each([0, 100, 200, 900, 1100, 1900, 2100])(
    "%s is not fixed red",
    (milestone) => {
      expect(isFixedRedComboMilestone(milestone)).toBe(false);
    },
  );
});

describe.each([false, true])("combo milestone effects (FNF: %s)", (fnf) => {
  const color = "#28bbcc";
  const renderAt = (combo: number, enabled = true, rippleColor = color) => (
    <ComboCounter combo={combo} enabled={enabled} fnf={fnf} rippleColor={rippleColor} />
  );
  const ring = (view: ReturnType<typeof render>) =>
    view.queryByTestId("combo-milestone-ping") as HTMLElement | null;
  const counter = (view: ReturnType<typeof render>) =>
    view.getByTestId("combo-counter") as HTMLElement;

  it("does not alter combo text color; triggers each 100 from 100 to 3100", () => {
    const view = render(renderAt(0));
    expect(view.queryByTestId("combo-counter")).toBeNull();
    view.rerender(renderAt(99));
    expect(ring(view)).toBeNull();

    for (let milestone = 100; milestone <= 3100; milestone += 100) {
      view.rerender(renderAt(milestone));
      const currentRing = ring(view);
      expect(currentRing, `ring for ${milestone}`).not.toBeNull();
      expect(counter(view).style.color).toBe("");
      expect(counter(view).classList.contains("text-combo")).toBe(true);
      expect(currentRing?.style.borderColor).toBe(
        isFixedRedComboMilestone(milestone) ? "rgb(255, 72, 72)" : "rgb(40, 187, 204)",
      );

      view.rerender(renderAt(milestone + 1));
      expect(ring(view)).toBe(currentRing);
      act(() => {
        vi.advanceTimersByTime(750);
      });
      expect(ring(view)).toBeNull();
    }
  });

  it("handles skipped thresholds, replays neither the same milestone nor old effects", () => {
    const view = render(renderAt(98));
    view.rerender(renderAt(102));
    const first = ring(view);
    expect(first).not.toBeNull();
    view.rerender(renderAt(203));
    expect(ring(view)).not.toBe(first);
    view.rerender(renderAt(1003));
    expect(ring(view)?.style.borderColor).toBe("rgb(255, 72, 72)");
    view.rerender(renderAt(1102));
    expect(ring(view)?.style.borderColor).toBe("rgb(40, 187, 204)");
    view.rerender(renderAt(2101));
    expect(ring(view)?.style.borderColor).toBe("rgb(40, 187, 204)");
    view.rerender(renderAt(0));
    expect(view.queryByTestId("combo-counter")).toBeNull();
    view.rerender(renderAt(99));
    expect(ring(view)).toBeNull();
    view.rerender(renderAt(100));
    expect(ring(view)).not.toBeNull();
  });

  it("keeps milestones silent with effects off and does not replay when reenabled", () => {
    const view = render(renderAt(99, false));
    view.rerender(renderAt(100, false));
    expect(ring(view)).toBeNull();
    expect(counter(view).style.color).toBe("");
    view.rerender(renderAt(101, true));
    expect(ring(view)).toBeNull();
    view.rerender(renderAt(1000, true));
    expect(ring(view)?.style.borderColor).toBe("rgb(255, 72, 72)");
    view.rerender(renderAt(1001, false));
    expect(ring(view)).toBeNull();
    view.rerender(renderAt(1001, true));
    expect(ring(view)).toBeNull();
  });

  it("customizes ordinary rings but never the fixed red thousand milestone", () => {
    const view = render(renderAt(99, true, "#11ff33"));
    view.rerender(renderAt(100, true, "#11ff33"));
    expect(ring(view)?.style.borderColor).toBe("rgb(17, 255, 51)");
    view.rerender(renderAt(1000, true, "#11ff33"));
    expect(ring(view)?.style.borderColor).toBe("rgb(255, 72, 72)");
    view.rerender(renderAt(1100, true, "#ff00ff"));
    expect(ring(view)?.style.borderColor).toBe("rgb(255, 0, 255)");
    view.rerender(renderAt(2000, true, "#ff00ff"));
    expect(ring(view)?.style.borderColor).toBe("rgb(255, 72, 72)");
  });

  it("keeps the ripple circle dimensions and animation unchanged at 1000", () => {
    const view = render(renderAt(899));
    view.rerender(renderAt(900));
    const first = ring(view);
    expect(first?.className).toContain("rounded-full");
    expect(first?.className).toContain("animate-combo-milestone-ping");
    const wrapperClass = first?.parentElement?.className;
    view.rerender(renderAt(1000));
    expect(ring(view)?.className).toBe(first?.className);
    expect(ring(view)?.parentElement?.className).toBe(wrapperClass);
  });
});

describe("customizable ripple settings", () => {
  it("migrates legacy settings, normalizes valid colors and rejects invalid values", () => {
    expect(sanitizeSettings(undefined).comboRippleColor).toBe(DEFAULT_COMBO_RIPPLE_COLOR);
    expect(sanitizeSettings({ version: 5 }).comboRippleColor).toBe(DEFAULT_COMBO_RIPPLE_COLOR);
    expect(sanitizeSettings({ comboRippleColor: "#AA11Bb" }).comboRippleColor).toBe("#aa11bb");
    for (const invalid of ["red", "#123", "##123456", "#ffffff00", "", null, 44]) {
      expect(sanitizeSettings({ comboRippleColor: invalid }).comboRippleColor).toBe(
        DEFAULT_COMBO_RIPPLE_COLOR,
      );
    }
    expect(FIXED_COMBO_RIPPLE_RED).toBe("#ff4848");
  });

  it("persists the user's color without modifying the private device settings", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const store = createGameSettingsStore(storage);
    store.hydrate();
    store.setSettings((s) => ({ ...s, comboRippleColor: "#9944cc" }));
    const restored = createGameSettingsStore(storage);
    restored.hydrate();
    expect(restored.getSnapshot().settings.comboRippleColor).toBe("#9944cc");
    expect(JSON.parse(values.get("pulse-lane:device-settings:v2") ?? "{}")).not.toHaveProperty(
      "comboRippleColor",
    );
  });

  it("allows editing only the ordinary color in the visual settings panel", () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const view = render(
      <SettingsPanel open settings={DEFAULT_SETTINGS} onChange={onChange} onClose={() => {}} />,
    );
    fireEvent.click(view.getByRole("button", { name: "見た目" }));
    const picker = view.getByLabelText("通常コンボ波紋の色") as HTMLInputElement;
    expect(picker.value).toBe(DEFAULT_COMBO_RIPPLE_COLOR);
    expect(view.getByText(/赤色固定です/)).toBeTruthy();
    expect(view.queryByLabelText("1000コンボの波紋色")).toBeNull();
    fireEvent.change(picker, { target: { value: "#aa33bb" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ comboRippleColor: "#aa33bb" }),
    );
  });
});
