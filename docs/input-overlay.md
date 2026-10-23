# Live input and Key Overlay

Pulse Lane routes live keyboard and Pointer Events through `InputLedger` and
judges each newly accepted source immediately against `AudioClock.nowAt()`.
There is no click/touch fallback, debounce or frame snapshot. A pointer is assigned to its initial lane for its entire gesture;
sliding between lanes was not implemented in the original input layer.

## Investigation and changes

The original source already tracked pointer IDs. The verified code defects were:

- A lane already held by any source suppressed a new source's attack, even when
  it was a separate finger or a keyboard press for a later note.
- Lost capture was not handled; capture failure had no outside-release fallback.
- Clearing inputs did not clear holding notes, allowing paused/cancelled holds
  to remain active until their ends.
- Input used handler execution time rather than the DOM edge timestamp. The
  last render time was already avoided, but event dispatch delays remained.
- Keyboard listener dependencies changed every render because the caller rebuilt
  the key mapping. Mapping content now controls registration; callbacks read
  current handlers. Release resolves the original source even after rebinding.

These code findings do not establish the cause of every reported iPhone symptom.
OS/browser events that never reach the app cannot be recovered or guaranteed.

`InputLedger.received` counts presses reaching the common entry point;
`accepted` counts distinct physical sources. Each accepted bar records its edge
start/end and judgement outcome (including `outside-window`). The settings input
test displays these counters. For diagnosis, distinguish no delivered pointerdown,
a delivered but inactive/duplicate source, and an accepted input outside the
existing judgement window. Inspect native events and bar records together; lack
of a note judgement alone does not demonstrate an event loss.

A lane remains active until its final source releases. Pointer up/cancel/lost
capture and the window fallback share an idempotent release. Blur, hidden tab,
pause, restart and unmount cancel outstanding sources. Cancelled holds fail;
cancellation is not a successful release. Input acceptance stops synchronously
when pausing, before waiting for audio pause completion.

DOM timestamps are normalized onto the performance timeline (including epoch
WebKit timestamps), then projected back from the current audio clock. Existing
score rules and judgement window constants are unchanged. The style-specific
early-input selection policy is documented below.

## Display and settings

The four columns are LEFT / DOWN / UP / RIGHT in every mode. They show the
configured keyboard codes, never fixed D/F/J/K labels. Touch and keyboard bars
use different colors; cancelled bars are red. The source caption is Touch,
Keyboard or Mixed and is marked LIVE. There is no auto-play/replay feature in
the current game, and no anti-cheat assertion or certification.

A held bar stays attached to its key and grows upward with real hold duration.
After release, the entire fixed-length bar travels upward. Very short taps have
a 3px minimum drawing height; their recorded durations remain unchanged.
History is clipped, independent of note scroll speed/direction, and bounded to
256 released bars plus active sources, with a 10-second retention limit. The
configured visible duration is 0.5–5 seconds. Overlay rendering reads the input
records; it does not generate judgements or notes.

Display defaults to ON, X 85%, Y 18%, scale 100%, key width 42px, key height
32px, gap 4px, history height 72px, opacity 80%, duration 2 seconds. The
**入力可視化** settings category exposes sliders and numeric inputs, a labelled
placement preview, center reset (X/Y 50%) and an overlay-only default reset.
The Input Visualization category contains the keyboard/touch input test, using the style selected for keybind editing in Controls.

Position is the card center, expressed as 0–100% of the gameplay area below the
HUD, inside safe-area insets and an 8px margin. Dimensions are unscaled CSS px;
scale and opacity are percentages. The absolute click-through layer consumes no
layout space. Its displayed center is clamped, and an oversized card is scaled
down to fit without changing the saved preference. ResizeObserver and window
resize update its bounds. The overlay cannot intercept gameplay touch input.

