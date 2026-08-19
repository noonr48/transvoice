# Deep-review: TransVoice voice-only Coach thumb-zone refinement

> **Historical 2026-07-22 review.** Its stacked 120/240 instruction proof is
> superseded by the one-representation, native text-enlargement contract and
> receipts in `docs/VOICE_COACH_MEMORY_CONTRACT.md` and
> `design/frontend/verify/critique.md`.

Band: GATED (F=3 C=3 I=1 S=1) · Medium: code + design + runtime · Date:
2026-07-22 · Status: BLOCKED only on current-bundle physical Android proof

## SPEC (R-G1 — before looking at the work)

ASK (VERBATIM): “We can aslo move the start/ end button up a bit so it's not
right at the bottom. We literally want to make it as easy to start as possible.
think 1/3 up the phone screen, where the thumb is most comfortable to land on.
Drop the words also, no need to descibe how the stardt and stop button works.
it's just a start/ end text on the bottom. We litreally need this as next to no
friction as physically possible to start.”

Continuing instruction (VERBATIM): “Yes. now let's make a plan and make that
happen. Make sure the memory system on the application is properly perepared
for it”

| # | clause | evidence artifact | verdict |
|---|---|---|---|
| 1 | Move the action away from the bottom to one-third up the phone | `--coach-action-center-y: 66.667dvh`; deployed 360×620 centre 413.328px vs target 413.333px | MET |
| 2 | Make starting physically low-friction | 320×58 normal / 320×52 short-viewport touch target; persistent and enabled through startup | MET |
| 3 | Drop explanatory words; use Start/End | surface render and tests assert exactly `Start` / `End`; routine status is visually clipped | MET |
| 4 | Coach remains a spoken lesson, never messaging | exactly two persistent surface controls, one instruction canvas, no Coach thread/composer/send/replay | MET |
| 5 | No-scroll single viewport | design-verify plus 360×620 max-content probe | MET in deployed browser; physical current-bundle replay pending |
| 6 | Continuation memory remains prepared | schema-v5 compact checkpoint, start/restart/end crossings, no transcript/audio/thread fields | MET |

Instructions:

| # | instruction | honored — evidence |
|---|---|---|
| 1 | Selected preset is always the tutor voice | selected-reference TTS fails closed before VoxCPM if the sample cannot resolve; no generic fallback | YES |
| 2 | Learner alone starts/ends; no forced warm-up or coach break suggestion | lifecycle owned by one surface toggle; policy/sanitizer and stale-copy checks | YES |
| 3 | Preserve a fixed, simple Coach surface | `#tv-coach-surface` fixed 100dvh; two controls; one canvas; no document scroll | YES |
| 4 | Document durable application memory | implementation plan, handoff, design artifacts, project events, and guarded SLOANE memory handoff | IN PROGRESS until final memory commit |

## EVIDENCE (R-G2 — fresh, executed, pasted)

RAN (last action after this sheet): `git diff --check` → exit 0, no output.

GREEN:

- frontend: `Test Files 94 passed (94)`; `Tests 664 passed | 2 skipped (666)`;
- backend, isolated state root: `tests 557`, `pass 557`, `fail 0`;
- focused crossing set: 100 passed, 2 skipped; backend continuity set: 20/20;
- production build: 110 modules transformed, completed successfully; current JS
  `voice-runtime-bpU3v_2R.js`;
- design lint: 22 inherited warnings, 0 error-severity;
- design-verify: zero console/page/request/overflow errors at 360/768/1280;
- max-content 360×620: every check true, runtime failures empty, `pass: true`.

NOT-HAPPY:

- Start → End → Start followed by rejected rollback remains at Start, reports
  `session-start-failed`, and does not automatically invoke a second start;
- aborting an unresolved `startListening` invokes the real cancellation seam,
  settles false, and awaits stopped rollback;
- 121-character phrase or 241-character pronunciation becomes the complete
  in-canvas recovery rather than a prefix;
- 120 `W` characters plus 240 `W` pronunciation characters fit a 360×620
  canvas without document/canvas scrolling or action overlap.

PROOF-CREATION:

- added combined replacement-intent/rejected-rollback regression;
- changed cancellation regression so the promise settles only because abort
  calls `cancelListening`, not because the test manually resolves it;
- added exact-boundary/oversize/once-per-invalid-episode surface checks;
- added `studio/code/verify-coach-thumb-zone.mjs` and its JSON/PNG receipts;
- added template preload and stale stop-guidance assertions.

INHERITED:

- checkpoint, selected-reference TTS, privacy telemetry, and policy contracts
  were re-run in the 557-test backend suite rather than accepted from an older
  report.

## WIRING (R-G2.5)

CONSUMERS:

- `startVoiceOnlyCoachLifecycle` → one production caller in
  `standalone-app.ts`; all other hits are its focused tests;
- abort → `runtime.stopCoachListening(true)` → transport runtime service →
  `inputController.stop()` → `selectOwner()` → old owner AbortController and
  cancellation promise;
- recorded Start → `MediaRecorder.onstart` acknowledgement → continuous capture
  enable → active/restart checkpoint;
- instruction text → `getCurrentPracticeLineText` / pronunciation selector →
  surface normalization/bounds/density → deployed Coach canvas;
- Vite build → `dist/voice-tutor-app.html` +
  `dist/assets/voice-runtime-bpU3v_2R.js` → gateway `/app`.

REACHABILITY: `voice-tutor-standalone.service` was rebuilt/restarted and `/app`
served the current bundle. `/health`, `/voice/health`, and
`/voice/standalone/readiness` returned healthy/online responses.

ACTIVATION: current deployed browser loaded the new bundle; physical Android
activation remains unverified because `adb devices -l` is empty.

