# Spoken turn pipeline — cartography

## Module Inventory

| path | role | owner |
|---|---|---|
| `frontend/src/voice/audio/pcm16-capture.ts` | Existing 16 kHz PCM frame producer for backend-live capture | browser PCM framing |
| `frontend/src/voice/coach-input.ts` | Existing input owner lifecycle, backend-live WebSocket client, and recorded fallback | client capture ownership |
| `frontend/src/voice/coach-input.test.ts` | Capture startup, live-envelope, cancellation, and conservative recorded-fallback proofs | frontend input tests |
| `frontend/src/voice/backend-live/envelope.ts` | Parses the bounded server-to-client live-input event union | live envelope shape |
| `frontend/src/voice/host-orchestration-config.ts` | Supplies input capability and endpoint settings to the input controller | frontend runtime wiring |
| `frontend/src/voice/state.ts` | Owns normalized client fallback settings | frontend VAD configuration |
| `frontend/src/voice/state.test.ts` | Proves normalized fallback bounds and defaults | frontend state tests |
| `frontend/src/voice/coach-surface.ts` | Derives the one-screen Coach instructional/status surface | Coach surface activity state |
| `frontend/src/voice/coach-surface.test.ts` | Proves activity derivation, errors, control count, and preset behavior | Coach surface tests |
| `frontend/src/voice/coach-speech.test.ts` | Existing selected-reference→cloned-tutor-speech identity proof | tutor voice regression tests |
| `frontend/src/voice/standalone-app.ts` | Binds the simplified surface to the full voice runtime | Coach surface composition |
| `frontend/src/voice/standalone-dom.test.ts` | Proves shipped phone-shell semantics and persistent-control count | phone-shell DOM tests |
| `frontend/src/voice/standalone-template.ts` | Mirrors normalized advanced-panel defaults for embedded recovery shell | generated template source |
| `frontend/src/voice/templates/voice-tutor-template.html` | Static template mirror of fallback defaults | template source |
| `frontend/voice-tutor-app.html` | Phone shell and fixed no-scroll Coach styles/markup | standalone phone shell |
| `backend/voice-input-live.js` (NEW) | Owns WebSocket connections, in-memory PCM turns, endpoint candidates, ASR handoff, and live envelopes | live input connection/turn |
| `backend/voice-input-live.test.js` (NEW) | Pure state, race, bound, and witness kill tests | live input tests |
| `backend/voice-input-live.integration.test.js` (NEW) | Real HTTP upgrade and exactly-once session/ASR crossing | live input integration tests |
| `backend/voice-standalone-safety.test.js` | Upgrade authorization/attachment construction proof | gateway safety tests |
| `backend/voice-turn-detector.js` (NEW) | Thin supervised JSONL-worker adapter with timeout and health | endpoint inference availability |
| `backend/voice-turn-detector.test.js` (NEW) | Adapter boot, queue, timeout, crash, and privacy tests | detector tests |
| `backend/voice-input-asr.js` | Existing remote Parakeet HTTP bridge | ASR provider call |
| `backend/voice-input-asr.test.js` | Internal Buffer/cancellation and capability regression proofs | ASR/runtime tests |
| `backend/voice-standalone-runtime.js` | Owns session mutation, route composition, debug bus, and server upgrades | standalone runtime/session mutation |
| `backend/voice-standalone-config.js` | Normalizes environment-controlled runtime paths and thresholds | backend configuration |
| `backend/voice-session-state.js` | Mirrors conservative fallback bounds in persisted UI state | backend session normalization |
| `backend/voice-session-state.vad.test.js` (NEW) | Proves backend fallback normalization | backend state tests |
| `services/smart-turn/worker.py` (NEW) | Loads pinned Smart Turn ONNX and answers completion predictions | model inference process |
| `services/smart-turn/requirements.txt` (NEW) | Exact direct Python dependency pins | worker dependency declaration |
| `services/smart-turn/LICENSE.pipecat-smart-turn` (NEW) | Required BSD-2-Clause attribution for adapted inference and model use | dependency license |
| `scripts/setup-smart-turn.sh` (NEW) | Reproducibly creates the isolated worker runtime and verifies model checksum | local model/runtime installation |
| `.env.example` | Documents optional worker and endpoint policy variables | local configuration example |
| `deployment/voice-standalone.env.example` | Documents deployed worker and endpoint policy variables | deployment configuration example |
| `deployment/systemd/user/voice-tutor-standalone.service` | Declares optional worker paths and live endpoint policy | deployed gateway environment |
| `design/ux/states.md` | Records complete Coach lifecycle communication states | UX state contract |
| `design/frontend/brief.md` | Ratifies visible-but-minimal active activity feedback | frontend brief |
| `design/frontend/direction.md` | Keeps one-line activity feedback inside the instrument direction | frontend direction |
| `design/frontend/structure.md` | Reserves one stable non-control activity line | frontend structure |
| `design/frontend/controls.md` | Confirms status is not a third control | control wiring contract |
| `design/frontend/tokens.css` | Owns activity-line geometry/type literals | frontend tokens |
| `design/frontend/sources.md` | Maps the restyle artifacts to the shipped shell | deployed source map |
| `design/frontend/verify/` | Lint, viewport, screenshot, and critique receipts for the deployed surface | frontend evidence |
| `design/architecture/verify/` | Benchmarks, integration outputs, readiness, and phone receipts | architecture evidence |
| `dist/` | Generated production phone application output | production build artifacts |
| `/tmp/transvoice-dist-pre-live-input-2026-07-22/` | Exact pre-build `dist/` rollback copy | build rollback artifact |
| `/home/USER | Generated isolated Python/model runtime | local semantic detector runtime |
| `/home/USER | Recoverable rollback destination for the generated runtime | setup rollback artifact |
| `/home/USER | Installed managed gateway unit | live service definition |
| `/home/USER | Installed environment/path policy drop-in | live service configuration |
| `backend/voice-standalone-integration.test.js` | Existing selected reference→VoxCPM clone crossing proof | tutor voice backend regression tests |
| `studio/code/instrumentation.md` | Permanent seam/witness ledger | runtime observability contract |
| `studio/code/review.md` | Final spec/wiring/adversarial review result | release review |

