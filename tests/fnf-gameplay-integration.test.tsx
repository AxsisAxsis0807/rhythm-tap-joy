import { useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/game/SettingsPanel";
import { GameScreen } from "@/components/game/GameScreen";
import { RhythmHub } from "@/components/app/RhythmHub";
import type { SongRow } from "@/lib/chartRepository";
import type { User } from "@supabase/supabase-js";
import { SongDetail } from "@/components/app/SongDetail";
import { useGameSettings, DEFAULT_SETTINGS } from "@/game/settings";
import { getAudioSession } from "@/game/audioSession";
import { parseChartByType } from "@/game/chartFile";
import { GameplayCore } from "@/game/gameplayCore";
import { ReplayRecorder, type GameplayEvent } from "@/game/replay";
import type { Chart, PlayStyleId } from "@/game/types";

// Only persistence endpoints are replaced. AudioClock, inputTime, input ledger,
// TouchInput, selector, GameScreen, hook, recorder and judgement core are real.
vi.mock("@/lib/xp.functions", () => ({
  beginPlay: vi.fn(),
  finishPlay: vi.fn(),
  getXpReceipt: vi.fn(),
}));
vi.mock("@/lib/usePlayResult", () => ({
  usePlayResult: () => ({ state: null, retrySave: vi.fn() }),
  usePendingPlayResults: () => ({ pending: 0 }),
}));
const fixtures = vi.hoisted(() => ({
  user: null as User | null,
  song: null as SongRow | null,
  chart: null as Chart | null,
}));
vi.mock("@/lib/useAuth", () => ({ useAuth: () => ({ user: fixtures.user, loading: false }) }));
vi.mock("@/lib/admin.functions", () => ({ redeemAdminCode: vi.fn() }));
vi.mock("@/components/app/SongMetadataEditor", () => ({ SongMetadataEditor: () => null }));
vi.mock("@/components/app/RankingScreen", () => ({
  PlayerStats: () => null,
  RankingScreen: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const result = {
        data:
          table === "songs"
            ? [fixtures.song]
            : {
                id: "owner",
                username: "tester",
                display_name: "Test Player",
                bio: "",
                avatar_url: null,
              },
        error: null,
      };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      };
      return query;
    },
  },
}));
vi.mock("@/lib/chartRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chartRepository")>()),
  getSongPreview: async () => null,
  listPublicSongs: async () => (fixtures.song ? [fixtures.song] : []),
  loadPlayableChart: async () => fixtures.chart,
}));
let now = 10000;
let audioStart = 0;
let sequence = 0;
const frames = new Map<number, FrameRequestCallback>();
class PlatformAudioContext {
  state = "running";
  destination = {};
  get currentTime() {
    return 100 + now / 1000;
  }
  resume = async () => {};
  close = async () => {
    this.state = "closed";
  };
  decodeAudioData = async () => ({ duration: 4 });
  createGain = () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} });
  createBufferSource = () => ({
    buffer: null,
    playbackRate: { value: 1 },
    connect: () => {},
    disconnect: () => {},
    stop: () => {},
    start: (at: number) => {
      audioStart = at;
    },
    onended: null,
  });
}
let settings: ReturnType<typeof useGameSettings>;
function Workflow({ chart, recommended = "mania" }: { chart: Chart; recommended?: PlayStyleId }) {
  settings = useGameSettings();
  const [explicit, setExplicit] = useState<PlayStyleId>();
  const [running, setRunning] = useState<PlayStyleId>();
  if (running) return <GameScreen chart={chart} modeId={running} playStyle={running} autoStart />;
  return (
    <SongDetail
      song={{
        id: chart.id,
        title: chart.title,
        artist: chart.artist,
        chart,
        recommendedPlayStyle: recommended,
      }}
      explicitStyle={explicit}
      onStyleChange={setExplicit}
      onStart={async (style) => {
        setRunning(style);
      }}
    />
  );
}
const makeChart = (format: "4k" | "fnf", kind: "tap" | "hold" = "tap"): Chart => {
  const notes = [0, 1, 2, 3].map((lane) => ({
    beat: 1,
    lane,
    kind,
    ...(kind === "hold" ? { lengthBeats: 1 } : {}),
  }));
  const imported =
    format === "fnf" && kind === "tap"
      ? parseChartByType(
          JSON.stringify({
            song: {
              bpm: 60,
              notes: [
                { mustHitSection: true, sectionNotes: [0, 1, 2, 3].map((lane) => [1000, lane, 0]) },
                { mustHitSection: false, sectionNotes: [[500, 0, 0]] },
              ],
            },
          }),
          "fnf",
          "right",
        )
      : null;
  return {
    id: "fixture",
    title: "Fixture",
    artist: "Test",
    audioUrl: "/fixture.wav",
    bpm: 60,
    offset: 0,
    laneCount: 4,
    difficultyName: "Test",
    notes: imported?.notes ?? notes,
    ...(format === "fnf"
      ? {
          fnf: imported?.fnf ?? {
            playerSide: "right" as const,
            left: [{ beat: 0.5, lane: 0, kind: "tap" as const }],
            right: notes,
          },
        }
      : {}),
  };
};
let core: GameplayCore;
function captureCore(value: GameplayCore) {
  core = value;
}
let recorded: GameplayEvent[];
const runs = new Map<string, ReplayRecorder["configuration"]>();
beforeEach(() => {
  now = 10000;
  audioStart = 0;
  frames.clear();
  recorded = [];
  runs.clear();
  fixtures.user = null;
  fixtures.song = null;
  fixtures.chart = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("AudioContext", PlatformAudioContext);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })),
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++sequence, cb);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const original = GameplayCore.prototype.process;
  vi.spyOn(GameplayCore.prototype, "process").mockImplementation(function (
    this: GameplayCore,
    event,
  ) {
    captureCore(this);
    return original.call(this, event);
  });
  const append = ReplayRecorder.prototype.append;
  vi.spyOn(ReplayRecorder.prototype, "append").mockImplementation(function (
    this: ReplayRecorder,
    event,
  ) {
    const e = append.call(this, event);
    recorded.push(e);
    runs.set(this.runId, this.configuration);
    return e;
  });
});
afterEach(async () => {
  cleanup();
  await getAudioSession().dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function at(songTime: number) {
  now = (audioStart + songTime - 100) * 1000;
}
function paint() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(now));
  });
}
async function start(
  format: "4k" | "fnf",
  style: PlayStyleId = "fnf",
  kind: "tap" | "hold" = "tap",
) {
  const view = render(<Workflow chart={makeChart(format, kind)} />);
  act(() =>
    settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false, lastPlayedStyle: "mania" }),
  );
  // Exercise both switches, rather than passing policy directly to the core.
  fireEvent.click(view.getByRole("radio", { name: style === "fnf" ? "OSU!MANIA" : "FNF" }));
  fireEvent.click(view.getByRole("radio", { name: style === "fnf" ? "FNF" : "OSU!MANIA" }));
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "START" }));
  });
  expect(audioStart).toBeGreaterThan(0);
  paint();
  expect(core.configuration).toMatchObject({
    playStyle: style,
    judgementPolicyId: style === "fnf" ? "pulse-fnf-v1" : "pulse-mania-v1",
  });
  expect([...runs.values()].at(-1)).toBe(core.configuration);
  expect(core.configuration.scoringSide).toBe(format === "fnf" ? "right" : "shared");
  return view;
}
function edge(
  view: ReturnType<typeof render>,
  input: "keyboard" | "touch",
  type: "down" | "up" | "cancel",
  lane = 0,
  delayMs = 0,
  epoch = false,
) {
  const stamp = now - delayMs + (epoch ? performance.timeOrigin : 0);
  if (input === "keyboard") {
    const event = new KeyboardEvent(type === "down" ? "keydown" : "keyup", {
      code: ["KeyD", "KeyF", "KeyJ", "KeyK"][lane]!,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "timeStamp", { value: stamp });
    fireEvent(window, event);
  } else {
    const surface = view.getByTestId("touch-input");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 400,
      right: 400,
      top: 0,
      bottom: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const event = new MouseEvent(
      type === "down" ? "pointerdown" : type === "up" ? "pointerup" : "pointercancel",
      { bubbles: true, cancelable: true, clientX: lane * 100 + 50 },
    );
    Object.defineProperties(event, {
      timeStamp: { value: stamp },
      pointerId: { value: lane + 1 },
      pointerType: { value: "touch" },
    });
    fireEvent(surface, event);
  }
}
for (const format of ["4k", "fnf"] as const)
  for (const input of ["keyboard", "touch"] as const) {
    describe(`${format} / ${input} real GameScreen input`, () => {
      it.each([-500, -250, -201, -199, -150, -141, -140, -139, 0, 140, 141, 199])(
        "delta %ims",
        async (delta) => {
          const view = await start(format);
          at(1 + delta / 1000);
          for (let lane = 0; lane < 4; lane++) edge(view, input, "down", lane);
          paint();
          const expected =
            delta < -140 ? null : delta > 140 ? "MISS" : Math.abs(delta) > 90 ? "GOOD" : "PERFECT";
          expect(core.notes.every((n) => n.judged === (expected !== null))).toBe(true);
          expect(core.notes[0]?.judgement ?? null).toBe(expected);
          expect(core.play.counts.MISS).toBe(expected === "MISS" ? 4 : 0);
          expect(view.getByText(`MISS ${expected === "MISS" ? 4 : 0}`)).toBeTruthy();
          expect(recorded.find((e) => e.type === "press")?.songTime).toBeCloseTo(
            1 + delta / 1000,
            8,
          );
          if (expected === null) {
            expect(core.play.score).toBe(0);
            expect(core.play.combo).toBe(0);
            expect(view.getByText("ACC 100.00%")).toBeTruthy();
          }
        },
      );
      it("early press/release then on-time press hits all four lanes", async () => {
        const view = await start(format);
        at(0.85);
        for (let lane = 0; lane < 4; lane++) edge(view, input, "down", lane);
        paint();
        expect(core.play.counts.MISS).toBe(0);
        expect(core.notes.every((n) => !n.judged && !n.holding)).toBe(true);
        at(0.9);
        for (let lane = 0; lane < 4; lane++) edge(view, input, "up", lane);
        at(1);
        for (let lane = 0; lane < 4; lane++) edge(view, input, "down", lane);
        paint();
        expect(core.play.counts.PERFECT).toBe(4);
        expect(core.play.counts.MISS).toBe(0);
      });
      it("no input at +201ms produces one overdue MISS per note", async () => {
        const view = await start(format);
        at(1.201);
        paint();
        expect(core.play.counts.MISS).toBe(4);
        at(1.3);
        paint();
        expect(core.play.counts.MISS).toBe(4);
        expect(view.getByText("MISS 4")).toBeTruthy();
      });
      it("ignored early press preserves an existing score, combo, accuracy and note", async () => {
        const chart = makeChart(format);
        chart.notes = [
          { beat: 1, lane: 0, kind: "tap" },
          { beat: 3, lane: 0, kind: "hold", lengthBeats: 1 },
        ];
        if (chart.fnf) chart.fnf.right = chart.notes;
        const view = render(<Workflow chart={chart} />);
        act(() => settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false }));
        fireEvent.click(view.getByRole("radio", { name: "FNF" }));
        await act(async () => {
          fireEvent.click(view.getByRole("button", { name: "START" }));
        });
        paint();
        at(1);
        edge(view, input, "down");
        at(1.01);
        edge(view, input, "up");
        paint();
        const before = core.snapshotPlay();
        at(2.85);
        edge(view, input, "down");
        paint();
        expect(core.snapshotPlay()).toEqual(before);
        expect(core.notes[1]?.judged).toBe(false);
        expect(core.notes[1]?.holding).toBeUndefined();
        expect(view.getByText("ACC 100.00%")).toBeTruthy();
      });
      it("early held input cannot auto-hit or start a hold; overdue miss occurs once", async () => {
        const view = await start(format, "fnf", "hold");
        at(0.85);
        edge(view, input, "down");
        paint();
        at(1);
        paint();
        expect(core.notes[0]?.judged).toBe(false);
        expect(core.notes[0]?.holding).toBeUndefined();
        at(1.201);
        paint();
        expect(core.play.counts).toEqual({ PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 4 });
        edge(view, input, "cancel");
        at(1.3);
        paint();
        expect(core.play.counts.MISS).toBe(4);
      });
      it("late-dispatched edge uses DOM timestamp, including epoch stamps", async () => {
        const view = await start(format);
        at(1.15);
        edge(view, input, "down", 0, 300, true);
        paint();
        expect(recorded.find((e) => e.type === "press")?.songTime).toBeCloseTo(0.85, 5);
        expect(core.play.counts.MISS).toBe(0);
        expect(core.notes[0]?.judged).toBe(false);
      });
      it("RETRY retains FNF policy and allocates a new core and run", async () => {
        const view = await start(format);
        const oldCore = core;
        const oldRun = [...runs.keys()].at(-1);
        at(4.1);
        paint();
        await act(async () => {
          fireEvent.click(view.getByRole("button", { name: "RETRY" }));
        });
        paint();
        expect([...runs.keys()].at(-1)).not.toBe(oldRun);
        expect(core).not.toBe(oldCore);
        expect(core.configuration.judgementPolicyId).toBe("pulse-fnf-v1");
        at(0.85);
        edge(view, input, "down");
        paint();
        expect(core.play.counts.MISS).toBe(0);
      });
      it("FNF → MANIA → START retains mania's early MISS", async () => {
        const view = await start(format, "mania");
        at(0.85);
        edge(view, input, "down");
        paint();
        expect(core.play.counts.MISS).toBe(1);
        expect(view.getByText("MISS 1")).toBeTruthy();
      });
    });
  }

