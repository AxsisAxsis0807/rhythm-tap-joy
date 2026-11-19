import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComboCounter } from "@/components/game/ComboCounter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each([false, true])("combo milestone effects (FNF: %s)", (fnf) => {
  it("changes color only at milestones and plays each ripple once", () => {
    const view = render(<ComboCounter combo={0} enabled fnf={fnf} />);
    const counter = () => view.getByTestId("combo-counter");
    const ping = () => view.queryByTestId("combo-milestone-ping");
    const update = (combo: number, enabled = true) =>
      view.rerender(<ComboCounter combo={combo} enabled={enabled} fnf={fnf} />);

    expect(view.queryByTestId("combo-counter")).toBeNull();
    update(99);
    expect(counter().style.color).toBe("");
    expect(ping()).toBeNull();

    update(100);
    expect(counter().style.color).toBe("rgb(59, 158, 255)");
    const blue = view.getByTestId("combo-milestone-ping");
    update(101);
    expect(ping()).toBe(blue);
    act(() => vi.advanceTimersByTime(750));
    expect(ping()).toBeNull();
    update(999);
    expect(counter().style.color).toBe("rgb(59, 158, 255)");
    expect(ping()).toBeNull();

    update(1000);
    expect(counter().style.color).toBe("rgb(255, 72, 72)");
    const red = view.getByTestId("combo-milestone-ping");
    update(1001);
    expect(ping()).toBe(red);
    act(() => vi.advanceTimersByTime(750));
    expect(ping()).toBeNull();

    update(0);
    expect(view.queryByTestId("combo-counter")).toBeNull();
    update(2);
    expect(counter().style.color).toBe("");
    update(101);
    expect(counter().style.color).toBe("rgb(59, 158, 255)");
    expect(ping()).not.toBeNull();
  });

  it("handles skipped counts and replaces an active ripple at the next milestone", () => {
    const view = render(<ComboCounter combo={98} enabled fnf={fnf} />);
    view.rerender(<ComboCounter combo={102} enabled fnf={fnf} />);
    const blue = view.getByTestId("combo-milestone-ping");
    view.rerender(<ComboCounter combo={1002} enabled fnf={fnf} />);
    expect(view.getByTestId("combo-milestone-ping")).not.toBe(blue);
    expect(view.getByTestId("combo-counter").style.color).toBe("rgb(255, 72, 72)");
    view.rerender(<ComboCounter combo={0} enabled fnf={fnf} />);
    expect(view.queryByTestId("combo-milestone-ping")).toBeNull();
  });

  it("keeps milestone colors with effects off and never replays stale ripples", () => {
    const view = render(<ComboCounter combo={99} enabled={false} fnf={fnf} />);
    view.rerender(<ComboCounter combo={100} enabled={false} fnf={fnf} />);
    expect(view.getByTestId("combo-counter").style.color).toBe("rgb(59, 158, 255)");
    expect(view.queryByTestId("combo-milestone-ping")).toBeNull();
    view.rerender(<ComboCounter combo={101} enabled fnf={fnf} />);
    expect(view.queryByTestId("combo-milestone-ping")).toBeNull();
    view.rerender(<ComboCounter combo={1000} enabled fnf={fnf} />);
    expect(view.getByTestId("combo-milestone-ping")).toBeTruthy();
    view.rerender(<ComboCounter combo={1001} enabled={false} fnf={fnf} />);
    expect(view.queryByTestId("combo-milestone-ping")).toBeNull();
    view.rerender(<ComboCounter combo={1001} enabled fnf={fnf} />);
    expect(view.getByTestId("combo-counter").style.color).toBe("rgb(255, 72, 72)");
    expect(view.queryByTestId("combo-milestone-ping")).toBeNull();
  });
});
