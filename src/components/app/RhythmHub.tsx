import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronRight,
  CircleUserRound,
  FileJson,
  ImagePlus,
  LogIn,
  LogOut,
  Music2,
  Plus,
  Send,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import type { Chart } from "@/game/types";
import { detectFnfSides, parseChartByType, type ChartType, type FnfSide } from "@/game/chartFile";
import { useServerFn } from "@tanstack/react-start";
import { redeemAdminCode } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import type { SongEntry } from "@/components/menu/MusicSelect";
import { GameScreen } from "@/components/game/GameScreen";

type HubScreen =
  | "home"
  | "auth"
  | "authForm"
  | "profile"
  | "upload"
  | "publish"
  | "select"
  | "play";
type AuthMode = "login" | "signup";

type SongRow = {
  id: string;
  title: string;
  artist: string;
  difficulty_name: string;
  bpm: number;
  offset_sec: number;
  lane_count: number;
  note_count: number;
  mode_id: string;
  audio_path: string | null;
  chart_path: string | null;
  cover_path: string | null;
  is_published: boolean;
  chart_type: string;
  fnf_side: string;
  is_official: boolean;
  play_count: number;
  user_id: string;
};

type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
};

const BUCKET = "songs";

function displayName(user: User | null, profile: Profile | null) {
  return (
    profile?.display_name ||
    profile?.username ||
    user?.user_metadata?.['display_name'] ||
    user?.email?.split("@")[0] ||
    "Player"
  );
}

function fileLabel(file: File | null) {
  return file ? file.name : "ファイルを選択";
}

function toChart(row: SongRow, chart: ReturnType<typeof parseChartByType>, audioUrl: string): Chart {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    audioUrl,
    bpm: chart.bpm || Number(row.bpm) || 60,
    offset: chart.offset || Number(row.offset_sec) || 0,
    laneCount: chart.laneCount || row.lane_count || 4,
    difficultyName: row.difficulty_name || chart.difficultyName || "NORMAL",
    notes: chart.notes,
  };
}

