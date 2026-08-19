# TransVoice voice-only Coach handoff

> **Historical 2026-07-22 handoff.** Its voice-only product laws remain valid,
> but its stacked 120/240 instruction-fit implementation is superseded by
> `docs/VOICE_COACH_MEMORY_CONTRACT.md` and the 2026-07-25 addendum in
> `design/frontend/verify/critique.md`.

Date: 2026-07-22
Project: `/home/USER
Status: implemented and deployed; code/design re-review passed; current physical replay blocked by absent ADB device

## Read this first: immutable product contract

TransVoice Coach is a **spoken vocal-practice lesson**. It is not, and must
never be redesigned as, a text messaging or chat experience.

These are product laws, not suggestions:

1. The learner speaks to the coach and hears the coach speak back. Coach has no
   typed reply, composer, send control, message bubbles, transcript, or visible
   conversation history.
2. Coach has exactly two persistent interactive controls: a compact preset
   control in the top-right and one learner-owned Start/End session control.
3. The only persistent text region is an instructional canvas. It holds the
   current word or sentence and, when useful, pronunciation respelling for the
   chosen target voice. It is not a coach-message pane.
4. A preset is a named voice sample that the learner previously uploaded. A new
   upload receives a name and becomes another preset.
5. The selected preset is the tutor’s voice for every tutor utterance. There is
   no separate target-voice playback button, listen-back button, provider
   selector, or “hear it” action. If cloning that exact reference fails, the
   tutor stays silent and the UI reports the failure honestly.
6. Start enters or resumes the core practice immediately. There is no automatic
   greeting ceremony, scope interrogation, or forced warm-up. A warm-up happens
   only when the learner explicitly asks for one.
7. Stop is available at all times and belongs only to the learner. The coach
   never suggests ending, stopping, taking a break, resting, or returning later.
   When vocal safety requires adjustment, the coach lowers effort or changes
   the exercise while the session remains active.
8. Restart means continuation. The coach knows the selected preset, lesson
   position, current practice item, when learner and coach last spoke, and that
   the session was restarted. It resumes naturally instead of onboarding again.
9. Coach fits a single phone viewport. The document and its persistent content
   do not scroll. The preset popover may scroll internally only while open.

Any future proposal that violates one of these laws requires an explicit
product decision from the owner. It must not arrive as an incidental UI
refactor, accessibility workaround, fallback, or “helpful” feature.

## Current experience

The visible document is a fixed `100dvh` Coach surface:

- top-right: selected named reference preset and contextual upload/select menu;
- center: current practice line plus optional pronunciation spelling;
- below the action only when necessary: compact non-interactive error text;
- centred horizontally at `66.667dvh`: the single Start/End button, one-third
  of the viewport up from the bottom.

Routine lifecycle labels are not visible. The action says only `Start` or
`End`. Its normal geometry is 320×58 CSS px (320×52 on a 620px-tall viewport).
The instruction canvas accepts a normalized practice line through 120
characters and pronunciation through 240; it selects normal/compact/dense type
without scrolling. Oversized input becomes `Practice line unavailable.` in the
same canvas rather than exposing a clipped prefix.

The mature cockpit implementation still supplies internal transport and lesson
orchestration, but its historical thread, composer, replay, mode, and auxiliary
controls are hidden, non-interactive, and removed from accessibility exposure.
Do not surface those nodes as Coach UI.

Primary surface files:

- `frontend/src/voice/coach-surface.ts`
- `frontend/src/voice/standalone-app.ts`
- `frontend/voice-tutor-app.html`
- `frontend/src/voice/coach-surface.test.ts`

## Runtime flow

```text
learner Start
  → restore existing session/checkpoint and exact reference preset
  → phone records one utterance with local automatic turn boundary
  → gateway validates and forwards audio to Parakeet ASR
  → transcript enters the internal coach-turn pipeline (never the UI)
  → current line/pronunciation and lesson position are checkpointed
  → coach response is synthesized only through VoxCPM with selected reference
  → playback completes and capture resumes

learner End at any active point
  → capture and tutor playback cancel
  → lesson is checkpointed as stopped, not ended
  → no farewell, break advice, or session destruction