## Entry Points

- Learner presses `#tv-coach-session-toggle`; `standalone-app.ts` starts continuous capture once.
- `coach-input.ts` opens `${kernelWsUrl}/voice/input/live`, sends one JSON `open` frame, then binary PCM16 frames.
- `voice-standalone-runtime.js` attaches the `/voice/input/live` upgrade handler when the gateway starts.
- `voice-input-live.js` drives candidate silence, optional Smart Turn, ASR, session mutation, and final envelope delivery.

## Data-Flow Seams (text diagram)

```text
phone microphone
  -> pcm16-capture.ts (16 kHz mono frames)
  -> coach-input.ts WebSocket
  -> /voice/input/live
  -> voice-input-live.js
       -> RMS candidate silence
       -> voice-turn-detector.js -> worker.py / Smart Turn ONNX
       -> PCM16-to-WAV in voice-input-live.js
       -> voiceOperationRouteHandlers.submitVoiceInputTurn internal Buffer handoff
       -> voice-input-asr.js -> Tailscale -> GPU Parakeet
  <- final-transcript envelope + session payload
  -> submitVoiceCoachQuestion
  -> coach model -> selected-preset VoxCPM -> microphone reopens
```

```text
runtime capture/coach/TTS states
  -> standalone-app.ts
  -> coach-surface.ts
  -> existing #tv-coach-status + data-activity
```

## Where-Does-X-Live Index

- Capture ownership and cancellation → `frontend/src/voice/coach-input.ts`
- Semantic endpoint decision → `backend/voice-turn-detector.js` + `services/smart-turn/worker.py`
- Conservative fallback policy → `backend/voice-input-live.js`
- ASR session commit → `backend/voice-standalone-runtime.js:submitVoiceInputTurn`
- PCM16-to-WAV conversion → `backend/voice-input-live.js`
- Live handler/detector/fallback health → `backend/voice-input-live.js`, surfaced read-only by `getVoiceInputStatus`
- User-visible lifecycle words → `frontend/src/voice/coach-surface.ts`
- Status rendering/motion → `frontend/voice-tutor-app.html`
- Persistent privacy-safe witnesses → existing debug bus/sink, mapped in `studio/code/instrumentation.md`

## External Deps

- `ws` (already present) — gateway and browser WebSocket transport.
- Remote `nvidia/parakeet-tdt-0.6b-v2` (already present) — GPU offline transcription.
- `onnxruntime==1.23.2` — CPU execution of the isolated Smart Turn model.
- `transformers==4.48.2` — pinned Whisper feature extraction used by Smart Turn.
- `pipecat-ai/smart-turn-v3.2-cpu.onnx` at commit `f766f81d3cfdf7737ac64aad813d91bbfd56bf93`, SHA-256 `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`, BSD-2-Clause.

## Hot Spots

- `backend/voice-standalone-runtime.js` is high fan-in and already heavily modified; change only upgrade attachment, status capabilities, and a narrow live-input facade.
- `frontend/src/voice/coach-input.ts` owns cancellation races; preserve its generation/owner guards and prove End still invalidates late work.
- `frontend/voice-tutor-app.html` is the shipped phone shell; preserve its fixed geometry and two-control invariant.