export function RhythmHub({
  localSongs,
  modeId,
  onModeChange,
}: {
  localSongs: SongEntry[];
  modeId: string;
  onModeChange: (id: string) => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [screen, setScreen] = useState<HubScreen>("home");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [publishedSongs, setPublishedSongs] = useState<SongEntry[]>([]);
  const [mySongs, setMySongs] = useState<SongRow[]>([]);
  const [selectedSong, setSelectedSong] = useState<SongEntry | null>(null);
  const [notice, setNotice] = useState("");
  const [loadingSongs, setLoadingSongs] = useState(false);

  const loadPublicSongs = async () => {
    setLoadingSongs(true);
    const { data, error } = await supabase
      .from("songs")
      .select("*")
      .eq("is_published", true)
      .order("published_at", { ascending: false });
    if (error) {
      setNotice(`公開曲を読み込めませんでした: ${error.message}`);
      setLoadingSongs(false);
      return;
    }
    const remote: SongEntry[] = [];
    for (const row of (data ?? []) as SongRow[]) {
      if (!row.audio_path || !row.chart_path) continue;
      const [audio, chartFile] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(row.audio_path, 3600),
        supabase.storage.from(BUCKET).download(row.chart_path),
      ]);
      if (audio.error || chartFile.error) continue;
      try {
        const parsed = parseChartByType(await chartFile.data.text(), row.chart_type, row.fnf_side);
        remote.push({
          id: row.id,
          title: row.title,
          artist: row.artist,
          chart: toChart(row, parsed, audio.data.signedUrl),
        });
      } catch {
        // A broken public chart should not prevent other public songs from loading.
      }
    }
    setPublishedSongs(remote);
    setLoadingSongs(false);
  };

  const loadAccount = async (nextUser: User) => {
    const [profileResult, songsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", nextUser.id).maybeSingle(),
      supabase
        .from("songs")
        .select("*")
        .eq("user_id", nextUser.id)
        .order("created_at", { ascending: false }),
    ]);
    if (profileResult.data) setProfile(profileResult.data as Profile);
    if (songsResult.data) setMySongs(songsResult.data as SongRow[]);
  };

  useEffect(() => {
    void loadPublicSongs();
  }, []);

  useEffect(() => {
    if (user) void loadAccount(user);
    else {
      setProfile(null);
      setMySongs([]);
    }
  }, [user]);

  const songsForSelect = useMemo(
    () => [
      ...localSongs,
      ...publishedSongs.filter((remote) => !localSongs.some((local) => local.id === remote.id)),
    ],
    [localSongs, publishedSongs],
  );

  const openAuth = (mode: AuthMode = "login") => {
    setAuthMode(mode);
    setScreen("auth");
    setNotice("");
  };

  const afterAuth = () => {
    setScreen("home");
    setNotice("ログインしました");
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#090a0f] text-sm text-white/60">
        LOADING PROFILE…
      </div>
    );
  }

  if (screen === "play" && selectedSong?.chart) {
    return (
      <GameScreen
        key={selectedSong.id}
        chart={selectedSong.chart}
        modeId={modeId}
        onModeChange={onModeChange}
        onExit={() => setScreen("select")}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#090a0f] text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col">
        <HubHeader
          user={user}
          profile={profile}
          onAuth={() => openAuth()}
          onProfile={() => setScreen("profile")}
        />
        {notice && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 md:mx-8">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} aria-label="閉じる">
              <X className="size-4" />
            </button>
          </div>
        )}
        {screen === "home" && (
          <HomeScreen
            user={user}
            profile={profile}
            songs={publishedSongs}
            loadingSongs={loadingSongs}
            localSongs={localSongs}
            onAuth={openAuth}
            onPlay={(song) => {
              setSelectedSong(song);
              setScreen("play");
            }}
            onSelect={() => setScreen("select")}
            onUpload={() => (user ? setScreen("upload") : openAuth("signup"))}
          />
        )}
        {screen === "select" && (
          <SelectScreen
            songs={songsForSelect}
            onBack={() => setScreen("home")}
            onPlay={(song) => {
              setSelectedSong(song);
              setScreen("play");
            }}
          />
        )}
        {screen === "auth" && (
          <AuthScreen
            mode={authMode}
            onModeChange={setAuthMode}
            onDone={afterAuth}
            onBack={() => setScreen("home")}
          />
        )}
        {screen === "profile" && user && (
          <ProfileScreen
            user={user}
            profile={profile}
            songs={mySongs}
            onBack={() => setScreen("home")}
            onSaved={(next) => {
              setProfile(next);
              setNotice("プロフィールを保存しました");
            }}
            onPlay={(song) => {
              setSelectedSong(song);
              setScreen("play");
            }}
          />
        )}
        {screen === "upload" && user && (
          <UploadScreen
            user={user}
            onBack={() => setScreen("home")}
            onUploaded={async () => {
              await loadAccount(user);
              setScreen("publish");
              setNotice("下書きを保存しました。公開内容を確認してください");
            }}
            onError={setNotice}
          />
        )}
        {screen === "publish" && user && (
          <PublishScreen
            songs={mySongs}
            onBack={() => setScreen("home")}
            onPublished={async () => {
              await loadAccount(user);
              await loadPublicSongs();
              setScreen("home");
              setNotice("曲を公開しました");
            }}
            onError={setNotice}
          />
        )}
      </div>
      {screen !== "auth" && screen !== "play" && (
        <BottomNav
          screen={screen}
          user={user}
          onHome={() => setScreen("home")}
          onUpload={() => (user ? setScreen("upload") : openAuth("signup"))}
          onProfile={() => (user ? setScreen("profile") : openAuth())}
        />
      )}
    </div>
  );
}

function HubHeader({
  user,
  profile,
  onAuth,
  onProfile,
}: {
  user: User | null;
  profile: Profile | null;
  onAuth: () => void;
  onProfile: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-4 py-4 md:px-8">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-violet-500 text-[#090a0f]">
          <Music2 className="size-5" />
        </div>
        <div>
          <p className="font-display text-lg font-bold tracking-[0.18em]">PULSE LANE</p>
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">
            rhythm creator community
          </p>
        </div>
      </div>
      {user ? (
        <button
          type="button"
          onClick={onProfile}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3 text-sm hover:bg-white/10"
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <CircleUserRound className="size-8 text-cyan-200" />
          )}
          <span className="max-w-28 truncate">{displayName(user, profile)}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onAuth}
          className="rounded-full border border-cyan-200/40 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-200/10"
        >
          ログイン
        </button>
      )}
    </header>
  );
}

