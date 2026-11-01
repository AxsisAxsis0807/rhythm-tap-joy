import { StrictMode, type ComponentType } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let Banner: ComponentType<{ enabled?: boolean }>;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const id = "cb996f4b2cbc2c0b8adc2c12ad721c8f";
const sdkUrl = "https://adm.shinobi.jp/st/t.js";
const request = { admax_id: id, type: "banner" };
const scripts = () => document.querySelectorAll(`script[src="${sdkUrl}"]`);
const slot = () => document.querySelector(".admax-ads");
let push: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  ({ AdMaxBanner: Banner } = await import("@/components/app/AdMaxBanner"));
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
  push = vi.fn(() => {
    const node = slot();
    expect(node?.isConnected).toBe(true);
    const frame = document.createElement("iframe");
    frame.dataset.mockAd = "true";
    node!.appendChild(frame);
  });
});
afterEach(() => {
  cleanup();
  scripts().forEach((script) => script.remove());
  delete window.admaxads;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function width(value = 320) {
  await act(async () => {
    resize([{ contentRect: { width: value } } as ResizeObserverEntry], {} as ResizeObserver);
  });
}
async function loaded(fail = false) {
  await act(async () => {
    // Models only the public queue contract. Not proof of real t.js compatibility.
    if (!fail) window.admaxads = { push };
    scripts()[0].dispatchEvent(new Event(fail ? "error" : "load"));
  });
}

it("SSR emits no SDK or ad DOM and does not require browser globals", () => {
  expect(renderToString(<Banner />)).not.toContain("admax-ads");
  expect(scripts()).toHaveLength(0);
});
it("initial home creates the supplied DOM before SDK load and registers the exact banner once", async () => {
  render(<Banner />);
  await width();
  expect(slot()?.getAttribute("data-admax-id")).toBe(id);
  expect((slot() as HTMLElement).style.display).toBe("inline-block");
  expect(scripts()).toHaveLength(1);
  expect(scripts()[0].getAttribute("charset")).toBe("utf-8");
  expect(scripts()[0].getAttribute("type")).toBe("text/javascript");
  expect((scripts()[0] as HTMLScriptElement).async).toBe(true);
  expect(document.querySelector("iframe")).toBeNull();
  await loaded();
  expect(push).toHaveBeenCalledExactlyOnceWith(request);
  expect(document.querySelector("[data-admax-host]")?.getAttribute("style")).toContain(
    "width: 320px; height: 50px",
  );
});
it("StrictMode, rerenders, input edits and sufficient-width resizes do not duplicate registration", async () => {
  const ui = () => (
    <StrictMode>
      <input aria-label="profile" />
      <Banner />
    </StrictMode>
  );
  const view = render(ui());
  await width(390);
  await loaded();
  const node = slot();
  view.rerender(ui());
  await width(500);
  expect(slot()).toBe(node);
  expect(push).toHaveBeenCalledTimes(1);
  expect(scripts()).toHaveLength(1);
});
it("retains the vendor subtree across home/profile revisits and removes it on excluded screens", async () => {
  const view = render(<Banner key="home" />);
  await width();
  await loaded();
  const node = slot();
  const frame = node!.firstChild;
  view.rerender(<button>Select / detail / edit / play / result</button>);
  expect(slot()).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
  view.rerender(<Banner key="profile" />);
  await width();
  expect(slot()).toBe(node);
  expect(slot()!.firstChild).toBe(frame);
  view.rerender(<Banner key="home" />);
  await width();
  expect(slot()).toBe(node);
  expect(push).toHaveBeenCalledTimes(1);
  expect(scripts()).toHaveLength(1);
});
it("leaving during SDK load cannot resurrect an ad; returning initializes against current DOM", async () => {
  const view = render(<Banner />);
  await width();
  view.rerender(<button>Play</button>);
  await loaded();
  expect(push).not.toHaveBeenCalled();
  expect(slot()).toBeNull();
  view.rerender(<Banner />);
  await width();
  expect(push).toHaveBeenCalledExactlyOnceWith(request);
});
it("returning before SDK finishes submits only the active placement", async () => {
  const view = render(<Banner key="home" />);
  await width();
  view.rerender(<Banner key="profile" />);
  await width();
  await loaded();
  expect(push).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll(".admax-ads")).toHaveLength(1);
});
it("StrictMode cleanup before microtask starts neither SDK nor request", async () => {
  const { attachAdMax } = await import("@/lib/admax");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = attachAdMax(host);
  dispose();
  await act(async () => {});
  expect(scripts()).toHaveLength(0);
  host.remove();
});
it("an accidental simultaneous second placement cannot duplicate the same ID", async () => {
  const { attachAdMax } = await import("@/lib/admax");
  const a = document.createElement("div"),
    b = document.createElement("div");
  document.body.append(a, b);
  const releaseA = attachAdMax(a),
    releaseB = attachAdMax(b);
  await act(async () => {});
  await loaded();
  expect(document.querySelectorAll(".admax-ads")).toHaveLength(1);
  releaseB();
  expect(a.firstChild).toBe(slot());
  releaseA();
  a.remove();
  b.remove();
});
it("width below 320 never loads; shrinking removes DOM and suppresses pending registration", async () => {
  render(<Banner />);
  await width(319);
  expect(scripts()).toHaveLength(0);
  expect(slot()).toBeNull();
  await width(320);
  await width(319);
  await loaded();
  expect(push).not.toHaveBeenCalled();
  expect(slot()).toBeNull();
  await width(320);
  expect(push).toHaveBeenCalledTimes(1);
});
it("SDK failure leaves controls usable and never retries across navigation", async () => {
  const click = vi.fn();
  const ui = (key: string) => (
    <>
      <button onClick={click}>Play</button>
      <Banner key={key} />
    </>
  );
  const view = render(ui("home"));
  await width();
  await loaded(true);
  view.getByRole("button").click();
  expect(click).toHaveBeenCalledOnce();
  view.rerender(ui("profile"));
  await width();
  expect(scripts()).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
});
it("third-party push errors do not propagate or retry", async () => {
  push.mockImplementation(() => {
    throw new Error("blocked");
  });
  const view = render(<Banner />);
  await width();
  await loaded();
  view.rerender(<Banner key="return" />);
  await width();
  expect(push).toHaveBeenCalledTimes(1);
});
it("disabled or ResizeObserver-unsupported ads do not prevent app rendering", () => {
  const view = render(<Banner enabled={false} />);
  expect(view.container.innerHTML).toBe("");
  vi.stubGlobal("ResizeObserver", undefined);
  view.rerender(
    <>
      <button>Play</button>
      <Banner />
    </>,
  );
  expect(view.getByRole("button")).toBeTruthy();
  expect(scripts()).toHaveLength(0);
});
