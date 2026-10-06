import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RankingScreen, PlayerStats } from "@/components/app/RankingScreen";
import { fetchLeaderboard, fetchPlayerRanking } from "@/lib/playerRanking";
import type { PlayerRanking } from "@/integrations/supabase/types";
vi.mock("@/lib/playerRanking", () => ({
  fetchLeaderboard: vi.fn(),
  fetchPlayerRanking: vi.fn(),
  rankingKeys: { leaderboard: ["rank", "top"], player: (id: string) => ["rank", id] },
}));
const first: PlayerRanking = {
  user_id: "first",
  display_name: "First",
  username: "first",
  avatar_url: null,
  total_score: 1234567890,
  play_count: 352,
  global_rank: 1,
};
const mine: PlayerRanking = {
  ...first,
  user_id: "me",
  display_name: "My Player",
  username: "me",
  total_score: 1002,
  play_count: 1,
  global_rank: 1284,
};
function show(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchLeaderboard).mockResolvedValue([first]);
  vi.mocked(fetchPlayerRanking).mockResolvedValue(mine);
});
afterEach(cleanup);
it("shows own rank outside Top 100 and public leaderboard", async () => {
  show(<RankingScreen userId="me" onBack={() => {}} />);
  await screen.findByText("#1,284");
  expect(screen.getByText("First")).toBeTruthy();
  expect(screen.getByText("@me")).toBeTruthy();
  expect(screen.getByText("1,234,567,890")).toBeTruthy();
  expect(screen.getByText("352 PLAYS")).toBeTruthy();
});
it("profile displays total score, rank and plays", async () => {
  vi.mocked(fetchPlayerRanking).mockResolvedValue({ ...first, global_rank: 1284 });
  show(<PlayerStats userId="first" />);
  await screen.findByText("1,234,567,890");
  expect(screen.getByText("#1,284")).toBeTruthy();
  expect(screen.getByText("352")).toBeTruthy();
});
it("guest sees Top 100 without fetching an own rank", async () => {
  show(<RankingScreen userId={null} onBack={() => {}} />);
  await screen.findByText("First");
  expect(fetchPlayerRanking).not.toHaveBeenCalled();
});
it("shows loading then an actionable error state", async () => {
  vi.mocked(fetchLeaderboard).mockRejectedValue(new Error("offline"));
  show(<RankingScreen userId={null} onBack={() => {}} />);
  expect(screen.getByRole("status")).toBeTruthy();
  await screen.findByRole("alert");
  vi.mocked(fetchLeaderboard).mockResolvedValue([first]);
  fireEvent.click(screen.getByText("再読み込み"));
  await screen.findByText("First");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
