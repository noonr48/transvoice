# Spoken turn pipeline — contracts

## Live input WebSocket

- **Surface:** `GET/upgrade /voice/input/live`, implemented by `backend/voice-input-live.js`.
- **Signature:** first text frame `{type:"open", sessionId, liveInputLeaseId, sampleRate:16000}`; subsequent binary PCM16 mono frames → bounded JSON envelopes from `VoiceInputLiveEnvelope`.
- **Preconditions:** the HTTP upgrade passes the existing sensitive-route guard; `/session/start` has issued the named process-local lease; the `open` frame names that exact starting/active session generation; audio is exactly 16 kHz mono signed PCM16; one `open` frame arrives before audio.
- **Postconditions:** the socket may open while startup is still transient, but PCM is discarded until the same lease becomes active; accepted audio is memory-bounded; a finalized turn is committed once and emits one `final-transcript` with a unique `segmentId`; while `processing`, later PCM frames are counted-and-dropped rather than opening another turn; End increments the session generation, clears the lease, closes its sockets, aborts ASR, and invalidates every pending prediction/commit callback.
- **Errors:** unauthorized upgrade → 403/close before WebSocket construction; inactive/missing session or malformed open/frame → `error` then close; oversized turn/backpressure → bounded `error`; ASR failure → `error` without fabricated transcript; client close/End during prediction or ASR → abort/ignore late work without session mutation.
- **Idempotency:** opening twice is rejected; finalization is idempotent per `segmentId`; duplicate/stale endpoint callbacks cannot commit twice.
- **Versioning:** additive event fields only; unknown optional fields are ignored; event names remain within the parser union.

## Semantic turn prediction worker

- **Surface:** JSONL stdin/stdout between `backend/voice-turn-detector.js` and `services/smart-turn/worker.py`.
- **Signature:** `{protocol:1,type:"predict",id,sampleRate:16000,pcm16Base64}` containing only the most recent eight seconds of the current turn → `{type:"prediction",id,complete,probability}`; startup emits `{type:"ready",protocol:1}` and bounded failures emit `{type:"error",id,code}`.
- **Preconditions:** pinned model checksum verified; worker ready; audio is current-turn PCM16 and at least the configured minimum speech duration.
- **Postconditions:** returns one response correlated by `id`; no content is persisted or logged.
- **Errors:** missing runtime/model, worker exit, malformed response, queue saturation (maximum eight pending calls), or 500 ms prediction timeout → typed unavailable result plus health degradation; live input uses conservative fallback.
- **Idempotency:** read-only inference; identical audio may be retried, but one candidate generation may accept at most one result.
- **Versioning:** worker protocol version `1`; adapter owns translation so model/runtime can be replaced without changing live input.

## Live endpoint policy

- **Surface:** `backend/voice-input-live.js` pure decision state machine.
- **Signature:** PCM frame energy + timestamps + optional semantic result → `continue` or one `EndpointDecision`.
- **Preconditions:** speech has met minimum voiced duration; candidate silence has reached exactly 1800 ms.
- **Postconditions:** semantic `incomplete` continues capture; semantic `complete` above the confidence threshold finalizes; unavailable detector cannot finalize before exactly 4500 ms of silence; hard bounds prevent infinite buffers.
- **Errors:** detector latency/race → stale generation ignored; client, environment, or persisted attempts to change 1800/4500 are discarded; clock reversal → frame ignored and witness emitted.
- **Idempotency:** repeated evaluation after finalization is a no-op.
- **Versioning:** 1800/4500 is a tested accessibility contract, not a runtime tuning surface; changing it requires a new deliberate-pause/careful-speech corpus and product decision. Recorded fallback remains available and uses the same 4500 ms boundary.

## GPU ASR handoff

- **Surface:** `backend/voice-input-live.js` owns PCM16→mono-WAV framing, then calls existing `voiceOperationRouteHandlers.submitVoiceInputTurn(body, {audioBuffer, signal, shouldCommit})`; `backend/voice-input-asr.js` remains the provider bridge.
- **Signature:** an internal bounded Node `Buffer` plus capture timestamps and cancellation guard → existing `VoiceInputTurnResponse` with final transcript and session payload. External HTTP callers continue to use the existing base64 body contract.
- **Preconditions:** existing session; non-empty bounded audio; ASR readiness green.
- **Postconditions:** one successful-turn increment and one finalized transcript only when the live segment is still current; raw buffer becomes unreachable after the response.
- **Errors:** provider timeout/offline/empty transcript → 502-style error envelope and ASR seam witness; aborted or stale segment → no session mutation and no coach request; no external route can supply the internal Buffer options.
- **Idempotency:** not generally idempotent; live input guards one call per `segmentId`.
- **Versioning:** reuses the existing normalized input-turn contract.

