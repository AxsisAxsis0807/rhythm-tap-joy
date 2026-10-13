import { afterEach, it, expect } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ModePicker } from "@/components/game/ModePicker";
import { resolvePlayStyle } from "@/game/styleSelection";
import { createGameSettingsStore } from "@/game/settings";
afterEach(cleanup);
it("explicit override wins across metadata refresh, recommendation wins over last style", () => {
  expect(resolvePlayStyle(undefined, "fnf", "mania")).toBe("fnf");
  expect(resolvePlayStyle("mania", "fnf", "fnf")).toBe("mania");
  expect(resolvePlayStyle(undefined, null, null)).toBe("mania");
});
it("style selector exposes radios with checked state and full labels", () => {
  let style = "";
  const view = render(
    <ModePicker
      value="mania"
      onChange={(v) => {
        style = v;
      }}
    />,
  );
  const mania = view.getByRole("radio", { name: "OSU!MANIA" }),
    fnf = view.getByRole("radio", { name: "FNF" });
  expect(mania.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(fnf);
  expect(style).toBe("fnf");
});
it("v2 hydration preserves device settings and CLASSIC without writing defaults first", () => {
  const rows = new Map([
    [
      "pulse-lane:game-settings",
      JSON.stringify({
        version: 2,
        modeId: "classic",
        scrollSpeed: 2,
        keyBindings: ["KeyA", "KeyS", "KeyK", "KeyL"],
      }),
    ],
    ["pulse-lane:device-settings:v2", JSON.stringify({ timingOffsetMs: 125 })],
  ]);
  let writes = 0;
  const store = createGameSettingsStore({
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      rows.set(key, value);
    },
  });
  expect(writes).toBe(0);
  store.hydrate();
  expect(store.getSnapshot().settings).toMatchObject({
    maniaSkin: "classic",
    scrollSpeed: 2,
    timingOffsetMs: 125,
  });
  expect(writes).toBe(0);
  store.setSettings((s) => ({ ...s, previewVolume: 0.2 }));
  expect(store.getSnapshot().settings.timingOffsetMs).toBe(125);
  expect(store.getSnapshot().settings.keyBindings[0]).toBe("KeyA");
});