function HubSettings() {
  settings = useGameSettings();
  return null;
}
for (const input of ["keyboard", "touch"] as const)
  for (const format of ["4k", "fnf"] as const)
    for (const entrance of ["select", "home", "my-tracks"] as const) {
      it(`${entrance} → real RhythmHub → START: ${format}/${input}`, async () => {
        const chart = makeChart(format);
        fixtures.chart = chart;
        fixtures.song = {
          id: chart.id,
          user_id: "owner",
          title: chart.title,
          artist: chart.artist,
          chart_author: "",
          difficulty_name: "Test",
          description: "",
          recommended_play_style: "mania",
          mode_id: "mania",
          current_revision_id: null,
          metadata_version: 0,
          preview_start_ms: null,
          chart_type: format === "fnf" ? "fnf" : "mania",
          audio_path: "owner/audio",
          chart_path: "owner/chart",
          fnf_side: "right",
          bpm: 60,
          note_count: 4,
          is_published: true,
        } as SongRow;
        if (entrance === "my-tracks")
          fixtures.user = { id: "owner", email: "test@example.invalid", user_metadata: {} } as User;
        const rootRoute = createRootRoute();
        const indexRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: "/",
          validateSearch: () => ({}) as { songSettings?: string },
          component: () => (
            <>
              <HubSettings />
              <RhythmHub localSongs={[]} />
            </>
          ),
        });
        const router = createRouter({
          routeTree: rootRoute.addChildren([indexRoute]),
          history: createMemoryHistory({ initialEntries: ["/"] }),
        });
        await router.load();
        const view = render(
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <RouterProvider router={router} />
          </QueryClientProvider>,
        );
        await act(async () => {});
        act(() =>
          settings.setSettings({
            ...DEFAULT_SETTINGS,
            hitSoundEnabled: false,
            lastPlayedStyle: "mania",
          }),
        );
        if (entrance === "select")
          fireEvent.click(view.getByRole("button", { name: "曲を探して遊ぶ" }));
        else if (entrance === "home")
          fireEvent.click(view.getByRole("button", { name: /Fixture/ }));
        else {
          fireEvent.click(view.getByRole("button", { name: "Test Player" }));
          fireEvent.click(view.getByRole("button", { name: /Fixture.*下書き|Fixture.*公開中/ }));
          fireEvent.click(view.getByRole("button", { name: "プレイ" }));
        }
        fireEvent.click(view.getByRole("radio", { name: "FNF" }));
        await act(async () => {
          fireEvent.click(view.getByRole("button", { name: "START" }));
        });
        paint();
        expect(core.configuration).toMatchObject({
          playStyle: "fnf",
          judgementPolicyId: "pulse-fnf-v1",
        });
        at(0.85);
        edge(view, input, "down");
        paint();
        expect(view.getByText("MISS 0")).toBeTruthy();
        at(0.9);
        edge(view, input, "up");
        at(1);
        edge(view, input, "down");
        paint();
        expect(core.play.counts.PERFECT).toBe(1);
      });
    }