## Coach surface activity derivation

- **Surface:** `frontend/src/voice/coach-surface.ts` → existing `#tv-coach-status` and `data-activity`.
- **Signature:** session transition + recognition status + positive current-capture speech evidence + interaction owner + actual tutor-audio playback witness → one `CoachSurfaceActivity`.
- **Preconditions:** surface has been bootstrapped; state is read-only.
- **Postconditions:** one reserved visual line shows `Listening`, `Hearing you`, `Thinking…`, or `Speaking`; a TTS request/generation phase remains `Thinking…` and only PCM first-audio, HTML media `playing`, or browser-synthesis `onstart` may project `Speaking`; routine changes are not live-announced over tutor audio; selected-voice generation failure becomes the concise visible error `Selected tutor voice is unavailable.`; button remains exactly Start/End and preset selection remains unchanged.
- **Errors:** unknown state → conservative active label `Listening`; explicit runtime error → concise existing recovery status.
- **Idempotency:** idempotent render derivation.
- **Versioning:** new activity kinds are additive; `Understanding` is deliberately not a public state; no DOM control contract changes.

## Live input status projection

- **Surface:** existing `getVoiceInputStatus()` response.
- **Signature:** backend ASR status + read-only `LiveInputServiceStatus` → backend capabilities and bounded health fields.
- **Preconditions:** none; safe before server start.
- **Postconditions:** `liveCapture:true` only when the upgrade handler is attached and ASR is available; detector state and fallback count are categorical/fixed-cardinality and contain no audio or text.
- **Errors:** missing live service → `liveCapture:false`, detector `unavailable`; status read never starts a worker or changes endpoint behavior.
- **Idempotency:** read-only and stable between service events.
- **Versioning:** additive capability/health fields only.

## Selected-preset tutor synthesis and playback

- **Surface:** `POST /voice/speech/generate` → VoxCPM `POST /generate` → `frontend/src/voice/coach-speech.ts` → `frontend/src/voice/audio/pcm-stream-player.ts` and the deployed AudioWorklet.
- **Signature:** current session + target text + fixed rate (`0.76`, or spoken repeat-slower `0.65`) → 48 kHz mono PCM16 plus provider, clone, generation-mode, reference-role, and applied-rate evidence headers.
- **Preconditions:** the session owns a cloneable selected reference; the gateway resolves that exact server-bound recording; the TTS service is ready; target text is non-empty and bounded.
- **Postconditions:** the recording is used only as structurally isolated reference conditioning and is never attached to a Coach-page player; the built-in voice description is excluded; newly synthesized target speech is tempo-adjusted without pitch shift; raw unpaced audio is cached under reference path plus synthesis-policy context; every PCM sample is queued under worklet backpressure and the final sample renders before clean completion; successful full playback alone advances the durable coach-spoke clock.
- **Errors:** missing real model → 503/no audio/no synthesis evidence; unavailable reference → 409 + visible selected-voice error; missing/mismatched synthesis evidence → 502/silence; upstream timeout/error after response start → destroyed/rejected body, never clean partial EOF; worklet overflow/capacity stall, pending or rejected audio resume, or missing final-drain completion → typed time-bounded playback failure + privacy-safe witness; cancellation/End settles, disposes, and cannot mark playback complete; selected reference never falls back to browser TTS.
- **Idempotency:** repeated generation may reuse the same unpaced synthesis cache entry, then independently apply the requested bounded tempo; `/voice/speech/played` is accepted only for the current selected-reference session after full playback.
- **Versioning:** synthesis cache context contains `selected-reference-identity-v1`; any future prompt, identity, normalization, or conditioning policy that can change audio must change that context. Reference audio is never a response body.

## Smart Turn runtime setup

- **Surface:** `scripts/setup-smart-turn.sh`.
- **Signature:** optional explicit install root → isolated Python 3.12 venv + exact dependencies + pinned model.
- **Preconditions:** Python 3.12, curl, network for first install, sufficient disk.
- **Postconditions:** checksum verified and worker smoke returns ready; existing runtimes are untouched.
- **Errors:** dependency/model/checksum/import failure exits non-zero and leaves gateway on conservative fallback.
- **Idempotency:** rerun is safe; matching model is reused and exact package pins converge.
- **Versioning:** model commit and SHA are explicit; upgrades require an intentional artifact change and re-benchmark.
