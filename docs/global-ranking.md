# Global cumulative score ranking

## Changes and architecture

The TanStack Start application uses `RhythmHub` as its screen navigator and
React Query for cached data. Both mania and FNF use `GameScreen` and
`useRhythmGame`. Existing Supabase clients and authentication are reused.
Song uploads, chart parsing, scoring rules, FNF side selection and profile editing
permissions are unchanged.

- `src/game/useRhythmGame.ts`, `src/game/types.ts`: one UUID per successful
  START/RETRY and a copied completion snapshot; finish after both the audio and
  the last note's existing 2.5-second grace period. Empty charts also finish.
- `src/components/game/GameScreen.tsx`: capture the account that starts the play;
  save on completion; display saving, success, failure and retry controls.
- `src/lib/playerRanking.ts`, `src/lib/usePlayResult.ts`: typed RPC calls,
  in-flight/success deduplication and statistics cache invalidation.
- `src/components/app/RankingScreen.tsx`: public Top 100, independent own-rank
  query and reusable profile statistics, including loading/error states.
- `src/components/app/RhythmHub.tsx`: ranking navigation, account ID passed to
  gameplay, and profile statistics.
- `src/integrations/supabase/types.ts`: new tables and RPC types following the
  repository's existing checked-in type management.
- `supabase/migrations/20261006200000_global_score_ranking.sql`: schema and policies.
- `tests/*.test.ts*`, `vitest.config.ts`, `package.json`, `bun.lock`: test setup.

## Migration and activation

Apply the new migration to the **existing Lovable/Supabase project** before
publishing the frontend. Use its migration workflow or run the SQL file in that
project's SQL editor. Do not apply the existing migrations again to a live DB.
This development environment has no database administration connection, so the
production migration has not been applied here.

`play_results` retains user ID, song ID, score, accuracy, max combo, all four
judgement counts and a database-generated timestamp. `song_id` is text because
built-in charts use text IDs and uploaded songs use UUIDs; removing a song does
not remove earned scores. There was no existing play history to backfill.
Statistics start at zero for existing profiles and are initialized for new ones.

`player_stats` stores indexed BIGINT totals and play counts. Authenticated and
anonymous roles can read it but cannot write it. Existing profile editing RLS
is preserved. Play history is visible only to its owner, and RLS permits only
own-user inserts. Clients cannot update/delete history or choose its timestamp.
An AFTER INSERT security-definer trigger performs atomic accumulation in the
same database transaction, with an empty search path and revoked direct execute
permissions. Direct profile upserts cannot change these statistics.

## Save flow

1. Successful START/RETRY allocates a fresh play UUID. Failed/abandoned plays
   never produce a completion snapshot.
2. On normal completion, the immutable result is passed to the persistence hook.
   Guest play skips persistence and still displays RESULT.
3. The current session must match the account that started the run.
4. `record_play_result` uses the authenticated DB user, preserves RLS, and inserts
   with `ON CONFLICT (id) DO NOTHING`. Only a newly inserted row runs the trigger.
5. A repeated request, including a retry after an ambiguous network failure,
   cannot add the same play twice. RETRY has a new UUID and adds another play.
6. Successful saves invalidate leaderboard and profile queries, even if the game
   screen has already unmounted. Failed saves can be retried from RESULT.

## Rank calculation

`get_global_leaderboard()` returns only 100 players, with PostgreSQL `rank()`
computed by descending total score. Ties share a competition rank (1, 1, 3),
with UUID providing stable display order within ties. All profiles participate,
including zero-score profiles.

`get_player_ranking(user_id)` fetches one profile plus `1 + count(players with a
strictly higher score)`. The score index supports this calculation without
sending all players to the client. It remains available outside Top 100 and uses
the same tie semantics.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`.

14 automated tests cover mania/FNF completion with the actual game hook and
mock audio clock, unchanged scoring and selected-side notes, full audio duration,
RESULT rerenders, RETRY, guest play, abandonment, same-ID save retries, empty
charts, Top 100 and own-rank/profile UI, loading/error recovery, and PostgreSQL
integration through PGlite. Database tests run **all Supabase migrations** with
an auth/storage fixture and real PostgreSQL grants, RLS, triggers and RPCs.
They verify additive totals across songs, idempotency, security permissions,
invalid-input rollback, sorting/ties and rank #107 outside Top 100.

Type checking and production build pass. New files pass ESLint; modified existing
files pass code rules with formatting disabled. Whole-repository lint still has
pre-existing formatting errors and an existing `no-explicit-any` violation in
`previewAuthStorage.ts`. They were not mass-refactored.

## Remaining limitations

- Production migration and real authenticated end-to-end testing require access
  to the deployed project. Automated audio-clock tests do not replace device
  checks on iPhone and external keyboards.
- Browser screenshot verification could not run because Chromium download failed
  in this environment. Ranking/profile rendering is covered by React DOM tests;
  mobile layout still needs a real browser/device check.
- Scores originate in the browser. RLS protects account ownership and aggregates;
  this feature does not introduce server-authoritative anti-cheat/replay validation.
- Failed network saves are retryable while RESULT remains open; there is no
  persistent offline queue after a reload or leaving the result screen.
- PostgreSQL BIGINT totals are returned as JavaScript numbers by the existing
  Supabase client. Exact display is bounded by JavaScript's safe integer range.
