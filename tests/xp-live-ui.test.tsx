import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  AccountGrowthProvider,
  AccountVisibilitySettings,
  ProfileGrowth,
  HomeLevel,
  ResultXpCard,
} from "@/components/app/AccountGrowth";
import { useAccountGrowth } from "@/lib/useAccountGrowth";
const api = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  xpListeners: new Set<(e: unknown) => void>(),
}));
vi.mock("@/lib/xpClient", () => ({
  XP_CLIENT_ENABLED: true,
  loadAccountGrowth: api.load,
  saveAccountVisibility: api.save,
}));
vi.mock("@/lib/xpQueue", () => ({
  subscribeXp: (fn: (e: unknown) => void) => {
    api.xpListeners.add(fn);
    return () => api.xpListeners.delete(fn);
  },
  flushXp: vi.fn(async () => {}),
  nextXpRetry: () => null,
  pendingXpCount: () => 0,
  rejectPendingXp: vi.fn(),
}));
vi.mock("@/lib/playResultQueue", () => ({ subscribeToPlayResultQueue: () => () => {} }));
const data = {
  enabled: true,
  growth: {
    level: "1",
    nextLevel: "2",
    totalXp: "140",
    xpInLevel: "140",
    xpToNextLevel: "500",
    levelPublic: true,
  },
  visibility: { levelPublic: true, xpPublic: false, supporterPublic: true },
  supporter: null,
  boostEnabled: false,
  rules: ["500 XP per Level; UTC"],
};
function Live({ owner = "a" }: { owner?: string }) {
  const value = useAccountGrowth(owner);
  return (
    <AccountGrowthProvider value={value}>
      <ProfileGrowth userId={owner} />
      <HomeLevel userId={owner} />
      <ResultXpCard userId={owner} playId="play" />
      <AccountVisibilitySettings userId={owner} />
    </AccountGrowthProvider>
  );
}
beforeEach(() => {
  api.load.mockReset().mockResolvedValue(data);
  api.save.mockReset().mockImplementation(async (_owner, value) => value);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("loads production provider values, saves/restores privacy without hiding owner growth", async () => {
  const first = render(<Live />);
  await screen.findByText("140 / 500 XP");
  fireEvent.click(screen.getByLabelText("Levelを公開"));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith("a", {
      levelPublic: false,
      xpPublic: false,
      supporterPublic: true,
    }),
  );
  expect(screen.getByText("140 / 500 XP")).toBeTruthy();
  first.unmount();
  api.load.mockResolvedValue({
    ...data,
    visibility: { ...data.visibility, levelPublic: false },
    growth: { ...data.growth, levelPublic: false },
  });
  render(<Live />);
  await screen.findByText("140 / 500 XP");
  expect((screen.getByLabelText("Levelを公開") as HTMLInputElement).checked).toBe(false);
});
it("a later confirmed result refreshes home/profile and RESULT from the same account data", async () => {
  render(<Live />);
  await screen.findByText("140 / 500 XP");
  const growth = { ...data.growth, level: "2", nextLevel: "3", totalXp: "530", xpInLevel: "30" };
  api.load.mockResolvedValue({ ...data, growth });
  act(() =>
    api.xpListeners.forEach((fn) =>
      fn({
        owner: "a",
        playId: "play",
        outcome: {
          status: "awarded",
          earnedXp: "390",
          previousLevel: "1",
          growth,
          breakdown: [{ label: "プレイ", xp: "390" }],
        },
      }),
    ),
  );
  await waitFor(() => expect(screen.getAllByText("Lv. 2")).toHaveLength(3));
  expect(screen.getAllByText("30 / 500 XP")).toHaveLength(2);
  expect(screen.getByText("+390 XP")).toBeTruthy();
});
it("failed reads stay errors instead of fabricated 0XP; server publication OFF has no XP cards", async () => {
  api.load.mockRejectedValueOnce(new Error("offline"));
  const first = render(<Live />);
  await screen.findByText("成長情報を読み込めませんでした。");
  expect(screen.queryByText("0 / 500 XP")).toBeNull();
  first.unmount();
  api.load.mockResolvedValue({ ...data, enabled: false });
  render(<Live />);
  await screen.findByLabelText("Levelを公開");
  expect(screen.queryByLabelText("LevelとXP", { exact: true })).toBeNull();
  expect(screen.queryByLabelText("XP獲得", { exact: true })).toBeNull();
});
it("stale account responses and another account's reward cannot leak across switching", async () => {
  let finish!: (value: typeof data) => void;
  api.load.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const hook = renderHook(({ owner }) => useAccountGrowth(owner), { initialProps: { owner: "a" } });
  hook.rerender({ owner: "b" });
  await waitFor(() => expect(hook.result.current?.growth?.totalXp).toBe("140"));
  await act(async () => {
    finish({ ...data, growth: { ...data.growth, totalXp: "999" } });
  });
  expect(hook.result.current?.ownerId).toBe("b");
  expect(hook.result.current?.growth?.totalXp).toBe("140");
  act(() =>
    api.xpListeners.forEach((fn) =>
      fn({ owner: "a", playId: "private", outcome: { status: "pending" } }),
    ),
  );
  expect(hook.result.current?.rewards["private"]).toBeUndefined();
});