for (const input of ["keyboard", "touch"] as const) {
  it(`diagnoses positive timing calibration without misclassifying it as an early-policy failure: ${input}`, async () => {
    const view = render(<Workflow chart={makeChart("fnf")} />);
    act(() =>
      settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false, timingOffsetMs: 300 }),
    );
    fireEvent.click(view.getByRole("radio", { name: "FNF" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "START" }));
    });
    paint();
    at(0.85);
    edge(view, input, "down");
    paint();
    expect(core.configuration.timingOffsetMs).toBe(300);
    expect(recorded.find((e) => e.type === "press")?.songTime).toBeCloseTo(0.85, 8);
    expect(core.play.lastJudgement).toMatchObject({ judgement: "MISS" });
    expect(core.play.lastJudgement?.deltaMs).toBeCloseTo(150, 8);
  });
  it(`advance before an old queued edge is an overdue miss, not an early-press miss: ${input}`, async () => {
    const view = await start("fnf");
    at(1.201);
    paint();
    const before = core.play.counts.MISS;
    edge(view, input, "down", 0, 351);
    paint();
    expect(core.play.counts.MISS).toBe(before);
    expect(recorded.find((e) => e.type === "press")?.songTime).toBeCloseTo(0.85, 8);
  });
}

function CalibratedWorkflow({ chart }: { chart: Chart }) {
  const current = useGameSettings();
  const [open, setOpen] = useState(true);
  return (
    <>
      <SettingsPanel
        open={open}
        settings={current.settings}
        onChange={current.setSettings}
        onClose={() => setOpen(false)}
      />
      <Workflow chart={chart} />
    </>
  );
}
for (const input of ["keyboard", "touch"] as const) {
  it(`calibration adopted through settings cannot turn an early press into late MISS: ${input}`, async () => {
    const view = render(<CalibratedWorkflow chart={makeChart("fnf")} />);
    act(() => settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false }));
    fireEvent.click(view.getByRole("button", { name: "音声・タイミング" }));
    const calibrationStart = now;
    fireEvent.click(view.getByRole("button", { name: "開始" }));
    for (let i = 1; i <= 8; i++) {
      now = calibrationStart + i * 500 + 200;
      fireEvent.click(view.getByRole("button", { name: /点滅に合わせてタップ/ }));
    }
    fireEvent.click(view.getByRole("button", { name: "採用" }));
    fireEvent.click(view.getByRole("button", { name: "設定を閉じる" }));
    fireEvent.click(view.getByRole("radio", { name: "FNF" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "START" }));
    });
    paint();
    at(0.95);
    edge(view, input, "down");
    paint();
    expect(core.play.counts.MISS).toBe(0);
    expect(core.notes[0]?.judged).toBe(false);
    expect(core.configuration.timingOffsetMs).toBe(-200);
    at(0.96);
    edge(view, input, "up");
    at(1.2);
    edge(view, input, "down");
    paint();
    expect(core.play.counts.PERFECT).toBe(1);
  });
}

