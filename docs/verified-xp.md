# Verified XP and account visibility

The XP backend is implemented as an additive layer after existing score saving.
`TOTAL SCORE`, Score, Accuracy, scoring windows and FNF's selected-side scoring do
not depend on XP or Supporter. Publication remains **OFF by default** in both the
DB migration and the frontend (`VITE_XP_ENABLED` must explicitly equal `true`).
No test provider or invented Supporter entitlement is wired into production.

## Data and trust boundaries

- `chart_revisions`: trusted operator registry of immutable canonical charts,
  independently measured audio duration, selected side and SHA-256 content digest.
  Both FNF sides participate in each digest; only the selected notes are scored.
  Register new content as a new digest. Only approval can change on an existing
  revision. Existing editable songs, chart URLs and `is_official` are insufficient
  to obtain XP. Upload/publishing behavior is unchanged.
- `verified_play_sessions`: DB-generated Session UUID, bound to authenticated
  owner, original play UUID, revision, initial calibration and server issue time.
  Idempotent issuance, seven-day expiry, maximum 120 sessions per owner per hour.
  This rate limit limits Session issuance, not keyboard/touch speed.
- `xp_progress`: authoritative BIGINT total. All UI/RPC numbers are decimal strings;
  Level and within-Level progress are derived on the server, never client writes.
- `xp_ledger`: one immutable award/zero-XP decision per play/Session; confirmed
  breakdown and after-award snapshot. User row lock serializes different plays,
  so first clear, daily bonus, repeat multipliers and caps cannot race. Unique IDs
  also protect timeouts, concurrent duplicate submissions and repeated rendering.
- `account_visibility`: owner-only settings, saved by authenticated RPC without
  a target-user parameter. No raw public SELECT grant. Owner can read progress
  even with all public options OFF. Public RPC omits hidden fields entirely.
  Publishing total XP would reveal Level mathematically, so XP publication only
  applies when both Level and XP publication are allowed.
- `supporter_entitlements`: trusted-service-only entitlement input, no seeded
  production rows and no client write. Public badge/tier obey visibility; expiry
  and synchronization details are private. No payment provider or fake entitlements
  are introduced. A trusted operator/integration may maintain real entitlements.

All new tables have RLS. Anonymous users can call only the explicitly public
projection. Authenticated users cannot update progress, policy, revisions,
Sessions, entitlements or ledger. `commit_verified_xp` accepts no XP/Level amount
and is executable only by the server's service role. Server keys stay in the
server runtime; the client bundle contains neither the key binding nor the
award implementation. Existing score RLS and aggregation triggers remain intact.

## Completion and replay flow

1. START/RETRY retains Web Audio activation in the click gesture. When XP is
   enabled, issue a Session before starting playback (three-second timeout).
   Failure still permits normal play, but that run has no retroactively trusted
   Session and cannot obtain XP. It has an explicit explanation on RESULT.
2. The original play UUID is used for both score and XP. Capture ordered accepted
   input sources, release/cancel, clear, pause/resume bounded calibration edits and frames that affect
   auto-miss/hold completion. Empty frames do not fill storage. No timing or score
   computation changes. At normal completion, freeze the replay before clearing
   inputs. Legitimate calibration edits retain their existing gameplay effect and
   are recorded before the affected input; replay validates the device-setting
   range (-300 to +300 ms). FNF opponent notes stay outside the selected scoring list.
3. Existing score queue commits score independently. The XP queue persists the
   Session and replay in owner/play-specific localStorage keys. Score queue does
   **not** duplicate the potentially large replay; XP quota failure cannot exhaust
   storage with a second copy. Storage failure keeps current-tab memory and shows
   an explicit durability warning.
4. `submitXpReplay` authenticates with existing TanStack middleware. Payload owner
   must match the verified JWT. `xp.server.ts` independently looks up the Session
   and immutable registered chart; browser supplies neither a chart nor a trusted
   result. It recomputes all counts, Score, Max Combo and Accuracy with the existing
   engine/windows/rules, validates completion/timeline/pause semantics and hashes
   the replay. The DB compares the recomputation with already committed score
   and server elapsed time before atomically calculating XP.
5. Transient failures retry with backoff; owner change/auth/configuration failures
   pause. Invalid replay/result is terminal. Automatic retries pause after ten
   failed requests, preserving manual recovery. Success removes raw replay data
   from the queue. Confirmed UI receipts are memory-only; editable localStorage
   receipts are never restored as claimed server-confirmed XP. Durable truth is
   the server ledger. Reload resumes pending entries with their original IDs.
6. Confirmations refresh profile and home; the RESULT card uses the confirmed
   after-award snapshot. Score's saving/saved/error text remains independent.
   There is no repeated Level-up animation or blocking celebration.

Replay collection is bounded to 250,000 operations per run and revisions to
100,000 selected notes / two hours. Exceeding a storage/replay bound does not
penalize game scoring; it explains that XP cannot be verified for that run.
Browser replay can be fabricated by a program. Sessions, approved revisions,
server elapsed time, independent scoring and rate/cap controls prevent arbitrary
XP writes and inconsistent results; **they do not prove human input, absence of
Autoplay, or genuine audio playback**. Explicit Practice/Autoplay modes must mark
results ineligible. No such modes are enabled by this change. Stronger human-play
or anti-automation assurance requires additional trusted instrumentation.
Existing global score ranking still permits structurally valid browser-reported
scores; this change gates **XP**, without changing ranking semantics or old scores.