function HomeScreen({
  user,
  profile,
  songs,
  localSongs,
  loadingSongs,
  onAuth,
  onPlay,
  onSelect,
  onUpload,
}: {
  user: User | null;
  profile: Profile | null;
  songs: SongEntry[];
  localSongs: SongEntry[];
  loadingSongs: boolean;
  onAuth: (mode?: AuthMode) => void;
  onPlay: (song: SongEntry) => void;
  onSelect: () => void;
  onUpload: () => void;
}) {
  return (
    <main className="flex-1 px-4 pb-28 md:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#161a33] via-[#10121f] to-[#0c0d14] px-6 py-10 md:px-12 md:py-16">
        <div className="absolute -right-24 -top-28 size-80 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 size-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.35em] text-cyan-200">
            CREATE · PLAY · SHARE
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight md:text-6xl">
            あなたの曲を、
            <br />
            <span className="text-cyan-200">みんなのステージへ。</span>
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-white/60">
            音源と譜面をまとめてアップロード。公開された曲は誰でも遊べます。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onSelect}
              className="rounded-full bg-cyan-200 px-6 py-3 text-sm font-bold text-[#0b101a] hover:bg-cyan-100"
            >
              曲を探して遊ぶ
            </button>
            <button
              type="button"
              onClick={onUpload}
              className="rounded-full border border-white/20 px-6 py-3 text-sm font-bold text-white hover:bg-white/10"
            >
              曲を投稿する
            </button>
          </div>
          {!user && (
            <button
              type="button"
              onClick={() => onAuth("signup")}
              className="mt-5 text-xs text-white/50 underline underline-offset-4 hover:text-white"
            >
              アカウントを作成すると投稿できます
            </button>
          )}
        </div>
      </section>
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">DISCOVER</p>
            <h2 className="mt-1 text-2xl font-bold">公開された曲</h2>
          </div>
          <button
            type="button"
            onClick={onSelect}
            className="flex items-center gap-1 text-sm text-white/50 hover:text-white"
          >
            すべて見る <ChevronRight className="size-4" />
          </button>
        </div>
        {loadingSongs ? (
          <div className="rounded-2xl border border-white/10 p-8 text-center text-sm text-white/40">
            公開曲を読み込み中…
          </div>
        ) : songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/45">
            まだ公開曲がありません。最初の曲を投稿してみましょう。
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {songs.slice(0, 6).map((song) => (
              <SongCard key={song.id} song={song} onPlay={() => onPlay(song)} />
            ))}
          </div>
        )}
        {localSongs.length > 0 && (
          <p className="mt-6 text-xs text-white/30">
            ローカルテスト曲 {localSongs.length} 曲も「曲を探して遊ぶ」から選択できます。
          </p>
        )}
      </section>
    </main>
  );
}

function SongCard({ song, onPlay }: { song: SongEntry; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={!song.chart}
      className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-white/[0.08] disabled:opacity-50"
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/70 to-cyan-300/50">
        <Music2 className="size-6 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{song.title}</p>
        <p className="truncate text-xs text-white/50">{song.artist}</p>
      </div>
      <ChevronRight className="size-4 text-white/30 transition group-hover:text-cyan-200" />
    </button>
  );
}