it.each([
  ["fnf", "mania", "MISS"],
  ["classic", "fnf", "outside-window"],
  ["classic", "mania", "MISS"],
] as const)("visual mode %s cannot override play style %s", async (mode, style, expected) => {
  const view = render(
    <>
      <HubSettings />
      <GameScreen chart={makeChart("4k")} modeId={mode} playStyle={style} autoStart />
    </>,
  );
  act(() => settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false }));
  await act(async () => {});
  paint();
  expect(core.configuration.playStyle).toBe(style);
  expect(core.configuration.visualMode).toBe(mode);
  at(0.85);
  edge(view, "keyboard", "down");
  paint();
  expect(core.play.counts.MISS).toBe(expected === "MISS" ? 1 : 0);
});

it.each(["KeyD", "ArrowLeft"])(
  "main and alternate binding %s both reach the judgement engine",
  async (code) => {
    const view = render(
      <GameScreen chart={makeChart("4k")} modeId="classic" playStyle="mania" autoStart />,
    );
    act(() => settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false }));
    await act(async () => {});
    paint();
    at(1);
    const event = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
    Object.defineProperty(event, "timeStamp", { value: now });
    fireEvent(window, event);
    paint();
    expect(core.play.counts.PERFECT).toBe(1);
    view.unmount();
  },
);

