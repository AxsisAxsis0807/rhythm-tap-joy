# Pulse Lane BOTPLAY v1 implementation and audit

## Baseline and scope

- Base: latest fetched `origin/main`, `599b7d9b58d9fcd1bb77d035884c8527bc5c3b77` (2026-11-16).
- Branch: `feat/botplay-v1`. No main merge, deployment, production requests, billing operations, or schema/migration changes.
- Existing `RunConfiguration.autoplay` is the only automatic-play flag. `createRunConfiguration` still determines competitive eligibility.
- CLASSIC remains a mania visual skin; neither style's judgement windows or score rules changed.

## Implementation

`Botplay` builds sorted press/release edges from `GameplayCore.notes` (already produced by `buildRuntimeNotes`). A cursor consumes every due edge once. The horizon is AudioClock song time plus the frozen timing offset. Input edges use authored time minus that offset, because `GameplayCore.process` adds it. `advance` itself expects chart time and does not apply the input offset. Before each edge, advance at that edge's authored time; finish by advancing to the horizon. This catches up dropped frames without first applying a late auto-MISS. Sorting costs O(n log n) at START; frames do not scan the chart again.

Each note owns a distinct numeric source. Tap sources release at the same authored time; hold sources release at their tail, after the existing `advance` hold-completion path. BOT holds are indexed by note ID rather than lane to avoid overwriting overlapping same-lane holds. Human holds retain their original lane keys, cancellation, early-release scoring, Ghost Tap, and early-MISS rules. BOT early release is still judged by the existing rule; it is not automatically forgiven.

BOT pause preserves internal sources/holds while the hook stops scheduling. Resume uses the existing AudioClock pause position and countdown. The cursor never rewinds. Completion waits for the last tail as well as the audio duration. Human pause still clears inputs and fails an interrupted hold as before.

SongDetail defaults OFF and passes the selected boolean through both RhythmHub entry paths. The selected value is captured before asynchronous START work and frozen on GameScreen mount, including RETRY. Returning to detail creates an OFF selection. The game configuration is captured before audio unlock. TouchInput, keyboard listeners, pressLane, and releaseLane cannot inject BOT input. A separate HUD row reserves badge space; lane pulses and judgement display use the BOT chart-time horizon without changing scoring.

BOT inputs bypass ReplayRecorder append; no completed competitive replay is exposed. Replay format/version and manual recordings are unchanged.

## Persistence and growth protections

- Normal result hook, explicit exit/retry persistence, enqueue, persisted score retry, and final ranking transport all check eligibility.
- Both the top-level flag and the configuration are checked. `configuration.autoplay=true` is refused even if `competitive=true` is incorrectly supplied.
- XP prepare clears any previous session and returns before transport for BOT/noncompetitive runs.
- XP evidence effect, enqueue, and persisted retry also reject BOT evidence.
- BOT result renders neither ResultXpCard nor a save-success/guest-save prompt.
- No standalone achievement-unlock endpoint exists in the current source. Saved result aggregates and verified XP/first-clear paths are the relevant durable progress paths, and BOT never enters them.
- Existing SQL `begin_verified_play` rejection of autoplay is unchanged and covered using an isolated PGlite database. These tests do not connect to or change the production database.

## Five audit passes

| Pass | Findings and resolution | Verification |
| --- | --- | --- |
| 1. Functionality | Lane-keyed holds could overwrite a previous overlapping BOT hold. Use note IDs only in BOT mode and unique sources for every head. Keep normal release rules. | All heads PERFECT; simultaneous four-lane chords, 250 rapid notes, mixed taps/holds, overlapping same-lane holds, and multiple holds complete; early BOT release still fails. |
| 2. Time/synchronization | Applying the input offset to advance a second time, or auto-missing before catch-up, would lose notes. Use raw input times and authored advance times. Preserve BOT holds through pause and wait for final tails. | FNF/mania at -500/-125/0/+125/+500ms; whole-chart dropped frame equals fine frames; repeated advance does not double-score; hook pause/resume does not process paused frames. |
| 3. Existing behavior | Manual processing must keep original semantics. Changes are conditional on frozen autoplay. Offset-aware BOT judgement animation is independent of score calculation. | Existing Ghost Tap, mania early-MISS, manual holds/chords, keybind/settings/rendering, manual pause, replay, ranking and XP suites pass. Real component + simulated Web Audio integration covers FNF/mania/CLASSIC, RETRY, and return to manual selection. |
| 4. Security/records | Top-level competitive alone could admit stale/incorrectly wrapped BOT results. Check configuration at all local boundaries, including score and XP retries. | Forged competitive flags refused before score auth/RPC; BOT cannot enqueue, prepare XP, or submit evidence; old retry envelope discarded; subsequent manual run saves and prepares XP. SQL refuses BOT sessions. |
| 5. Final quality | Reviewed changed files, event ordering, source lifecycle, async capture, finish boundary, rendering badge stacking and replay compatibility. Fixed badge overlay stacking and offset-aware hit display. | Typecheck, all tests, build, ESLint for all changed TS/TSX files, and git diff whitespace check pass. |

## Required test coverage map

| Requirement IDs | Evidence |
| --- | --- |
| A1–A10 | `tests/botplay.test.ts`: both styles, five offsets, chords, rapid notes, overlapping/multiple holds, whole-chart catch-up, repeat frames, complete sources/notes/tails. `botplay-hook.test.tsx`: live scheduling/completion. |
| B11–B19 | `fnf-gameplay-integration.test.tsx`: OFF default, ON/OFF callbacks, all display modes, no live switch, badge, result exclusion notice, input isolation, fixed BOT RETRY, actual hub return to OFF/manual play. Hook test also changes options midrun and verifies the active configuration remains BOT. |
| C20–C25 | `player-ranking-client`, `play-result-queue`, `play-results`, `botplay-xp-session`, `xp-evidence-queue`, `xp-db`: all local persistence layers, session/evidence exclusion, no progress transport, and following manual play. No independent achievement subsystem to exercise. |
| D26–D34 | Existing judgement-policy, style-input-policy, input, fnf-gameplay-integration, game-settings-engine, rendering-settings, play-verifier, play-results, ranking-db, and XP test suites. |

Final validation: `npm run typecheck`; `npm test` (26 files, 293 tests); `npm run build`; ESLint on every changed TypeScript/TSX file; `git diff --check`.

## Security limits requiring separate policy work

`public.record_play_result` (`20261007090000_global_score_ranking_hardening.sql`) is executable by authenticated users and accepts score/count aggregates without a server-held run configuration, canonical chart replay, or autoplay flag. It checks arithmetic and ownership, but a modified client can skip these local guards and directly submit plausible fabricated aggregates. This change cannot establish an anti-cheat guarantee for that API. A separate design could require server-issued sessions and authoritative result verification; that would change the backend contract and is deliberately outside this PR.

The XP server rejects autoplay flags and validates replay timelines/configuration. It does not prove a client is human when a modified client labels synthesized inputs as manual. No new claim of human-input attestation is made.

## Unverified

- Physical iPhone Safari, real touch latency, audio output synchronization, orientation/safe-area layout, and long-running thermal/frame-drop behavior.
- Pixel-level browser layout and audible playback. Integration tests use jsdom and a simulated Web Audio platform, not physical hardware or a real browser renderer.
- Live production ranking/XP end-to-end requests were intentionally not performed. Database tests use disposable local PGlite fixtures only.