function SelectScreen({
  songs,
  onBack,
  onPlay,
}: {
  songs: SongEntry[];
  onBack: () => void;
  onPlay: (song: SongEntry) => void;
}) {
  const [selectedId, setSelectedId] = useState(songs[0]?.id ?? "");
  const selected = songs.find((song) => song.id === selectedId) ?? songs[0];
  return (
    <main className="flex-1 px-4 pb-28 md:px-8">
      <PageHeading title="曲を探して遊ぶ" eyebrow="MUSIC SELECT" onBack={onBack} />
      <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-cyan-200/20 bg-gradient-to-br from-cyan-200/10 to-violet-400/10 p-6">
          <div className="flex aspect-square items-center justify-center rounded-2xl bg-black/20">
            <Music2 className="size-20 text-cyan-200/70" />
          </div>
          {selected && (
            <>
              <h2 className="mt-5 text-2xl font-bold">{selected.title}</h2>
              <p className="mt-1 text-white/50">{selected.artist}</p>
              <button
                type="button"
                disabled={!selected.chart}
                onClick={() => selected.chart && onPlay(selected)}
                className="mt-6 w-full rounded-full bg-cyan-200 py-3 text-sm font-bold text-[#0b101a] disabled:opacity-40"
              >
                PLAY
              </button>
            </>
          )}
        </div>
        <div className="space-y-2">
          {songs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/40">
              曲がありません
            </div>
          )}
          {songs.map((song) => (
            <button
              type="button"
              key={song.id}
              onClick={() => setSelectedId(song.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${song.id === selected?.id ? "border-cyan-200/50 bg-cyan-200/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-violet-400/20 text-cyan-100">
                <Music2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{song.title}</span>
                <span className="block truncate text-xs text-white/45">{song.artist}</span>
              </span>
              <span className="text-[10px] text-white/35">{song.chart ? "PLAY" : "準備中"}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function AuthScreen({
  mode,
  onModeChange,
  onDone,
  onBack,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idStatus, setIdStatus] = useState<"" | "checking" | "free" | "taken" | "invalid">("");
  const normalizedId = username.trim().replace(/^@/, "").toLowerCase();
  const idValid = /^[a-z0-9_]{3,20}$/.test(normalizedId);
  const pwIssues = passwordIssues(password, normalizedId);

  useEffect(() => {
    if (mode !== "signup" || !normalizedId) return setIdStatus("");
    if (!idValid) return setIdStatus("invalid");
    setIdStatus("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", normalizedId)
        .maybeSingle();
      setIdStatus(data ? "taken" : "free");
    }, 400);
    return () => clearTimeout(t);
  }, [normalizedId, idValid, mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!idValid) return setError("プレイヤーIDは半角英小文字・数字・_ の3〜20文字です。");
    const email = `${normalizedId}@players.pulselane.app`;
    if (mode === "signup") {
      if (idStatus === "taken") return setError(`@${normalizedId} はすでに使われています。`);
      if (pwIssues.length) return setError(`パスワードが弱すぎます：${pwIssues.join("、")}`);
    }
    setBusy(true);
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                username: normalizedId,
                display_name: displayNameInput.trim() || normalizedId,
              },
            },
          });
    setBusy(false);
    if (result.error) {
      const msg = result.error.message;
      if (/invalid login/i.test(msg)) setError("プレイヤーIDまたはパスワードが違います。");
      else if (/already registered/i.test(msg)) setError(`@${normalizedId} はすでに使われています。`);
      else if (/pwned|weak|compromised/i.test(msg))
        setError("このパスワードは流出済みのため使えません。別のパスワードにしてください。");
      else setError(msg);
    } else onDone();
  };
  const google = async () => {
    setBusy(true);
    setError("");
    const result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (result.error) {
      setBusy(false);
      setError(result.error.message);
    }
  };
  return (
    <main className="flex flex-1 items-center justify-center px-4 pb-24">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-7 flex items-center gap-2 text-sm text-white/50 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          戻る
        </button>
        <div className="mb-7">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">
            {mode === "login" ? "WELCOME BACK" : "JOIN THE COMMUNITY"}
          </p>
          <h1 className="mt-2 text-3xl font-bold">{mode === "login" ? "ログイン" : "新規登録"}</h1>
          <p className="mt-2 text-sm text-white/50">
            {mode === "login"
              ? "作った曲とプレイ記録にアクセスします。"
              : "投稿して、あなたの譜面をみんなに届けましょう。"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void google()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-3 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          <span className="font-bold text-lg">G</span> Googleで続ける
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          または
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <div>
            <div className="flex items-center rounded-xl">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoCapitalize="none"
                autoComplete="username"
                placeholder="@プレイヤーID（英小文字・数字・_）"
                className="field"
              />
            </div>
            {mode === "signup" && idStatus && (
              <p
                className={`mt-1 text-xs ${idStatus === "free" ? "text-emerald-300" : idStatus === "checking" ? "text-white/40" : "text-rose-300"}`}
              >
                {idStatus === "checking" && "確認中…"}
                {idStatus === "free" && `@${normalizedId} は使えます`}
                {idStatus === "taken" && `@${normalizedId} はすでに存在します`}
                {idStatus === "invalid" && "半角英小文字・数字・_ の3〜20文字にしてください"}
              </p>
            )}
          </div>
          {mode === "signup" && (
            <input
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="表示名（自由・あとで変更可）"
              className="field"
            />
          )}
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "login" ? "パスワード" : "パスワード（8文字以上・英字と数字）"}
              className="field"
            />
            {mode === "signup" && password && (
              <p className={`mt-1 text-xs ${pwIssues.length ? "text-rose-300" : "text-emerald-300"}`}>
                {pwIssues.length ? `弱いパスワード：${pwIssues.join("、")}` : "強度OK"}
              </p>
            )}
          </div>
          {error && (
            <p className="rounded-xl bg-rose-400/10 p-3 text-xs leading-5 text-rose-200">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-cyan-200 py-3 text-sm font-bold text-[#0b101a] disabled:opacity-50"
          >
            {busy ? "処理中…" : mode === "login" ? "ログイン" : "アカウントを作成"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setError("");
            onModeChange(mode === "login" ? "signup" : "login");
          }}
          className="mt-6 w-full text-center text-sm text-white/50 hover:text-cyan-100"
        >
          {mode === "login"
            ? "アカウントを持っていない方はこちら"
            : "すでにアカウントをお持ちの方はこちら"}
        </button>
      </div>
    </main>
  );
}

function ProfileScreen({
  user,
  profile,
  songs,
  onBack,
  onSaved,
  onPlay,
}: {
  user: User;
  profile: Profile | null;
  songs: SongRow[];
  onBack: () => void;
  onSaved: (profile: Profile) => void;
  onPlay: (song: SongEntry) => void;
}) {
  const [username, setUsername] = useState(profile?.username ?? "");
  const [display, setDisplay] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const next = {
      id: user.id,
      username: username.trim(),
      display_name: display.trim(),
      bio: bio.trim(),
      avatar_url: avatarUrl || null,
    };
    const { data, error: saveError } = await supabase
      .from("profiles")
      .upsert(next)
      .select()
      .single();
    setBusy(false);
    if (saveError) setError(saveError.message);
    else if (data) onSaved(data as Profile);
  };
  const uploadAvatar = async (file: File) => {
    const path = `${user.id}/avatar-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setError(uploadError.message);
      return;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
  };
  return (
    <main className="flex-1 px-4 pb-28 md:px-8">
      <PageHeading title="プロフィール" eyebrow="YOUR SPACE" onBack={onBack} />
      <div className="grid gap-5 md:grid-cols-[0.75fr_1.25fr]">
        <form
          onSubmit={(event) => void save(event)}
          className="rounded-3xl border border-white/10 bg-white/[0.04] p-6"
        >
          <div className="mb-6 flex items-center gap-4">
            <button
              type="button"
              onClick={() => avatarInput.current?.click()}
              className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-200/40 to-violet-400/50"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                <CircleUserRound className="size-10 text-white/70" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px]">
                変更
              </span>
            </button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
            <div>
              <p className="font-semibold">{displayName(user, profile)}</p>
              <p className="text-xs text-white/40">@{username}</p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="label">
              プレイヤーID（ログインに使うため変更不可）
              <input value={`@${username}`} readOnly disabled className="field opacity-60" />
            </label>
            <label className="label">
              表示名
              <input
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                className="field"
              />
            </label>
            <label className="label">
              自己紹介
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                className="field resize-none"
              />
            </label>
            {error && <p className="text-xs text-rose-200">{error}</p>}
            <button
              disabled={busy}
              className="w-full rounded-xl bg-cyan-200 py-3 text-sm font-bold text-[#0b101a] disabled:opacity-50"
            >
              {busy ? "保存中…" : "プロフィールを保存"}
            </button>
          </div>
        </form>
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-white/40">MY TRACKS</p>
              <h2 className="mt-1 text-xl font-bold">投稿した曲</h2>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs">{songs.length} 曲</span>
          </div>
          {songs.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/40">まだ投稿曲がありません。</p>
          ) : (
            <div className="space-y-2">
              {songs.map((song) => (
                <div key={song.id} className="flex items-center gap-3 rounded-xl bg-black/20 p-3">
                  <Music2 className="size-5 text-cyan-200" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{song.title}</p>
                    <p className="text-xs text-white/40">
                      {song.is_published ? "公開中" : "下書き"} · {song.note_count} notes
                    </p>
                  </div>
                  {song.is_published && song.audio_path && song.chart_path && (
                    <button
                      type="button"
                      onClick={async () => {
                        const [audio, chartFile] = await Promise.all([
                          supabase.storage.from(BUCKET).createSignedUrl(song.audio_path!, 3600),
                          supabase.storage.from(BUCKET).download(song.chart_path!),
                        ]);
                        if (audio.data && chartFile.data) {
                          const parsed = parseChartByType(await chartFile.data.text(), song.chart_type, song.fnf_side);
                          onPlay({
                            id: song.id,
                            title: song.title,
                            artist: song.artist,
                            chart: toChart(song, parsed, audio.data.signedUrl),
                          });
                        }
                      }}
                      className="rounded-lg p-2 text-cyan-200 hover:bg-white/10"
                    >
                      PLAY
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function UploadScreen({
  user,
  onBack,
  onUploaded,
  onError,
}: {
  user: User;
  onBack: () => void;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [difficulty, setDifficulty] = useState("NORMAL");
  const [audio, setAudio] = useState<File | null>(null);
  const [chart, setChart] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [background, setBackground] = useState<File | null>(null);
  const [player, setPlayer] = useState<File | null>(null);
  const [opponent, setOpponent] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [chartType, setChartType] = useState<ChartType>("mania");
  const [side, setSide] = useState<FnfSide>("right");
  const [sides, setSides] = useState<Record<FnfSide, number> | null>(null);
  const [official, setOfficial] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const redeem = useServerFn(redeemAdminCode);
  useEffect(() => {
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user.id]);
  const unlockAdmin = async () => {
    setAdminMsg("");
    try {
      const res = await redeem({ data: { code: adminCode } });
      if (res.ok) {
        setIsAdmin(true);
        setOfficial(true);
        setAdminMsg("管理者として認証されました");
      } else setAdminMsg("コードが違います");
    } catch {
      setAdminMsg("認証できませんでした");
    }
  };
  const [chartInfo, setChartInfo] = useState<{
    bpm: number;
    laneCount: number;
    noteCount: number;
    format: string;
  } | null>(null);
  const readChart = async (
    file: File | null,
    type: ChartType = chartType,
    pickedSide: FnfSide = side,
  ) => {
    setChart(file);
    setChartInfo(null);
    if (!file) return;
    try {
      const text = await file.text();
      let useSide = pickedSide;
      if (type === "fnf") {
        const found = detectFnfSides(text);
        setSides(found);
        const other: FnfSide = useSide === "left" ? "right" : "left";
        if (found[useSide] === 0 && found[other] > 0) {
          useSide = other;
          setSide(useSide);
        }
      } else setSides(null);
      const parsed = parseChartByType(text, type, useSide);
      if (parsed.difficultyName && (!difficulty || difficulty === "NORMAL"))
        setDifficulty(parsed.difficultyName);
      setChartInfo({
        bpm: parsed.bpm,
        laneCount: parsed.laneCount,
        noteCount: parsed.notes.length,
        format: parsed.format,
      });
      if (!title && parsed.title) setTitle(parsed.title);
      if (!artist && parsed.artist) setArtist(parsed.artist);
    } catch (error) {
      onError(error instanceof Error ? error.message : "譜面を読み込めませんでした");
    }
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !audio || !chart) {
      onError("曲名・音源・譜面は必須です");
      return;
    }
    setBusy(true);
    try {
      const parsed = parseChartByType(await chart.text(), chartType, side);
      const songId = crypto.randomUUID();
      const files: [string, File | null][] = [
        ["audio_path", audio],
        ["chart_path", chart],
        ["cover_path", cover],
        ["background_path", background],
        ["player_image_path", player],
        ["opponent_image_path", opponent],
      ];
      const paths: Record<string, string | null> = {};
      for (const [field, file] of files) {
        if (!file) {
          paths[field] = null;
          continue;
        }
        const path = `${user.id}/${songId}/${field}-${file.name}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });
        if (error) throw new Error(`${file.name}: ${error.message}`);
        paths[field] = path;
      }
      const { error } = await supabase.from("songs").insert({
        id: songId,
        user_id: user.id,
        title: title.trim(),
        artist: artist.trim(),
        difficulty_name: difficulty.trim() || "NORMAL",
        bpm: parsed.bpm,
        offset_sec: parsed.offset,
        lane_count: parsed.laneCount,
        note_count: parsed.notes.length,
        mode_id: chartType === "fnf" ? "fnf" : "mania",
        chart_type: chartType,
        fnf_side: side,
        is_official: official && isAdmin,
        ...paths,
      });
      if (error) throw new Error(error.message);
      onUploaded();
    } catch (error) {
      onError(error instanceof Error ? error.message : "アップロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex-1 px-4 pb-28 md:px-8">
      <PageHeading title="曲を投稿する" eyebrow="UPLOAD STUDIO" onBack={onBack} />
      <form
        onSubmit={(event) => void upload(event)}
        className="grid gap-5 lg:grid-cols-[1fr_0.9fr]"
      >
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <p className="mb-2 text-xs uppercase tracking-[0.25em] text-white/40">CHART TYPE</p>
          <div className="mb-5 grid grid-cols-2 gap-2">
            {(
              [
                ["mania", "osu!mania", ".osu ファイル"],
                ["fnf", "FNF", "譜面 JSON"],
              ] as const
            ).map(([id, name, hint]) => (
              <button
                type="button"
                key={id}
                onClick={() => {
                  setChartType(id);
                  setChart(null);
                  setChartInfo(null);
                  setSides(null);
                }}
                className={`rounded-2xl border p-4 text-left ${chartType === id ? "border-cyan-200/60 bg-cyan-200/10" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
              >
                <span className="block font-bold">{name}</span>
                <span className="block text-xs text-white/45">{hint}</span>
              </button>
            ))}
          </div>
          {chartType === "fnf" && (
            <div className="mb-5">
              <p className="mb-2 text-xs text-white/50">遊ぶサイド</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["left", "レフトサイド（相手側）"],
                    ["right", "ライトサイド（プレイヤー側）"],
                  ] as const
                ).map(([id, name]) => {
                  const count = sides?.[id];
                  const missing = sides !== null && count === 0;
                  return (
                    <button
                      type="button"
                      key={id}
                      disabled={missing}
                      onClick={() => {
                        setSide(id);
                        if (chart) void readChart(chart, "fnf", id);
                      }}
                      className={`rounded-xl border p-3 text-left text-sm disabled:opacity-35 ${side === id ? "border-cyan-200/60 bg-cyan-200/10" : "border-white/10 bg-black/20"}`}
                    >
                      {name}
                      <span className="block text-[11px] text-white/45">
                        {sides === null ? "譜面を選ぶと確認します" : missing ? "譜面なし" : `${count} notes`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label sm:col-span-2">
              曲名
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="field"
                placeholder="例: Neon Horizon"
              />
            </label>
            <label className="label">
              アーティスト
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="field"
                placeholder="あなたの名前"
              />
            </label>
            <label className="label">
              難易度名
              <input
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="field"
                placeholder="NORMAL"
              />
            </label>
          </div>
          <div className="mt-6 space-y-3">
            <UploadField
              icon={<AudioLines className="size-5" />}
              label="音源（MP3 / OGG / WAV）"
              file={audio}
              accept="audio/*"
              onChange={setAudio}
              required
            />
            <UploadField
              icon={<FileJson className="size-5" />}
              label={chartType === "fnf" ? "FNF譜面（JSON）" : "osu!mania譜面（.osu）"}
              file={chart}
              accept={chartType === "fnf" ? ".json,application/json" : ".osu,text/plain"}
              onChange={(file) => void readChart(file)}
              required
            />
          </div>
          {chartInfo && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-cyan-100">
              <span className="chip">{chartInfo.format}</span>
              <span className="chip">{chartInfo.bpm} BPM</span>
              <span className="chip">{chartInfo.laneCount} lanes</span>
              <span className="chip">{chartInfo.noteCount} notes</span>
            </div>
          )}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <p className="mb-4 text-xs uppercase tracking-[0.25em] text-white/40">OPTIONAL ASSETS</p>
          <div className="space-y-3">
            <UploadField
              icon={<ImagePlus className="size-5" />}
              label="ジャケット画像"
              file={cover}
              accept="image/*"
              onChange={setCover}
            />
            <UploadField
              icon={<ImagePlus className="size-5" />}
              label="背景画像"
              file={background}
              accept="image/*"
              onChange={setBackground}
            />
            {chartType === "fnf" && (<>
            <UploadField
              icon={<ImagePlus className="size-5" />}
              label="自機画像"
              file={player}
              accept="image/*"
              onChange={setPlayer}
            />
            <UploadField
              icon={<ImagePlus className="size-5" />}
              label="敵キャラ画像"
              file={opponent}
              accept="image/*"
              onChange={setOpponent}
            />
            </>)}
          </div>
          <div className="mt-6 rounded-xl border border-amber-200/20 bg-amber-200/5 p-4">
            <p className="text-sm font-semibold text-amber-100">正規版として投稿</p>
            {isAdmin ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={official}
                  onChange={(e) => setOfficial(e.target.checked)}
                />
                正規版マークを付ける（管理者）
              </label>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  placeholder="管理者コード"
                  type="password"
                  className="field flex-1"
                />
                <button
                  type="button"
                  onClick={() => void unlockAdmin()}
                  disabled={!adminCode}
                  className="rounded-xl border border-amber-200/40 px-3 text-xs text-amber-100 disabled:opacity-40"
                >
                  認証
                </button>
              </div>
            )}
            {adminMsg && <p className="mt-2 text-xs text-amber-100/80">{adminMsg}</p>}
            {!isAdmin && (
              <p className="mt-2 text-[11px] text-white/40">コードが無くても通常版として投稿できます。</p>
            )}
          </div>
          <div className="mt-4 rounded-xl bg-cyan-200/10 p-4 text-xs leading-5 text-cyan-100/80">
            アップロードした曲はまず下書きとして保存されます。次の公開画面で内容を確認してから公開できます。
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-200 py-3 text-sm font-bold text-[#0b101a] disabled:opacity-50"
          >
            <Upload className="size-4" />
            {busy ? "アップロード中…" : "まとめてアップロード"}
          </button>
        </div>
      </form>
    </main>
  );
}

function UploadField({
  icon,
  label,
  file,
  accept,
  onChange,
  required,
}: {
  icon: React.ReactNode;
  label: string;
  file: File | null;
  accept: string;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 bg-black/20 p-3 text-left hover:border-cyan-200/50 hover:bg-cyan-200/5"
    >
      <span className="text-cyan-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {label}
          {required && <span className="ml-1 text-cyan-200">*</span>}
        </span>
        <span className="block truncate text-xs text-white/40">{fileLabel(file)}</span>
      </span>
      {file ? (
        <Check className="size-4 text-emerald-300" />
      ) : (
        <Plus className="size-4 text-white/30" />
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        required={required}
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </button>
  );
}

function PublishScreen({
  songs,
  onBack,
  onPublished,
  onError,
}: {
  songs: SongRow[];
  onBack: () => void;
  onPublished: () => void;
  onError: (message: string) => void;
}) {
  const drafts = songs.filter((song) => !song.is_published);
  const [selected, setSelected] = useState<string | null>(drafts[0]?.id ?? null);
  const publish = async () => {
    if (!selected) return;
    const { error } = await supabase
      .from("songs")
      .update({ is_published: true, published_at: new Date().toISOString() })
      .eq("id", selected);
    if (error) onError(error.message);
    else onPublished();
  };
  return (
    <main className="flex-1 px-4 pb-28 md:px-8">
      <PageHeading title="公開する曲を選ぶ" eyebrow="PUBLISH" onBack={onBack} />
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <p className="mb-5 text-sm leading-6 text-white/55">
          公開前に曲名・譜面・音源を確認してください。公開後は、他のプレイヤーの曲選択画面に表示されます。
        </p>
        {drafts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-white/40">
            公開待ちの下書きはありません。
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((song) => (
              <button
                type="button"
                key={song.id}
                onClick={() => setSelected(song.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${selected === song.id ? "border-cyan-200/50 bg-cyan-200/10" : "border-white/10 bg-black/20"}`}
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-violet-400/20">
                  <Music2 className="size-5 text-cyan-100" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{song.title}</span>
                  <span className="block text-xs text-white/45">
                    {song.is_official ? "正規版 · " : ""}
                    {song.chart_type === "fnf" ? `FNF(${song.fnf_side === "left" ? "左" : "右"})` : "osu!mania"} ·{" "}
                    {song.artist || "アーティスト未設定"} · {song.difficulty_name} ·{" "}
                    {song.note_count} notes
                  </span>
                </span>
                {selected === song.id && <Check className="size-5 text-cyan-200" />}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={!selected}
          onClick={() => void publish()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-200 py-3 text-sm font-bold text-[#0b101a] disabled:opacity-40"
        >
          <Send className="size-4" />
          この曲を公開する
        </button>
      </div>
    </main>
  );
}

function PageHeading({
  title,
  eyebrow,
  onBack,
}: {
  title: string;
  eyebrow: string;
  onBack: () => void;
}) {
  return (
    <div className="mb-7 flex items-end gap-4 pt-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-1 rounded-full border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="size-4" />
      </button>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-bold">{title}</h1>
      </div>
    </div>
  );
}

function BottomNav({
  screen,
  user,
  onHome,
  onUpload,
  onProfile,
}: {
  screen: HubScreen;
  user: User | null;
  onHome: () => void;
  onUpload: () => void;
  onProfile: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#090a0f]/90 px-4 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        <NavButton active={screen === "home"} icon={<Music2 />} label="ホーム" onClick={onHome} />
        <NavButton
          active={screen === "upload" || screen === "publish"}
          icon={<Upload />}
          label="投稿"
          onClick={onUpload}
        />
        <NavButton
          active={screen === "profile"}
          icon={user ? <CircleUserRound /> : <LogIn />}
          label={user ? "プロフィール" : "ログイン"}
          onClick={onProfile}
        />
      </div>
    </nav>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-20 flex-col items-center gap-1 py-1 text-[10px] ${active ? "text-cyan-200" : "text-white/40 hover:text-white"}`}
    >
      {<span className="[&>svg]:size-5">{icon}</span>}
      {label}
    </button>
  );
}

/** Returns human-readable reasons a password is too weak (empty = OK). */
function passwordIssues(pw: string, id: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("8文字以上");
  if (!/[a-zA-Z]/.test(pw)) issues.push("英字を含める");
  if (!/[0-9]/.test(pw)) issues.push("数字を含める");
  if (/^(.)\1+$/.test(pw)) issues.push("同じ文字の繰り返しは不可");
  if (id && pw.toLowerCase().includes(id)) issues.push("IDを含めない");
  if (/^(password|12345678|qwerty|abc12345)/i.test(pw)) issues.push("よくあるパスワードは不可");
  return issues;
}
