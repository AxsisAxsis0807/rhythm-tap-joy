# XP backend verification — 2026-10-11 JST

Work started from current `main` (`ba313def`, merged PR #3), on
`feat/verified-xp-backend`. Root AGENTS.md, repository/module inventory,
`docs/global-ranking.md`, all Supabase migrations/configuration, auth middleware,
profile/settings, input/scoring/completion and ranking were inspected. Published
history is preserved; no upload/publishing logic is changed.

## Resolved remaining work / files

| Area | Changed files |
| --- | --- |
| Session, immutable reviewed chart registry, XP ledger/progress, policy, RLS/grants, owner visibility and masked public API | `supabase/migrations/20261011090000_verified_xp.sql` |
| Canonical hash, bounded ordered input/frame/calibration replay, shared-engine verification | `src/game/replay.ts`, `src/game/types.ts`, `src/game/useRhythmGame.ts` |
| Trusted authenticated server boundary, Session ownership and stored Revision lookup, independent score comparison/award commit | `src/lib/xp.functions.ts`, `src/lib/xp.server.ts`, `src/integrations/supabase/types.ts` |
| Owner-token-pinned RPCs, production data provider, durable independent XP queue, backoff/auth pause/invalid termination | `src/lib/xpClient.ts`, `src/lib/xpQueue.ts`, `src/lib/useAccountGrowth.ts`, `src/lib/accountGrowth.ts` |
| Actual Level/XP data in existing placements, DB-backed public settings, pending/error/reload states | `src/components/app/AccountGrowth.tsx`, `src/components/app/RhythmHub.tsx`, `src/components/game/GameScreen.tsx` |
| Keep Web Audio activation in START gesture before network wait; avoid storing two copies of a large replay | `src/game/audio.ts`, `src/lib/playResultQueue.ts` |
| Operator-only dry-run/registration and deployment instructions | `scripts/register-xp-revision.mjs`, `docs/verified-xp.md`, `docs/global-ranking.md` |
| Meaningful DB/server/replay/queue/provider tests and real concurrent PostgreSQL runner | `tests/xp-{db,replay,game-replay,server,queue,live-ui}.test.*`, `tests/postgres-xp.integration.mjs` |

Profile keeps avatar/name/username → title → growth → competitive statistics →
Supporter/visibility settings → existing editing/content. Home uses the compact
Level beside account identity; RESULT preserves Score/judgement/Combo/Accuracy
order and shows confirmed XP above its existing operations. No XP enters the HUD
or TOTAL SCORE ranking. Boost stays OFF. Entitlements are never invented for
production; their table is empty until a trusted real integration/operator writes it.

Initial numerical rules are implemented and documented as reviewable defaults,
not as a previously approved full formula: every Level 500XP; play90/first50/daily50;
UTC repeat play multiplier100%/50%/25%/0%; daily cap1,000 including bonuses.
Publication stays OFF. Read [actual rules / deployment steps](../verified-xp.md).

## Migration / production status

- New migration applied successfully to **local PGlite and disposable PostgreSQL17**
  along with every existing migration. Existing score history/aggregation functions
  stay unchanged. A new revision registry is independent of uploaded songs.
- Production migration **not applied**, production schema/history **not inspected**:
  environment reports no DB/service-role credentials or authenticated user session.
  Existing configured Lovable REST endpoint returned HTTP403 on a read-only probe.
- Client configuration points to the existing Lovable host; `supabase/config.toml`
  names `nxrvxojvehkqjjkljams`. Administrative access must establish that mapping.
  No replacement production database was created or reset.
- Built-in test audio was independently measured with ffprobe:64.026122 seconds.
  Operator script dry-run produced 104 selected notes and digest
  `704137547bd5a7bbf609958aebbb63f850b88012cdbcaa191166f6cb76476d60`.
  No production revision registration/approval was performed.

## Automated verification

- Baseline before changes:68 tests pass.
- Final: **105 tests /14 files pass**, including all existing tests.
- TypeScript `npm run typecheck`:pass.
- Production `npm run build`:pass. Existing admin inputValidator deprecation and
  bundle-size notices remain; the new server function uses `.validator()`.
- ESLint on every changed TS/TSX/MJS:pass, no errors/warnings.
- Whole lint:178 existing errors/7 warnings remain (177 formatting, one prefer-const
  at `previewAuthStorage.ts:38`, seven existing react-refresh warnings). Prior
  baseline had349 errors/7 warnings. Type schema formatting removed171 existing
  errors; no remaining finding is in a changed file. No unrelated file was formatted.
- `git diff --check`:pass. Client output inspection finds no service-role key
  binding, `verifyAndAward` or `commit_verified_xp` server implementation.

Tests cover explicit publication-OFF; server issued owner/play/revision-bound
Sessions; direct XP, entitlement, ledger and Session mutation rejection; own-only
reads; cross-account settings isolation; privacy persistence and masked public
API/direct-table denial (including XP's mathematical ability to reveal Level);
BIGINT above JavaScript's safe integer; exact/multiple Level thresholds; first and
repeat bonus/cap accounting; wall-clock/expiry/result mismatch; score independence;
free versus actual stored Supporter entitlement equality for Score/Accuracy/totals.

Replay tests execute the **actual React game hook** for mania and both FNF sides,
chords, fast inputs, multiple sources in a lane, holds/cancellation, missed frames,
pause/resume, calibration edits, RETRY and frozen snapshots. At a timing-window
boundary, input replay and judgement use one clock sample, so Web Audio quantum
advancement cannot make a valid replay disagree with its score. Server tests prove
stored hash/version checking, independent recomputation and owner/UUID rejection.
Queue tests cover timeout/reload/original Session+UUID, StrictMode-like rerenders,
concurrent/in-flight RETRY, storage failure, owner mismatch, terminal invalid input,
no restored fake confirmation, bounded automatic retries and manual recovery.

`node tests/postgres-xp.integration.mjs` passes against real PostgreSQL17:
5 overlapping duplicate transactions →one award; separate simultaneous plays
serialize repeat/first/daily bonuses →190/45/22, ledger3, XP257, Score3006, Plays3.
Concurrent duplicate Session issuance at the120/hour limit returns the same Session,
including a retry that waited for another transaction. PGlite alone is not claimed
as proof of overlapping transactions.

## Browser operations / saved local data

Chromium151 used actual RhythmHub/Profile/Game/RESULT components at360×780,
844×390 and1440×900, with mobile/touch emulation and reduced motion. Authentication
and TanStack transport were substituted only in an **uncommitted localhost test
adapter**. RPCs, private settings, registered revisions, actual Web Audio/input,
`verifyAndAward` and ledger/progress used the local PostgreSQL DB. This is not a
production JWT/auth/server-handler end-to-end test. The adapter and credentials
are not in this PR; no fixture provider is connected to production.

A seeded local account starts at499XP. Actual short mania/FNF completions produce
server-confirmed190/140/45XP, reaching874XP (Lv2,374/500); DB ledger has exactly3
rows, Score3514 and Plays3 at that checkpoint. The first XP request was deliberately
failed while score saved; BACK followed by reload resends the original UUID and
confirms190XP. Profile/home reflect the new Level, and privacyOFF survives reload
without hiding the owner's progress. FNF counts only its two selected notes;
opponent metadata is retained. RETRY uses a new UUID. A further real Chromium
run verifies Web Audio activation before Session await and earns the expected45XP.

All10 captured viewport checks have document scroll width equal to viewport width.
Long name, explanation bottom sheet, within-Level progress, score statistics,
RESULT error/confirmed states and access to RETRY/BACK pass. RESULT scroll reaches
operations in landscape. No page errors occurred in the successful run.

| Screen | Capture |
| --- | --- |
| Home compact Level / long account name,360px | [home](screenshots/xp-local-home-360.png) |
| Profile499/500, private settings,360px | [profile](screenshots/xp-local-profile-360.png) |
| Mobile explanation bottom sheet | [sheet](screenshots/xp-local-sheet-360.png) |
| Profile landscape844×390 | [landscape](screenshots/xp-local-profile-844x390.png) |
| Profile desktop1440×900 | [desktop](screenshots/xp-local-profile-1440x900.png) |
| RESULT XP failure with separate saved score,360px | [error](screenshots/xp-local-result-error-360.png) |
| Profile confirmed189/500 after delayed190XP | [confirmed profile](screenshots/xp-local-profile-confirmed-360.png) |
| FNF RESULT confirmed140XP,360px | [confirmed RESULT](screenshots/xp-local-fnf-result-confirmed-360.png) |
| FNF RESULT landscape | [landscape RESULT](screenshots/xp-local-fnf-result-844x390.png) |
| Landscape scrolled to RETRY/BACK | [operations](screenshots/xp-local-result-actions-844x390.png) |

## Still unconfirmed / next production actions

1. Actual production migration history/schema, real authenticated save/replay/XP,
   deployed TanStack handler and service-role binding:blocked by credentials and403.
   Use the concrete preflight/conditional migration/configuration/registration/smoke
   procedure in [verified-xp.md](../verified-xp.md); publication remains OFF meanwhile.
2. Real iPhone/Safari:hardware unavailable; Playwright WebKit binary is not installed.
   Chromium touch/viewport/audio tests are substitutes, not Safari/device verification.
   Native safe-area/rotation/audio behavior and realistic dense charts need device checks.
3. Browser replay cannot prove human operation or absence of automation. The new
   basis verifies Sessions, approved chart content, execution/results, server time,
   ownership, permissions and idempotency. Stronger human-play assurance is a distinct
   trusted-instrumentation problem. Existing Score ranking retains its semantics.
4. Real Supporter entitlement source/payment account is not configured. No fake Tier
   appears. Trusted entitlement storage and owner/public privacy boundaries are ready;
   connect only verified external data if that feature is later activated.

Merge the reviewed PR, apply **only missing** prerequisite/new migrations in the
existing project, configure server credentials, approve measured revisions, validate
real auth/device flows and numerical rules, then intentionally enable both flags
and Lovable Publish. Production save/publication is not claimed as completed.