it.each([-200, 0, 200])(
  "calibration %ims is stored with the inverse sign and used by START",
  async (residual) => {
    const view = render(<CalibratedWorkflow chart={makeChart("4k")} />);
    act(() => settings.setSettings({ ...DEFAULT_SETTINGS, hitSoundEnabled: false }));
    fireEvent.click(view.getByRole("button", { name: "音声・タイミング" }));
    const began = now;
    fireEvent.click(view.getByRole("button", { name: "開始" }));
    for (let i = 1; i <= 8; i++) {
      now = began + i * 500 + residual;
      fireEvent.click(view.getByRole("button", { name: /点滅に合わせてタップ/ }));
    }
    fireEvent.click(view.getByRole("button", { name: "採用" }));
    fireEvent.click(view.getByRole("button", { name: "設定を閉じる" }));
    fireEvent.click(view.getByRole("radio", { name: "FNF" }));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "START" }));
    });
    paint();
    expect(core.configuration.timingOffsetMs).toBeCloseTo(-residual);
    expect(
      JSON.parse(localStorage.getItem("pulse-lane:device-settings:v2")!).timingOffsetMs,
    ).toBeCloseTo(-residual);
    at(1 + residual / 1000);
    edge(view, "keyboard", "down");
    paint();
    expect(core.play.counts.PERFECT).toBe(1);
  },
);
