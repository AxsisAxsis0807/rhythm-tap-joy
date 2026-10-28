import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdMaxBanner, ADMAX_DOCUMENT, ADMAX_BANNER_SIZE } from "@/components/app/AdMaxBanner";

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
const size = ADMAX_BANNER_SIZE;
function width(value: number) {
  act(() =>
    resize([{ contentRect: { width: value } } as ResizeObserverEntry], {} as ResizeObserver),
  );
}
it("supports disabling the slot without loading an ad", () => {
  const view = render(<AdMaxBanner size={null} />);
  expect(view.container.innerHTML).toBe("");
});
it("does not crop, scale or load a creative on a narrower screen", () => {
  const view = render(<AdMaxBanner size={size} />);
  width(319);
  expect(view.queryByTitle("広告 — 忍者AdMax")).toBeNull();
  width(320);
  const frame = view.getByTitle("広告 — 忍者AdMax");
  expect(frame.getAttribute("width")).toBe("320");
  expect(frame.getAttribute("height")).toBe("50");
  expect(frame.getAttribute("srcdoc")).toBe(ADMAX_DOCUMENT);
  expect(document.querySelectorAll('script[src*="adm.shinobi.jp"]')).toHaveLength(0);
  width(500);
  expect(view.getByTitle("広告 — 忍者AdMax")).toBe(frame);
  width(319);
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

it("uses the owner-confirmed 320x50 size by default and preserves the supplied script token", () => {
  const view = render(<AdMaxBanner />);
  width(320);
  expect(ADMAX_BANNER_SIZE).toEqual({ width: 320, height: 50 });
  const frame = view.getByTitle("広告 — 忍者AdMax");
  expect(frame.getAttribute("width")).toBe("320");
  expect(frame.getAttribute("height")).toBe("50");
  expect(ADMAX_DOCUMENT.match(/<script /g)).toHaveLength(1);
  expect(ADMAX_DOCUMENT).toContain("https://adm.shinobi.jp/s/cb996f4b2cbc2c0b8adc2c12ad721c8f");
});
it("omits ads when ResizeObserver is unavailable without preventing the rest of the page", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const view = render(
    <>
      <button>Play</button>
      <AdMaxBanner />
    </>,
  );
  expect(view.queryByTitle("広告 — 忍者AdMax")).toBeNull();
  expect(view.getByRole("button", { name: "Play" })).toBeTruthy();
});
