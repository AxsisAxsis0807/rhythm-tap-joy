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
  user-bound persistence and statistics cache invalidation.
- `src/lib/playResultQueue.ts`: a versioned, user-scoped localStorage queue which
  survives RESULT navigation/reload and reuses the original play UUID.
- `src/components/app/RankingScreen.tsx`: public Top 100, independent own-rank
  query and reusable profile statistics, including loading/error states.
- `src/components/app/RhythmHub.tsx`: ranking navigation, account ID passed to
  gameplay, and profile statistics.
- `src/integrations/supabase/types.ts`: new tables and RPC types following the
  repository's existing checked-in type management.
- `supabase/migrations/20261006200000_global_score_ranking.sql`: schema and policies.
- `supabase/migrations/20261007090000_global_score_ranking_hardening.sql`:
  result invariants and exact text serialization for BIGINT ranking values.
- `supabase/migrations/20261010120000_play_result_validation.sql`: enforce
  validation for direct table inserts too, tighten combo/score bounds and
  acknowledge UUIDs only for the same owner and immutable result.
- `src/components/app/AccountGrowth.tsx`, `src/lib/accountGrowth.ts`: disabled-by-default
  display contract for server-confirmed growth; no XP backend/rules are invented.
- `tests/*.test.ts*`, `vitest.config.ts`, `package.json`, `bun.lock`: test setup.

## Migration and activation

Apply the new migration to the **existing Lovable/Supabase project** before
publishing the frontend. Use its migration workflow or run the SQL file in that
project's SQL editor. Do not apply the existing migrations again to a live DB.
The current environment has no database administration credentials or authenticated
user session. Read-only requests to the existing publishable REST endpoint return
HTTP 403 (edge error 1010), so live schema/migration status remains **unverified**.
No production migration was applied. Check the existing project's migration
history and schema first, then apply only missing files in filename order:
`20261006200000`, `20261007090000`, `20261010120000`.
See [the dated verification record](verification/global-ranking-2026-10-10.md)
for exact filenames, preflight queries, screenshots and activation steps.

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
5. The result is first written to a user-specific browser queue. A repeated
   request, including a retry after an ambiguous network failure,
   cannot add the same play twice. RETRY has a new UUID and adds another play.
6. The RPC uses the access token of the captured owner and a 15-second request
   timeout. Individual owner/UUID storage keys avoid whole-queue overwrites from
   other tabs. Existing v1 pending items are migrated without changing UUIDs.
7. Successful saves remove the queue item and invalidate ranking queries even
   after unmount. Transient failures remain queued for navigation, reload,
   online-event or manual retry. Account mismatch pauses that owner's queue;
   server-rejected invalid input is removed instead of looping. Retries use
   2-second exponential backoff up to 60 seconds. Authentication/configuration
   rejection pauses automatic retries until login or manual retry; invalid entries
   do not block subsequent results. Storage failure falls back to current-tab memory
   with a warning that reload persistence is unavailable.

## Rank calculation

`get_global_leaderboard()` returns only 100 players, with PostgreSQL `rank()`
computed by descending total score. Ties share a competition rank (1, 1, 3),
with UUID providing stable display order within ties. All profiles participate,
including zero-score profiles. BIGINT totals, counts and ranks are returned as
decimal text and formatted with JavaScript `BigInt` to avoid JSON precision loss.

`get_player_ranking(user_id)` fetches one profile plus `1 + count(players with a
strictly higher score)`. The score index supports this calculation without
sending all players to the client. It remains available outside Top 100 and uses
the same tie semantics.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`.

68 automated tests cover the existing game/input/settings behavior plus completion,
UUID idempotency, persistent reload/resend, storage failure, in-flight RETRY,
backoff, account isolation/token pinning, direct INSERT validation, immutable UUID
collisions, exact BIGINT, loading/error/empty states and disabled/confirmed growth
UI. PGlite runs all migrations with real PostgreSQL grants, RLS, triggers and RPCs.
A generated corpus of 120 real scoring-engine results is accepted, including
empty charts, mixed judgements, misses and long combos with capped bonuses.

Type checking and production build pass. Every changed TS/TSX file passes ESLint
without errors or warnings. Whole-repository lint has the same 349 errors and 7
warnings as the untouched baseline: 348 formatting errors and one prefer-const
error in `previewAuthStorage.ts`. Unrelated files were not reformatted.

Chromium 151 verifies 360×780, 844×390 and 1440×900 layouts. Local components use
mocked auth/DB responses and server-growth fixtures. Actual AudioClock/game engine,
keyboard and browser touch input, short mania/selected-side FNF charts, normal
completion, RETRY and BACK were exercised. Seven completed plays used seven UUIDs
and seven requests. Full details and screenshots are in the dated record.

## Remaining limitations

- Production migration and real authenticated end-to-end testing require access
  to the deployed project. Automated audio-clock tests do not replace device
  checks on iPhone and external keyboards.
- XP/Supporter have no backend, reward rules, entitlement synchronization or
  persisted public-Level setting in this repository. The display components use
  server snapshots only, and are absent from production without an enabled
  provider. The fixture screenshots are not proof of live XP awards. Connect an
  idempotent server ledger and actual rules/settings before enabling them.
- Scores still originate in the browser. The hardening migration rejects range
  errors and inconsistencies among score, accuracy, combo and judgement counts
  under the current rules, including direct table inserts. It cannot prove chart note count, timing or genuine
  play; that requires a server-authoritative chart/replay verifier.
