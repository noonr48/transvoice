# TransVoice Coach: voice-only implementation contract

> **Historical 2026-07-22 plan.** Its stacked 120/240 instruction-fit details
> are superseded by `docs/VOICE_COACH_MEMORY_CONTRACT.md` and the 2026-07-25
> current receipt in `design/frontend/verify/critique.md`.

Date: 2026-07-22
Mode: Build
Status: implemented and deployed; code/design review passed; physical Android replay pending

## Mission

Make Coach feel like one continuing, spoken TransVoice lesson. The learner and
coach talk. The screen supports that spoken lesson; it does not become a place
where either party messages the other.

The smallest complete Coach surface has exactly:

1. one compact preset control in the top-right;
2. one instructional canvas for the current word, sentence, or pronunciation
   respelling; and
3. one Start/End session control, owned by the learner.

The surface must fit one phone viewport without document or nested scrolling.

## Non-negotiable product laws

- Coach is a spoken vocal-practice lesson, never a text-chat interface.
- No typed reply, composer, send button, chat bubbles, message history, or
  transcript is visible in Coach.
- Presets are named, previously uploaded reference-voice samples.
- Selecting a preset selects the tutor's voice for every tutor utterance.
- There is no separate “hear target,” replay, listen-back, or voice-provider
  choice in Coach. If the selected reference cannot be used, the tutor stays
  silent and reports an honest compact status; it never substitutes a generic
  browser voice.
- Start enters or resumes the core lesson immediately. A warm-up happens only
  when the learner explicitly asks for one.
- Stop is always available and belongs exclusively to the learner. The tutor
  never recommends a break, stopping, resting, or time away. Safety responses
  may reduce effort, change the exercise, or ask the learner to use a gentler
  sound while the session remains active.
- Restart resumes the same lesson, line, focus, and selected preset. It is not a
  new greeting, onboarding flow, or forced warm-up.

## Evidence ledger

| Seam | Existing evidence | Required repair |
|---|---|---|
| Phone speech input | Android WebView lacks a usable browser SpeechRecognition path; `coach-input.ts` already records audio and posts `/voice/input/turn` | Enable the standalone gateway's backend ASR bridge and proxy recorded audio to the configured Parakeet `/transcribe` endpoint |
| Tutor speech | VoxCPM already resolves `session.voiceState.referenceClipId` server-side | Ban browser speech fallback whenever a reference preset is selected; fail visibly and silently |
| Preset selection | Runtime selection already writes selected preset and reference identity into the session | Expose a minimal surface bridge and render only reference presets plus upload/name |
| Session continuity | Durable session store retains lesson and voice state; frontend retains a session id | Add a compact learner-memory checkpoint that locates and describes the continuing session; resume it instead of creating blank sessions |
| Coach UI | Current mobile overlay hides most cockpit UI but still exposes a thread, composer, Hear, replay, scope, and per-turn orb | Replace it with the strict two-control surface and one canvas |
| Lesson opening | Greeting builder can ask scope, announce a warm-up, and add gap chatter | Resume directly at the current practice point; remove automatic scope/warm-up/padding |
| Human authority | Current policy can recommend rest or stopping | Reword to lower effort/change exercise without telling the learner to stop |

## Ownership and persistence

The existing standalone session store is authoritative for rich, resumable
runtime state: lesson state, current practice card, target/reference binding,
recent measurement, and internal coach context. Internal context may be retained
for model continuity but must never be rendered as a message history.

The learner-context store owns a compact `voice.coachCheckpoint` index. It is
not a second transcript and must not contain learner speech, coach prose, audio,
or message arrays.

Checkpoint schema (`sloane.learner_context.v5`):

```json
{
  "sessionId": "string|null",
  "state": "active|stopped",
  "startedAt": 0,
  "stoppedAt": 0,
  "lastRestartedAt": 0,
  "restartCount": 0,
  "lastSpokeAt": 0,
  "lastActivityAt": 0,
  "updatedAt": 0,
  "lesson": {
    "status": "string|null",
    "stage": "string|null",
    "focus": "string|null",
    "lessonId": "string|null",
    "exerciseId": "string|null",
    "exerciseIndex": 0
  },
  "practice": {
    "lineId": "string|null",
    "text": "string|null",
    "pronunciation": "string|null",
    "cardId": "string|null"
  },
  "preset": {
    "id": "string|null",
    "name": "string|null",
    "referenceClipId": "string|null",
    "targetPreset": "string|null",
    "targetSource": "string|null",
    "targetProfileId": "string|null"
  }
}
```