```

The implementation distinguishes streaming capture from recorded automatic
capture. Android WebView uses recorded MediaRecorder input even when a live ASR
socket is unavailable. Do not collapse those capabilities into one `live`
boolean again.

Primary input and speech files:

- `backend/voice-input-asr.js`
- `backend/voice-standalone-config.js`
- `backend/voice-standalone-runtime.js`
- `frontend/src/voice/coach-input.ts`
- `frontend/src/voice/coach-speech.ts`

## Application memory contract

The rich standalone session store remains authoritative for the internal lesson
runtime. Learner context contains a compact locator and continuation record at
`voice.coachCheckpoint` under schema `sloane.learner_context.v5`.

The checkpoint stores only what a spoken lesson needs to continue:

- continuing session id and active/stopped state;
- started, stopped, restarted, last learner-spoke, last coach-spoke, last
  activity, and updated timestamps;
- restart count;
- lesson status, stage, focus, lesson id, exercise id, and exercise index;
- current line id/text, pronunciation cue, and practice-card id;
- exact preset id/name/reference clip and target identity.

It must never become a chat archive. It contains no transcript, learner
utterance text, coach prose, thread, message list, or audio. Internal model
context can remain in the authoritative session store for continuity, but it is
not rendered and is not duplicated into learner memory.

Checkpoint writes occur at session start/restart, Stop, learner speech capture,
successful preset-bound coach playback, practice-line change, guardian cue,
finalized take, and page hide. Generating coach prose does not count as speaking;
only a content-free post-playback acknowledgement advances `lastCoachSpokeAt`.
Nested updates merge rather than erasing sibling state. Resetting learner memory
clears the checkpoint. Failure to persist must not interrupt the live lesson;
emit a bounded categorical witness and retry at the next checkpoint seam.

Primary memory files:

- `backend/learner-context-service.js`
- `backend/learner-context-route-handlers.js`
- `backend/learner-context-coach-checkpoint.test.js`
- `backend/voice-coach-continuity.test.js`

## Preset and tutor-voice invariant

Only saved presets with a resolvable uploaded reference sample belong in the
Coach preset menu. Upload collects a bounded name and audio file, saves it, and
selects it. Built-in style labels are not substitutes for user voice samples.

On every tutor utterance, the backend resolves the session’s selected reference
clip. VoxCPM cloned speech is the only valid result. The frontend rejects an
unresolved-reference response and never calls browser `speechSynthesis` while a
reference preset is selected.

## Coach policy invariant

Policy and sanitizer code remove automatic welcome/gap/warm-up/scope padding
and intercept coach-owned break or stop guidance. Vocal-safety handling changes
effort, sound, or exercise; it does not take the Stop decision away from the
learner.

Relevant files:

- `backend/coaching/signal-builder.js`
- `backend/coaching/renderer-client.js`
- `backend/coaching/safety-gates.js`
- `backend/coaching/sanitizer.js`
- `backend/lessons/guardian.js`
- `backend/lessons/lesson-planner.js`
- `backend/deeptutor-voice-adapter.js`

## Telemetry and privacy

Telemetry witnesses only lifecycle and seam outcomes: boot, control activation,
observed control effect, ASR/TTS readiness/failure, checkpoint success/failure,
and bounded timing/status fields. It does not persist transcript, practice text,
audio, preset names, tokens, raw session ids, or private exception payloads.

The visible controls emit both activation and observed-effect witnesses so a
tap that produced no state change is diagnosable. Boot distinguishes early
HTML, bundle-ready, and application-ready failure classes.

Turn telemetry uses a derived correlation alias rather than serializing raw
turn or session identifiers. Fallback causes are closed categorical values;
exception messages cannot enter the telemetry payload.

## Local service configuration

Installed user-service drop-in:

`~/.config/systemd/user/voice-tutor-standalone.service.d/transvoice.conf`

Required recorded-ASR settings:

```text
VOICE_ASR_ENABLED=true
VOICE_ASR_URL=http://INTERNAL_HOST:PORT
VOICE_ASR_API_STYLE=simple
VOICE_ASR_LANGUAGE=en
VOICE_ASR_TIMEOUT_MS=10000
VOICE_ASR_LIVE_MODE=buffered
```

The service is `voice-tutor-standalone.service`. The Android package is
`net.sloane.voicetutor`; the connected test device used serial
`46271FDAQ000BC`. The phone loads the gateway’s `/app` surface through the
Tailscale path on port 3021.

## Verification receipts

Automated gates completed before independent review:

- frontend: 94 test files passed; 664 tests passed, 2 skipped;
- backend: 557/557 tests passed with an isolated test state root;
- production build: passed (bundle-size advisory only);
- whitespace gate: `git diff --check` passed.

Current deployed-browser receipts:

- `/app` serves `voice-runtime-bpU3v_2R.js`; its SHA-256 is
  `cd3e44520bec9d22839c59e13b89036fe6c17b2a0440920a65105caf66710de4`.
- zero console errors, page errors, failed requests, or viewport overflow at
  360/768/1280;
- visible persistent controls are exactly the Aster preset and Start;
- at 360×620 the Start centre is 413.328px versus a 413.333px two-thirds
  target, and the document is exactly 360×620 with no scroll;
- a worst-width 120-character line plus 240-character pronunciation remains
  fully inside the canvas and above the action;
- legacy controls are hidden, non-tabbable, and accessibility-isolated;
- reference audio is `preload=none`, with no boot audio or port-8430 request.

Independent fresh verdicts:

- CODE: PASS — replacement-start failure, unresolved-start cancellation,
  recorder-open acknowledgement, instruction bounds, template twins, and
  preload guards all crossed real consumers.
- CODE telemetry delta: PASS — oversized-instruction failures cross as
  content-free `practice-line-fallback / contract-drift /
  instruction-length-invalid`, never as a false Start/End control failure.
- DESIGN: PASS — no observable defects in the two-control hierarchy,
  short-viewport max-content state, or in-canvas recovery.
- RUNTIME: deployed browser PASS; overall physical certification BLOCKED only
  because `adb devices -l` currently returns no devices.

Independent seam receipts:

- Parakeet health was ready and a direct recorded-audio transcription returned
  the expected sentence when timestamps were requested;
- Aster speech generation returned HTTP 200 with reference resolution and voice
  cloning affirmed, and non-empty audio;
- public learner context exposed lesson/preset/practice continuity and no
  transcript or coach-thread field.

## Residual certification and triggers

Earlier builds proved physical Pixel microphone capture and the 411×809
no-scroll shell. Those receipts do not certify the newly repaired bundle. The
current physical gate is explicit: reconnect/authorize the Pixel, load
`voice-runtime-bpU3v_2R.js`, verify safe areas and Android font scale, exercise
Start→End while mic startup is pending and while capture is active, then speak
one disposable line through capture → ASR → coach → selected-reference cloned
TTS. Preserve categorical telemetry only.

Other replay triggers:

- ASR endpoint/model or multipart contract changes;
- VoxCPM reference-resolution header/contract changes;
- learner-context schema migration;
- preset upload/selection API changes;
- hidden cockpit DOM or boot-order changes;
- Android WebView or microphone-permission changes.

## Recovery rules

- ASR unavailable: do not pretend to hear; keep Stop available and show a short
  honest state.
- reference/TTS unavailable: do not substitute another voice; retain selection,
  stay silent, and show a short honest state.
- checkpoint write unavailable: keep in-memory practice alive and retry later.
- upload failure: retain the prior preset and avoid half-created menu entries.
- UI regression: restore the two-control surface; do not expose legacy chat or
  playback affordances as a shortcut.

## First commands for the next session

```bash
cd /home/USER
systemctl --user status voice-tutor-standalone.service --no-pager
curl -fsS http://127.0.0.1:3021/health
adb devices -l
cd frontend && npm test -- --run
cd .. && node --test backend/*.test.js backend/**/*.test.js
cd frontend && npm run build
```

Read this handoff, `studio/xna/coach-voice-only-implementation-plan.md`,
`design/frontend/verify/critique.md`, and
`design/frontend/verify/max-content-w360-h620.json` before changing Coach.
