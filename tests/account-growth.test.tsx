import { act } from "@testing-library/react";
import {
  __resetPlayResultQueueForTests,
  enqueuePlayResult,
  flushPlayResultQueue,
} from "@/lib/playResultQueue";
import { createPlayState } from "@/game/engine";
vi.mock("@/lib/playerRanking", () => ({
  recordCompletedPlay: vi.fn(async () => {}),
  PlayResultSaveError: class extends Error {},
}));
import { growthProgress } from "@/lib/accountGrowth";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AccountGrowthProvider,
  ProfileGrowth,
  HomeLevel,
  ResultXpCard,
  type AccountGrowthState,
  type GrowthSnapshot,
  type XpOutcome,
} from "@/components/app/AccountGrowth";
const growth: GrowthSnapshot = {
  level: "1",
  nextLevel: "2",
  totalXp: "140",
  xpInLevel: "140",
  xpToNextLevel: "500",
  levelPublic: true,
};
const data: AccountGrowthState = {
  enabled: true,
  ownerId: "me",
  growth,
  rules: [
    "サーバーで確定した対象条件",
    "初クリア・デイリーボーナス",
    "繰り返し倍率と日次上限はサーバーの規則に従います",
  ],
  rewards: {},
};
function show(value: AccountGrowthState | null = data, reward?: XpOutcome, own = true) {
  return render(
    <AccountGrowthProvider
      value={reward && value ? { ...value, rewards: { play: reward } } : value}
    >
      <ProfileGrowth userId="me" own={own} />
      <HomeLevel userId="me" />
      <ResultXpCard userId="me" playId="play" />
    </AccountGrowthProvider>,
  );
}
beforeEach(() => {
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
it("uses within-level XP rather than total XP and supplies accessible progress", () => {
  show({ ...data, growth: { ...growth, totalXp: "1140" } });
  expect(screen.getByText("140 / 500 XP")).toBeTruthy();
  expect(screen.getByText("次のLevelまで360 XP")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("28");
  expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("140 / 500 XP");
  fireEvent.click(screen.getByLabelText("LevelとXPの説明"));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText(/Levelはアカウントの成長を表し/)).toBeTruthy();
  expect(screen.getByText(/累計 1,140 XP/)).toBeTruthy();
  expect(screen.getByText(/UTC/)).toBeTruthy();
});
it("keeps profile/home/result consistent at exact and multiple level thresholds", () => {
  for (const g of [
    { ...growth, xpInLevel: "499" },
    { ...growth, level: "2", nextLevel: "3", totalXp: "500", xpInLevel: "0" },
    { ...growth, level: "4", nextLevel: "5", totalXp: "1507", xpInLevel: "7" },
  ]) {
    const view = show(
      { ...data, growth: g },
      {
        status: "awarded",
        previousLevel: "1",
        earnedXp: "190",
        growth: g,
        breakdown: [
          { label: "プレイ", xp: "90" },
          { label: "初クリア", xp: "50" },
          { label: "デイリーボーナス", xp: "50" },
        ],
      },
    );
    expect(screen.getAllByText(`Lv. ${g.level}`)).toHaveLength(3);
    expect(
      screen.getAllByRole("progressbar").map((bar) => bar.getAttribute("aria-valuetext")),
    ).toEqual([`${g.xpInLevel} / 500 XP`, `${g.xpInLevel} / 500 XP`]);
    if (g.level === "4") expect(screen.getByText("Lv. 1 → Lv. 4")).toBeTruthy();
    view.unmount();
  }
});
it("hides absent/disabled features, other accounts and public-only hidden levels", () => {
  const disabled = show({ ...data, enabled: false });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(/XP/)).toBeNull();
  disabled.unmount();
  const hidden = render(
    <AccountGrowthProvider value={{ ...data, growth: { ...growth, levelPublic: false } }}>
      <ProfileGrowth userId="me" own={false} />
    </AccountGrowthProvider>,
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  hidden.unmount();
  show({ ...data, growth: { ...growth, levelPublic: false } });
  expect(screen.getByRole("progressbar")).toBeTruthy(); // Owner retains growth access.
});
it.each([
  [{ status: "checking" }, "獲得XPを確認中…"],
  [{ status: "pending" }, "XPの反映待ちです"],
  [{ status: "error", message: "通信失敗", retrying: true }, "XPを再確認"],
  [{ status: "ineligible", reason: "日次上限に到達しました（UTC）" }, "このプレイはXP対象外です"],
] as const)(
  "distinguishes the %s XP state without claiming that score was saved",
  (reward, text) => {
    show(data, reward);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText("+0 XP")).toBeNull();
    expect(screen.queryByText(/保存済み/)).toBeNull();
  },
);
it("does not show failed growth as 0 XP or render boost when disabled", () => {
  const failed = show({ ...data, growth: null, error: "offline" });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  failed.unmount();
  const view = show(data, {
    status: "awarded",
    previousLevel: "1",
    earnedXp: "190",
    growth,
    breakdown: [
      { label: "プレイ", xp: "90" },
      { label: "Boost", xp: "100", boost: true },
    ],
  });
  expect(screen.queryByText(/Boost/)).toBeNull();
  view.rerender(
    <AccountGrowthProvider value={data}>
      <ResultXpCard userId="other" playId="play" />
    </AccountGrowthProvider>,
  );
  expect(screen.queryByLabelText("XP獲得")).toBeNull();
});
it("formats very large XP exactly and computes progress without Number precision loss", () => {
  const large = {
    ...growth,
    totalXp: "900719925474099300",
    xpInLevel: "9007199254740993",
    xpToNextLevel: "9007199254740994",
  };
  expect(growthProgress(large).remaining).toBe(1n);
  show({ ...data, growth: large });
  expect(screen.getByText("9,007,199,254,740,993 / 9,007,199,254,740,994 XP")).toBeTruthy();
  expect(screen.getByText("次のLevelまで1 XP")).toBeTruthy();
});

it("refreshes confirmed growth only once for repeated acknowledgements and rerenders", async () => {
  __resetPlayResultQueueForTests();
  const refresh = vi.fn();
  const view = show({ ...data, refresh });
  const result = { id: "play-once", songId: "chart", play: createPlayState() };
  await act(async () => {
    enqueuePlayResult("me", result);
    await flushPlayResultQueue("me");
  });
  view.rerender(
    <AccountGrowthProvider value={{ ...data, refresh }}>
      <ProfileGrowth userId="me" />
    </AccountGrowthProvider>,
  );
  await act(async () => {
    enqueuePlayResult("me", { ...result });
    await flushPlayResultQueue("me");
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith("play-once");
});