All text is bounded. Patch updates merge nested objects, normalize enums and
timestamps, and are idempotent. Resetting learner memory clears the checkpoint.
Snapshots expose it at the top level and inside `learnerContext`.

Checkpoint events contain categorical metadata only: state, restart count,
whether a line/preset is present, and update reason. They do not copy practice
text, voice names, or raw session/preset/reference identifiers into the event
ledger.

## Session state machine

```text
STOPPED -- learner presses Start --> LISTENING
LISTENING -- speech captured ------> THINKING
THINKING -- tutor audio begins ----> SPEAKING
SPEAKING -- playback completes ----> LISTENING
any active state -- learner Stop --> STOPPED
```

- Start/restart restores the checkpointed session if it still exists, binds its
  preset, keeps its current lesson point, increments `restartCount`, records
  `lastRestartedAt`, and begins listening.
- Stop cancels capture and tutor playback, records `stoppedAt`, and checkpoints
  the lesson. It does not mark the session ended or write a farewell.
- A completed speech capture records `lastSpokeAt` before coaching begins.
- Page hide checkpoints as stopped/paused without destroying the session.
- The coach never transitions the whole session to STOPPED.

## Voice-input boundary

The phone records one utterance at a time while the tutor is not speaking. The
gateway validates MIME type and decoded size, forwards multipart audio to the
configured ASR service, normalizes the transcript, and feeds the resulting text
to the existing internal coach-turn pipeline. The transcript is transport data,
not UI content.

Configuration:

```text
VOICE_ASR_ENABLED=true
VOICE_ASR_URL=http://INTERNAL_HOST:PORT
VOICE_ASR_API_STYLE=simple
VOICE_ASR_LANGUAGE=en
VOICE_ASR_LIVE_MODE=buffered
```

Health/status must distinguish disabled, unreachable, malformed-response, and
ready. Telemetry stores timings and categorical failure codes, never transcript
or audio content.

## Tutor-voice boundary

The server remains authoritative: every speech generation resolves the
session's selected reference clip. When a reference preset is selected:

- VoxCPM cloned speech is the only permitted output;
- unresolved reference, service error, or playback error leaves the tutor
  silent;
- the UI shows a short status such as “Tutor voice unavailable”; and
- no browser `speechSynthesis` fallback is allowed.

## UI composition

The Coach document is a fixed `100dvh` surface with safe-area insets. It has:

- top-right preset `<button>`/popover; the closed control shows the chosen name;
- centered instructional canvas with a primary line of at most 120 normalized
  characters and optional pronunciation of at most 240;
- one large Start/End button centred at `66.667dvh`, one-third up from the
  bottom and horizontally centred; and
- one non-interactive `role=status` live region. Routine lifecycle state is
  visually clipped; only concise actionable errors become visible.

Supported instruction text is never silently clipped or truncated. The canvas
selects normal/compact/dense type in place. Oversized invalid content is
replaced atomically by `Practice line unavailable.` and emits one categorical
failure witness per invalid episode.

The popover is contextual, not persistent. It lists saved reference presets and
an “Upload new voice sample” action. Upload asks for a bounded name and file,
then the saved sample becomes the selected preset. No built-in style preset is
shown as a substitute for a reference sample.

Explore/onboarding may exist outside Coach, but there is no Coach/Explore mode
switch inside the active Coach surface.

## Acceptance matrix

| Contract | Automated proof | Phone proof |
|---|---|---|
| Not messaging | DOM/source contract rejects visible thread, bubbles, composer, typed input, send controls | Coach screenshot/DOM has no messaging affordance |
| Exactly two persistent controls | surface test counts one preset + one Start/End button | computed visible controls count is 2 |
| One canvas, no scroll | viewport test asserts one canvas and `scrollHeight <= innerHeight`, no descendant scroller | Pixel 9 reports 411×809 document/viewport and no overflow |
| Preset is tutor voice | runtime + speech tests prove selected reference is used and generic fallback is forbidden | each tutor speech response reports reference resolved; failure is silent |
| Phone speech reaches coach | mocked ASR contract tests + live health/transcription probe | Pixel mic capture produces ASR request and coach turn |
| Resume is continuous | checkpoint migration/patch/reentry tests | Stop, relaunch, Start retains preset/line and advances restart timestamp |
| No forced padding | greeting/policy tests reject automatic scope, warm-up, break, rest, or stop language | first/restarted tutor turn begins the current exercise |
| Honest failures | telemetry tests reject private payloads and require categorical witness | ASR/TTS kill tests show concise status and durable failure code |