## Initial server rules (publication OFF)

The prior UI specified the 500-XP Level-1 threshold and example +90/+50/+50 reward,
not a full numerical progression/repeat/cap formula. The migration implements these
reviewable initial defaults; they are not presented as previously approved rules:

| Rule | Initial value |
| --- | --- |
| Every Level threshold | 500 XP (Lv 1 starts at 0, Lv 2 at 500) |
| Verified normal completion with at least one successful selected-note judgement | 90 XP |
| First verified completion of this revision/selected FNF side | +50 XP |
| First eligible Session-issued UTC day completion | +50 XP |
| Same revision's eligible completions per UTC day | play XP ×100%, 50%, 25%, then 0%; floor fractional XP |
| All awards including bonuses per UTC day | 1,000 XP, allocated play → first clear → daily |
| XP Boost | OFF; no boost row/purchase prompt |

Level stepping and repeat structure are version-1 rules. Service-role operators
may configure `play_xp`, `first_clear_xp`, `daily_xp`, `daily_cap` within DB checks.
The explanation panel reads their current values from the same policy. Ledger
receipts preserve what was actually granted. Changing Level/repeat formulas needs
another version/migration. Decide numerical rules before public activation.

`disabled`, `unreviewed`, `expired`, `elapsed`, `daily_cap`, `repeat_limit`,
`no_hits`, `practice`, `autoplay`, `session_limit` and replay/session acquisition
limits have explicit reasons. They are not communication errors or paid upsells.
Pending/request failure retains a separate error/retry state and permits RETRY/BACK.

## Existing-project deployment procedure

**No production migration was applied from this environment.** There are no
DB/service-role credentials or real user session. The configured existing Lovable
REST host returned HTTP 403. `supabase/config.toml` has project ID
`nxrvxojvehkqjjkljams`; confirm this corresponds to the existing deployed Lovable
project, rather than assuming the host name identifies it. Do not create or reset
another production DB. Do not reapply migration files already recorded.

1. Inspect the existing DB with authenticated administrative access:

   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   select to_regclass('public.play_results'), to_regclass('public.player_stats'),
          to_regclass('public.xp_policy'), to_regclass('public.xp_ledger');
   select n.nspname, p.proname, p.prosecdef,
          pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('record_play_result','begin_verified_play','commit_verified_xp');
   select tablename, policyname, roles, cmd, qual, with_check
     from pg_policies where schemaname='public';
   ```

2. Back up/check existing data and apply **only missing migrations in filename order**.
   Score prerequisites are `20261006200000_global_score_ranking.sql`,
   `20261007090000_global_score_ranking_hardening.sql`,
   `20261010120000_play_result_validation.sql`. This PR adds
   `20261011090000_verified_xp.sql`. Use the existing project's migration runner;
   record history through that runner. Never replay the complete folder over live data.
3. Configure server-runtime `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` for the **same** project as client URL/key. The
   service key must never be a `VITE_*` variable. Deploy the TanStack server handler,
   not just static assets. Keep `xp_policy.enabled=false` during schema/grant checks.
4. Register independently reviewed chart revisions using the operator script.
   It is dry-run by default; it never overwrites an existing revision or touches
   song posting. For the checked-in test audio, local `ffprobe` measured 64.026122 s:

   ```sh
   ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 public/audio/test-track.mp3
   node scripts/register-xp-revision.mjs --built-in test-120 --audio-duration 64.026122
   # With server-only credentials for the confirmed existing project and reviewed audio:
   node scripts/register-xp-revision.mjs --built-in test-120 --audio-duration 64.026122 --apply --approve
   ```

   Independently measure/review BEWILDERMENT's audio before registration, then use
   `--built-in bewilderment-insane --side right|left --audio-duration <measured>`.
   Both sides need their own digest. Other charts accept `--file <normalized-chart.json>`
   containing id/bpm/offset/laneCount/notes and both FNF sides where applicable.
   Existing unreviewed/changed revisions remain playable but XP-ineligible.
5. In a controlled authenticated smoke test, enable DB policy and a private frontend
   build with `VITE_XP_ENABLED=true`. Verify Session owner/JWT, actual score save,
   replay verification, first award, ambiguous-timeout resend, privacy public API
   and cross-account denial. Free and Supporter score/accuracy/totals must match.
   Test iPhone/Safari Web Audio/touch/rotation/RETRY and realistic dense charts.
6. Only after those checks and rules review, enable publication intentionally:
   `UPDATE public.xp_policy SET enabled=true WHERE id=true`, build with
   `VITE_XP_ENABLED=true`, merge reviewed PR and Lovable Publish. Turning either
   flag OFF hides growth UI and prevents new XP Session issuance/awards. Owner
   settings remain stored. Existing Score/TOTAL SCORE continues normally.

## Repeatable local verification

`npm test`, `npm run typecheck`, `npm run build` and changed-file ESLint.
PGlite applies every migration and exercises actual PostgreSQL RLS/grants/RPCs.
For true overlapping transactions, use a disposable **loopback-only** PostgreSQL:

```sh
docker run --rm -d --name pulse-xp-test-db -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55432:5432 postgres:17-alpine
node tests/postgres-xp.integration.mjs
docker stop pulse-xp-test-db
```

The runner initializes fixture auth/storage schemas and refuses remote hosts.
It does not read production URLs/keys. Do not use an existing data-bearing DB.
See [the dated verification report](verification/verified-xp-2026-10-11.md).
