# Spoken turn pipeline — data model

## Entities

- `LiveInputConnection` — one authenticated browser WebSocket from Start until capture cancellation or coach handoff.
- `LiveInputTurn` — one ephemeral learner utterance accumulated as PCM16 inside a connection.
- `EndpointDecision` — an immutable value describing whether candidate silence is complete, incomplete, or fallback-derived.
- `LiveInputServiceStatus` — the fixed-cardinality operational state used to advertise attachment, detector health, and fallback use honestly.
- `CoachSurfaceActivity` — a derived, non-persisted activity label for the single Coach status region.

## Fields

### LiveInputConnection

| field | type | nullable | default |
|---|---|---|---|
| `liveSessionId` | string | no | generated UUID |
| `sessionId` | string | no | — |
| `sampleRate` | integer | no | 16000 |
| `openedAt` | epoch-ms | no | now |
| `state` | `opening/listening/processing/closed` | no | `opening` |
| `activeTurn` | LiveInputTurn | yes | null |
| `fallbackCount` | integer | no | 0 |

### LiveInputTurn

| field | type | nullable | default |
|---|---|---|---|
| `segmentId` | string | no | generated UUID |
| `frames` | Buffer[] | no | empty |
| `speechStartedAt` | epoch-ms | yes | null |
| `lastSpeechAt` | epoch-ms | yes | null |
| `candidateGeneration` | integer | no | 0 |
| `candidateStartedAt` | epoch-ms | yes | null |
| `pauseResumeCount` | integer | no | 0 |
| `endpointDecision` | EndpointDecision | yes | null |
| `finalized` | boolean | no | false |

### LiveInputServiceStatus

| field | type | nullable | default |
|---|---|---|---|
| `handlerAttached` | boolean | no | false |
| `detectorState` | `disabled/starting/ready/degraded/unavailable/closed` | no | `disabled` |
| `fallbackCount` | integer | no | 0 |
| `activeConnections` | integer | no | 0 |
| `lastFailureClass` | bounded enum | yes | null |
| `lastEventAt` | epoch-ms | yes | null |

### EndpointDecision

| field | type | nullable | default |
|---|---|---|---|
| `kind` | `semantic/fallback/forced` | no | — |
| `complete` | boolean | no | — |
| `probabilityBand` | `low/mid/high/unavailable` | no | `unavailable` |
| `silenceMs` | integer | no | — |
| `inferenceMs` | integer | yes | null |
| `reason` | bounded enum | no | — |

### CoachSurfaceActivity

| field | type | nullable | default |
|---|---|---|---|
| `kind` | `stopped/starting/listening/hearing/thinking/speaking/error` | no | `stopped` |
| `label` | string | no | derived from kind |

## Relations

- `LiveInputConnection` owns zero or one active `LiveInputTurn` (1:0..1).
- `LiveInputTurn` owns zero or one final `EndpointDecision` (1:0..1).
- The singleton live-input service owns one `LiveInputServiceStatus`; `/voice/input/status` reads it but cannot mutate it.
- Existing persisted voice session state references neither connection nor raw frames; it receives only the existing finalized transcript/session update.
- `CoachSurfaceActivity` reads client runtime state and owns no backend entity.

## Invariants

- `LiveInputConnection`: exactly one open control frame precedes binary audio; closure discards all raw frames.
- `LiveInputTurn`: raw PCM is bounded in memory and never written to disk, telemetry, or durable learner memory.
- `EndpointDecision`: a stale decision whose `candidateGeneration` no longer matches cannot finalize a turn.
- `LiveInputServiceStatus`: `liveCapture` cannot be advertised unless `handlerAttached` is true and backend ASR is available; every fallback increments the fixed counter without content fields.
- `CoachSurfaceActivity`: it never adds a control or replaces instructional text with a transcript.

## State Owner (per entity)

- `LiveInputConnection` → `backend/voice-input-live.js`
- `LiveInputTurn` → `backend/voice-input-live.js`
- `EndpointDecision` → `backend/voice-turn-detector.js` produces semantic results; `backend/voice-input-live.js` alone accepts/rejects and stores the final decision.
- `LiveInputServiceStatus` → `backend/voice-input-live.js`; `backend/voice-standalone-runtime.js` exposes a read-only projection.
- `CoachSurfaceActivity` → `frontend/src/voice/coach-surface.ts`

## SSOT Declaration

- Endpoint finalization is authored only by `backend/voice-input-live.js`. Rejected: letting both the browser silence timer and server neural detector finalize live turns; two endpoint owners race and recreate premature cuts.
- The existing session runtime remains the sole owner of finalized transcript/session mutation. Rejected: storing a second transcript on the WebSocket session.
- Surface activity is derived from runtime state at render time. Rejected: a separate persisted UI status that can become stale.

## Migration Notes (expand-contract)

- Expand: advertise live capture only when the gateway handler is attached; keep recorded capture as a conservative fallback.
- Expand: add new activity derivation while retaining the existing status element.
- Contract only after live phone proof: prefer live PCM by capability; do not delete recorded capture in this task because it is the rollback path.