## Failure and release policy

- ASR unavailable: keep the session active but do not invent hearing; show
  “I couldn't hear that” or “Speech recognition unavailable,” and allow Stop.
- TTS/reference unavailable: do not speak in another voice; show “Tutor voice
  unavailable,” retain the selected preset, and allow Stop.
- Memory write failure: keep the current in-memory lesson running, emit one
  privacy-safe witness, and retry at the next checkpoint seam.
- Preset upload failure: retain the prior selected preset and name; do not create
  a half-saved entry.
- Release only after targeted tests, full frontend/backend suites, build, service
  restart, gateway health, and physical Pixel DOM/audio checks pass.

## Implementation receipts (2026-07-22, current repaired build)

- Learner-context schema v5 now persists a bounded `voice.coachCheckpoint`
  without transcript, coach prose, message arrays, or audio.
- Start/End restores and checkpoints the continuing lesson, exact named
  reference preset, practice line, pronunciation cue, and learner/coach speech
  timestamps.
- Buffered phone capture is explicitly advertised as recorded ASR with an
  automatic turn boundary; the WebView no longer mistakes “not streaming” for
  “no microphone input.”
- A selected reference preset makes cloned VoxCPM speech mandatory. Reference
  resolution or synthesis failure cannot fall back to a browser voice.
- The visible Coach surface is one fixed viewport with one preset control, one
  instructional canvas, one status line, and one learner-owned Start/End
  control. Legacy runtime nodes remain transport-only and inaccessible.
- The action is 320×58 on the normal phone surface and 320×52 at 360×620. Its
  measured short-viewport centre is `413.328px` versus a `413.333px` target.
- End remains actionable during unresolved startup, immediately cancels the
  real input owner, and every incomplete start awaits a stopped rollback.
  A rejected rollback fails closed; a replacement Start is not invented.
- Recorded Android capture acknowledges Start only after `MediaRecorder.onstart`;
  a missing open event times out fail-closed after four seconds.
- Automated proof: frontend 94 files passed, 664 tests passed and 2 skipped;
  backend 557/557 passed in an isolated state root; production build completed;
  `git diff --check` was clean.
- Deployed browser proof: current bundle `voice-runtime-bpU3v_2R.js`; zero
  console/page/request/overflow failures at 360/768/1280; exactly two visible
  controls; no boot audio or cross-port request.
- Short-viewport stress proof: at 360×620 the complete 120-character line plus
  240-character pronunciation remained within the canvas, the document and
  canvas did not scroll, and the action retained clear separation.
- Independent re-review: CODE PASS and DESIGN PASS with no blockers. Runtime
  browser checks passed; runtime certification is blocked only because ADB
  currently reports no device.
- Live service proof: the ASR health endpoint and a direct transcription probe
  succeeded; selected preset “Aster” produced VoxCPM output with both reference
  resolution and voice cloning affirmed by response headers.
- Live checkpoint proof: the default learner retained a stopped continuing
  session, lesson position, practice text, pronunciation cue, exact Aster
  reference identity, and restart count, while exposing neither transcript nor
  coach-thread fields.

Earlier builds were physically exercised on the Pixel, but the current repaired
bundle has not been replayed there after the host restart because ADB reports no
device. The remaining release proof is the current bundle on the phone:
Start→End during pending/active capture, safe-area and large-font geometry, and
one deliberately spoken capture → ASR → coach → selected-reference VoxCPM turn.
Browser and service evidence must not be upgraded into that physical claim.

## Implementation order

1. Add failing contracts for checkpoint normalization/reentry, ASR forwarding,
   selected-reference speech, minimal DOM, and forbidden lesson padding.
2. Implement schema-v5 checkpoint storage and runtime checkpoint writes.
3. Implement standalone recorded-audio ASR status and forwarding.
4. Expose narrow preset/session surface bridges and replace the visible Coach
   overlay.
5. Remove automatic greeting padding and coach-owned stop/rest guidance.
6. Build, deploy, inspect telemetry, and verify the full loop on the Pixel.
