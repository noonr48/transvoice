# Instrument: TransVoice phone spoken-loop no-response hunt

> Superseded by the later same-day remote-phone incident in
> `no-response-debug-hunt-2026-07-25-round2.md`. The busy-state repair here was
> necessary but not sufficient: an already in-flight listening start could
> still wake after tutor speech began and cancel it.

Mode: HUNT · Medium: service · Date: 2026-07-25 · Status: CLOSED

## H-G0 REQUEST DECODE

| cell | value |
|---|---|
| SYMPTOM | "i tested it again from my phone. no respinse came back after speaking." |
| CLASS | control/action produces no response: `not-joined`, `dead-function`, or `never-received`; the multi-stage spoken loop may also be `partial-function` |
| CHAIN | learner speech → phone PCM capture → `/voice/input/live` lease/PCM → endpoint detector → GPU ASR → `final-transcript` WebSocket envelope → frontend current-owner handler → input-turn/runtime mutation → coach request → GGUF response → selected-preset VoxCPM request/PCM → phone player drain → playback acknowledgement → live input re-arm |
| UNWITNESSED | To be measured. Existing backend input stages are persistent; frontend final-envelope receipt, callback invocation, coach-submit start, TTS-play start, playback completion, and re-arm must be checked for durable both-ended witnesses. |
| OWNER-NAMED | Comprehensive debugging/testing and sub-agent review; the full backend processing path and phone-facing state must be observed. |

## SEAM MAP (I-G1)

| id | kind | seam | boundary? | silent? | tier |
|---|---|---|---|---|---|
| S1 | JOINS | phone capture → gateway live-input PCM | yes | yes | load-bearing |
| S2 | JOINS | endpoint buffer → ASR provider | yes | yes | load-bearing |
| S3 | EMITS/CONTRACTS | backend final transcript → phone WebSocket consumer | yes | yes | load-bearing |
| S4 | JOINS | frontend final handler → current-turn coach submission | yes | yes | load-bearing |
| S5 | JOINS | coach request → GGUF renderer completion | yes | yes | load-bearing |
| S6 | JOINS/CONTRACTS | coach reply + selected preset → VoxCPM synthesis | yes | yes | load-bearing |
| S7 | EMITS | TTS PCM stream → phone playback/drain/ack | yes | yes | load-bearing |
| S8 | JOINS/STATE | playback completion → current-owner capture re-arm | yes | yes | load-bearing |

Excluded candidates: interior VAD arithmetic and text normalization remain covered by unit tests; this hunt observes component boundaries where silence can look like a live session.

## WITNESSES (I-G2)

| seam | current witness / required failure | fallback recorded how | boot breadcrumb |
|---|---|---|---|
| S1 | `voice-input-live` session-open, first-PCM, first-PCM-timeout | fallback counter + input health | live service status |
| S2 | ASR-started/completed/failed with content-free timings | fallback count/outcome | provider status |
| S3 | backend final emit exists; durable phone receive witness to verify/add | no silent drop | client telemetry boot/session ID |
| S4 | verify/add both-ended final-handler and coach-submit witness stitched by segment/turn | no silent suppression | frontend runtime diagnostics |
| S5 | correlated coach request/LLM timing and categorical failure | counted fallback reason | readiness GGUF probe |
| S6 | correlated TTS request/first-byte/total and exact selected preset evidence; active custom synthesis must hold the host busy interlock | fail closed; no substitute voice; cancellation is categorical | VoxCPM readiness |
| S7 | verify/add stream start/complete/drain/played acknowledgement; false-idle render must never restart capture before first PCM | truncated/failed PCM rejected | audio player boot mode |
| S8 | verify/add re-arm requested/accepted/capture-ready with owner generation | bounded visible recovery | live-input status |

Observed failing crossing: the phone aborted selected-preset `/voice/speech/generate` after 54 ms, before response headers/first PCM. Source and red/green tests identify a false-idle host sensor: browser TTS was idle while the custom VoxCPM controller was actively generating. A render restarted input, whose ownership transition intentionally stopped tutor speech. The repaired seam reads the existing `window.__tvCoach.isSpeaking()` custom-controller probe in addition to browser `speechSynthesis`; focused tests prove the controller stays busy during the pending fetch and the coordinator will not re-arm capture.

The same phone incident also exposed a separate capture reliability gap: Android accepted Worklet startup but produced no PCM before the server's three-second guard. Capture now waits at most one second for the Worklet's first frame, then changes to the existing ScriptProcessor path on the same live socket. Learner End participates in that wait, so explicit cancellation remains immediate. The browser-specific reason for the Worklet stall is still unknown, but it can no longer consume the entire server timeout or lose a short learner turn without attempting the supported fallback. Closed, content-free telemetry distinguishes Worklet start/first-frame/no-frame, fallback start/first-frame, and a non-running AudioContext.

## H-G4 CLOSE BAND

DEBUG-HUNT: CLOSED — failing crossing was client playback ownership → TTS response body (`never-received`)
WITNESSES: CLOSED — backend correlation retained; client capture mode/start/first-PCM/no-PCM, AudioContext, and rejected-submit witnesses added
PROOF: PASS — red/green host sensor test, deferred-VoxCPM two-render integration, zero-frame Worklet fallback test, 693 frontend tests (2 skipped), 20 privacy tests, production build/deploy, complete-turn and deliberate-pause drives
VERDICT: FIXED_AND_DEPLOYED — physical-phone replay remains a named residual because no ADB/CDP target is attached
PROCESS-CAUSE: split browser/VoxCPM busy-state contract plus no joined poll-during-generation regression
INSTALLED: dynamic custom-speech busy bridge; pending-generation/second-render kill test; one-second Worklet→ScriptProcessor first-frame recovery; privacy-safe live-capture and submit-failure telemetry