TWINS: `standalone-template.ts` and
`templates/voice-tutor-template.html` both removed the stale coach-owned Stop
line and both retain `preload="none"`; embedded/template tests cross the pair.

CONSISTENCY: live geometry tokens and `design/frontend/tokens.css` both record
the two-thirds action centre and dense gap; the shelf and live type family both
use Manrope.

INSTRUMENTATION: existing privacy-safe control effects now witness the only two
persistent controls. New invalid instruction handling uses the bounded category
`instruction-length-invalid`; no text content is emitted. Start failure remains
`session-start-failed`. Browser boot, health, request, and failure telemetry were
replayed with zero rejected client events in the reviewed run.

DERIVED-DIFFS: build output was regenerated and inspected through its served
bundle identity/hash. Design-verify regenerated runtime JSON and screenshots;
the max-content probe regenerated one JSON and one PNG. No unexpected request,
scroll, third control, or chat surface appeared.

RIPPLE: lifecycle type change was applied to every caller/test; instruction
bounds were added to source, CSS, tests, UX states, structure, critique, plan,
and handoff. Frontier empty except the explicit phone gate.

## ADVERSARIAL (R-G3)

MIRROR:

- WEAKEST: browser automation cannot prove Android permission/capture or
  selected-reference audio playback → current ADB/device probe performed and
  remains empty.
- MISSING: short phone situation shift performed at 360×620 with maximum
  supported worst-width strings → no clipping, scroll, or overlap found.
- PUNTS:
  - normalized whitespace defines “verbatim” at the surface boundary; repeated
    spacing is not currently treated as pronunciation data;
  - 120/240 are explicit UI contracts aligned to the backend 120-character
    phrase law, not user-configurable limits;
  - physical large-font and safe-area validation is deferred only because the
    phone is absent, not replaced by desktop-browser evidence.

PREMORTEM:

1. A future live-WebSocket or browser-recognition input path could acknowledge
   Start before first-frame/onstart; current production capability is recorded
   MediaRecorder and is correctly acknowledged.
2. A future lesson source could bypass the 120/240 contract; the surface must
   continue failing atomically rather than adding scroll or truncation.
3. Hidden legacy runtime nodes could regain focus/visibility; keep the exact-two
   runtime/tab-order probe.

FIX-CLAIMS:

- “End immediately cancels pending input” → lifecycle test plus reviewer trace
  through `inputController.stop/selectOwner/abortOwner`;
- “active checkpoint follows recorder-open” → `MediaRecorder.onstart` test and
  production capability check (`recordedCapture:true`, `liveCapture:false`);
- “max supported text fits” → max-content deployed JSON and PNG;
- “no boot audio” → preload test and runtime request ledger.

CLASS SWEEP: searched lifecycle callers, stop/cancel chain, `MediaRecorder`
open paths, 500/120/240 length literals, stale Stop/break copy, reference-player
preload, and hidden/visible Coach controls. The class fixes landed in the owning
surface/lifecycle/template pairs rather than one screenshot-only branch.

REVIEWER (GATED): independent read-only CODE, DESIGN, and RUNTIME reviewers were
dispatched with the product law, repaired seams, evidence list, and adversarial
focus; rationale was withheld.

- CODE → PASS, no blockers;
- CODE telemetry delta → PASS; instruction-length failure remains content-free
  and is no longer attributed to the Start/End control;
- DESIGN → PASS, no blockers;
- RUNTIME → deployed browser PASS; overall BLOCKED only by absent Android device;
- cycles used: 2/2 (initial blocker round, repaired fresh re-review).

## CLOSE (R-G4)

| clause/instruction | change | evidence |
|---|---|---|
| Thumb-zone placement | fixed action centre at 66.667dvh | deployed 360×620 delta −0.005px |
| Start/End only | surface vocabulary and clipped routine state | source/static test + screenshot |
| Near-zero friction | one wide always-available action | 320×52/58 geometry + pending-cancel test |
| Not messaging | strict surface boundary and inaccessible legacy host | exact control/tab counts + design review PASS |
| No scroll | bounded density/atomic invalid recovery | max-content JSON/PNG + unit bounds |
| Prepared memory | resumable checkpoint and honest lifecycle ordering | backend continuity suite + lifecycle regressions |

RESIDUALS:

- physical release evidence: no authorized ADB device → fires as soon as the
  Pixel reconnects; run current-bundle safe-area/font, pending/active Start→End,
  mic, and full spoken turn checks;
- future capture capability: live WebSocket/browser recognition do not yet have
  the same recorder-open-strength acknowledgement → revisit if either becomes
  the advertised production input path;
- normalized spelling whitespace: repeated spaces are collapsed → revisit if
  pronunciation notation intentionally assigns meaning to repeated spacing.

ACTIVATION:

- source/build/service: LIVE now on localhost/tailnet gateway port 3021;
- current browser design/runtime: LIVE and independently passed;
- physical Android current bundle: INERT until the Pixel is USB-connected and
  authorized (owner action: reconnect/unlock/accept ADB if prompted).

TRIAD:

- changed: action geometry/copy, lifecycle cancellation/fail-closed races,
  bounded instruction rendering, stale template guidance, preload guard,
  verification artifacts and documentation;
- evidence: 664 frontend + 557 backend passes, build, design lint/verify,
  360×620 stress proof, CODE PASS, DESIGN PASS, deployed-browser runtime PASS;
- blocked: physical Android rendering/mic/Start→End/full spoken turn because no
  device is visible to ADB.

STOP: code/design/deployed-browser clean pass; physical runtime gate remains
open → Status: BLOCKED, not falsely closed.
