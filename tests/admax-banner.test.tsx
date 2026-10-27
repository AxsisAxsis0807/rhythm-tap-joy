import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdMaxBanner, ADMAX_DOCUMENT } from "@/components/app/AdMaxBanner";

let resize: ResizeObserverCallback;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const size = { width: 300, height: 250 };
function width(value: number) {
  act(() =>
    resize([{ contentRect: { width: value } } as ResizeObserverEntry], {} as ResizeObserver),
  );
}
it("makes no ad document or request before the account settings are confirmed", () => {
  const view = render(<AdMaxBanner />);
  expect(view.container.innerHTML).toBe("");
});
it("does not crop, scale or load a creative on a narrower screen", () => {
  const view = render(<AdMaxBanner size={size} />);
  width(299);
  expect(view.queryByTitle("広告 — 忍者AdMax")).toBeNull();
  width(300);
  const frame = view.getByTitle("広告 — 忍者AdMax");
  expect(frame.getAttribute("width")).toBe("300");
  expect(frame.getAttribute("height")).toBe("250");
  expect(frame.getAttribute("srcdoc")).toBe(ADMAX_DOCUMENT);
  expect(document.querySelectorAll('script[src*="adm.shinobi.jp"]')).toHaveLength(0);
  width(500);
  expect(view.getByTitle("広告 — 忍者AdMax")).toBe(frame);
  width(299);
  expect(view.queryByTitle("広告 — 忍者AdMax")).toBeNull();
});
it("keeps one isolated document across rerenders, and removes it on navigation", () => {
  const view = render(
    <StrictMode>
      <AdMaxBanner size={size} />
    </StrictMode>,
  );
  width(500);
  const frame = view.getByTitle("広告 — 忍者AdMax");
  view.rerender(
    <StrictMode>
      <AdMaxBanner size={size} />
    </StrictMode>,
  );
  expect(view.getByTitle("広告 — 忍者AdMax")).toBe(frame);
  expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
  expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
  view.unmount();
  expect(frame.isConnected).toBe(false);
  expect(disconnect).toHaveBeenCalled();
});
it("does not make other content depend on ad load success or retry failed ads", () => {
  const view = render(
    <>
      <button>Play</button>
      <AdMaxBanner size={size} />
    </>,
  );
  width(500);
  const frame = view.getByTitle("広告 — 忍者AdMax");
  act(() => frame.dispatchEvent(new Event("error")));
  expect(view.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(view.getByTitle("広告 — 忍者AdMax")).toBe(frame);
});