Browser preferences use the existing hydrated localStorage key with general
settings version 5 (preserving version 4 style-specific keys and preview preferences). Legacy left/right preferences migrate to X 15%/85%; absent
new values get defaults. Device audio timing settings remain version 2 and
unchanged. No DB migration is needed for these browser display preferences.

The selected FNF bank is always horizontally centered; its opponent bank keeps
its side placement. Middle-scroll now changes opponent opacity only. The shared
non-FNF renderer remains centered. Judgment Y still follows judgmentPosition
and scroll direction. A duplicated CSS/inline translation of common-renderer
notes was removed so notes and receptors share their lane centers.

## Style-specific early input (2026-10-12)

Mania keeps its existing ±MISS-window candidate search and early MISS behavior.
FNF filters future notes beyond the GOOD window before choosing the nearest
candidate. Thus an earlier press is recorded and visualized, but does not consume
a note, apply a judgment, break combo, change accuracy/score, or play MISS sound.
A late, still-eligible note in the same lane remains a candidate even if a closer
future note is too early. Window sizes, score calculation and the automatic
passed-note MISS path are unchanged. This game has no separate HP subsystem.

Input is never buffered: keeping an early key/finger held does not hit a tap or
start a hold later. Hold-head acceptance uses the selected style policy; accepted
hold continuation/release/cancellation retains the existing behavior. GameScreen
passes the actual selected style to the engine, independently of note skin and
FNF metadata, so switching styles updates the input callback immediately.

Official [Funkin PlayState.hx](https://github.com/FunkinCrew/Funkin/blob/main/source/funkin/play/PlayState.hx)
was retrieved on 2026-10-12. `processInputQueue()` selects `getNotesMayHit()` and
handles press/release separately; its `FEATURE_GHOST_TAPPING` branches can either
allow an empty-direction press or call `ghostNoteMiss()`. Official behavior is
feature-dependent. Pulse Lane implements the requested acceptance conditions;
it does not infer them from an engine name.

For the current validation and screenshots, see
[centered-input-2026-10-12.md](verification/centered-input-2026-10-12.md).

## Validation (2026-10-09)

- Vitest: 40 tests pass, including 16 new input/display regression cases.
- TypeScript typecheck and production build pass.
- ESLint on changed game/settings components: no errors or warnings.
- Local Chromium: CLASSIC, OSU!MANIA, FNF skins; four held keyboard keys;
  390x844 portrait and 844x390 landscape layout; CDP four-touch chord;
  mixed same-lane ownership, cancellation; configured key A and reload
  persistence; scrollable settings input test; overlay OFF.
- Regression tests cover sub-frame taps, repeated attacks, 2/3/4 lanes,
  multiple owners, holds, blur, pause/restart/unmount, repeat suppression,
  outside/cancel/lost capture, compatibility click, timestamp delay, key mapping
  updates, bounded memory, overlay score equivalence, and FNF metadata direction.

Screenshots were captured locally in `work/` during verification.

Not verified: physical iPhone/Safari; public production page (environment proxy
returns 403); notch/home-indicator behavior on real hardware; extremely delayed
OS dispatch; production deployment. Chromium/CDP checks are not iPhone tests.
The final merge/push outcome is reported in chat separately.

Before release on iPhone, test fast repeated taps; 2/3/4 fingers; a hold while
another lane is tapped; same-lane multiple owners; finger drift outside the
surface; OS cancellation; background/foreground and pause/restart; portrait and
landscape with browser bars changing; safe areas; all skins and scroll directions.
Compare received/accepted records and outcomes without widening windows.

## References

- MDN Pointer Events and setPointerCapture: live fetch blocked by the environment
  policy; not claimed as reviewed in this session.
- FunkinCrew `FunkinHitbox.hx` on main: retrieved 2026-10-09; confirms four
  direction hints and distinct down/up signals. Native Haxe input was not copied
  into the browser code.
- earph0n3/KeyOverlayRust README: retrieved 2026-10-09; describes animated hit
  bars, input labels, speed and click-through display. Its code was not copied.
