# Live Coach turn incident review — 2026-07-24

Status: diagnosis complete; no runtime or product code changed.

Incident window: 2026-07-24 22:56:02–22:57:40 ACST
App session: `voice-standalone-0baf027c-227e-4e50-aaf5-46d0022ef4ee`
Served frontend: `/assets/voice-runtime-BO8JMwfq.js`

## Verdict

The approximately two-minute first response was not a single slow inference and was not caused by Tailscale. Tutor audio first became available about 95.7 seconds after Start—and the learner then heard the response—because the app accumulated:

1. 11.2 seconds before the phone's live capture became ready;
2. one captured segment with only 320 ms above the RMS voice threshold, which the healthy ASR provider accepted but transcribed as empty;
3. three silent 12-second capture windows that the continuous loop automatically reopened without resolving the learner-facing failure;
4. one successful capture/ASR pass;
5. 2.6 seconds of coach generation; and
6. 5.5 seconds to the first cold TTS segment (7.7 seconds for the complete TTS request).

The spoken “I didn't capture enough…” response was not grounded in this incident's audio. It was deterministically forced by an unusable VoiceTrainer summary finalized on 2026-07-22. More fundamentally, the current Coach WebSocket sends the captured WAV to ASR, receives text, and then discards the WAV before the coach request. In the normal voice-only Coach path, today's voice is therefore not acoustically evaluated at all.

## Reconstructed timeline

All timings below are verified from the gateway's debug witnesses, service journal, remote Parakeet container log, persisted session export, and VoxCPM journal.

| ACST | Delta from Start | Verified event |
|---|---:|---|
| 22:56:02.148 | 0.000 s | learner pressed Start |
| 22:56:03.581 | 1.433 s | lifecycle control state changed |
| 22:56:12.897 | 10.749 s | live-input WebSocket opened |
| 22:56:13.152 | 11.004 s | first PCM reached gateway |
| 22:56:13.358 | 11.210 s | phone reached Listening |
| 22:56:19.663 | 17.515 s | first above-threshold speech evidence |
| 22:56:24.466 | 22.318 s | conservative 4.5 s boundary; only 320 ms voiced |
| 22:56:26.109 | 23.961 s | ASR turn rejected because returned transcript was empty |
| 22:56:28.538 | 26.390 s | capture silently reopened |
| 22:56:42.164 | 40.016 s | second no-speech window reopened |
| 22:56:56.322 | 54.174 s | third no-speech window reopened |
| 22:57:10.946 | 68.798 s | fourth capture window opened |
| 22:57:21.569 | 79.421 s | speech detected |
| 22:57:27.116 | 84.968 s | semantic endpoint accepted the turn |
| 22:57:27.914 | 85.766 s | final ASR completed (794 ms gateway-observed) |
| 22:57:30.950 | 88.802 s | coach generation completed (2.562 s) |
| 22:57:37.600 | 95.452 s | first VoxCPM segment synthesized |
| 22:57:37.830 | 95.682 s | client reported generated tutor speech |
| 22:57:39.748 | 97.600 s | complete two-segment TTS request finished |

The remote Parakeet container processed the first 11.5-second WAV in 1.38 seconds and returned HTTP 200, but without usable text. It processed the later 16.1-second WAV in 0.30 seconds. This rules out GPU ASR latency and remote service availability as the dominant cause.

## Defect cards

### P0 — The coach uses stale measurements as if they belong to the current turn

Evidence: `[V]`

Persisted state at the incident:

- `lastAttemptArtifact.finalizedAt`: `2026-07-22T03:21:37.646173Z`
- current coach turn: `2026-07-24T13:27:30Z`
- stale summary: `voicedFramePct=0.003`, `captureReliability=0.547`, `low_voiced_coverage`
- today's `coach_metric_contract` emitted those exact July 22 values twice
- today's deterministic intent became `repair_capture`
- sanitizer witness: `cause=not_enough_voice`

The runtime explicitly treats any summary presence as current at [backend/voice-standalone-runtime.js:2571](/home/USER

> “we treat its presence as `voice_trainer_done`”

The signal builder has a correct ten-minute freshness check at [backend/coaching/signal-builder.js:1698](/home/USER but only uses it to gate praise. Before that freshness result can control the turn, [backend/coaching/signal-builder.js:2002](/home/USER reads `lastSummary`, and [backend/coaching/signal-builder.js:2058](/home/USER forces `repair_capture` solely from measurement usability.

The deterministic line is then selected at [backend/coaching/sanitizer.js:400](/home/USER

Impact: a successful live conversation turn can be blamed on an unrelated, days-old recording. This is a trust and correctness blocker.

Required correction:

- bind every acoustic summary to the exact live segment/turn ID;
- never use an unbound or stale summary to judge the current utterance;
- clear/quarantine old take evidence when a new Coach session starts;
- if current-turn acoustic evidence is absent, converse from the transcript without claiming a capture defect.

### P0 — Live Coach audio is transcribed and then discarded before coaching

Evidence: `[V]`

[backend/voice-input-live.js:236](/home/USER passes the WAV buffer to the ASR turn. The resulting envelope contains only the transcript at [backend/voice-input-live.js:261](/home/USER

The frontend extracts and auto-submits only that string at [frontend/src/voice/coach-input.ts:826](/home/USER The later coach request tries to attach audio only from the separate legacy practice transport's ring buffer at [frontend/src/voice/host-actions-controller.ts:385](/home/USER The voice-only Coach deliberately does not arm that legacy transport, so its ring buffer is empty.

The source comments confirm the architectural split at [frontend/src/voice/coach-input.ts:144](/home/USER

> conversation audio “is transcribed (ASR), never measured”

Impact: this is a voice lesson whose normal Coach conversation path cannot evaluate the voice just spoken. It can only respond to the transcript and whatever historical measurements remain in session state.

Required correction:

- make the finalized live WAV a single turn artifact used by both ASR and VoiceTrainer analysis;
- carry an opaque `turnId/segmentId` through ASR → analysis → coach signal;
- do not base this on the hidden practice transport or reintroduce practice controls;
- run ASR and acoustic analysis concurrently after endpointing where safe;
- admit the coach turn only when transcript and same-turn evidence are explicitly resolved, with a transcript-only conversational fallback that makes no acoustic claim.

### P1 — No-speech and empty-ASR failures silently consume repeated 12-second windows

Evidence: `[V]`

The server emits `no-speech` after the configured timeout and resets its segment at [backend/voice-input-live.js:377](/home/USER The frontend converts this to ordinary `idle` at [frontend/src/voice/coach-input.ts:870](/home/USER

The continuous-loop gate treats any state other than waiting/listening/processing as eligible to start again at [frontend/src/voice/coach-loop.ts:44](/home/USER Thus `no-speech → idle → render → start-continuous-listening` repeats indefinitely while the session remains active.

The incident produced new capture openings at 22:56:28.538, 22:56:42.164, 22:56:56.322, and 22:57:10.946. Three entire 12-second windows passed before the final successful turn.

Impact: the learner experiences an unexplained, apparently frozen session while the app burns time in an internal retry loop.

Required correction:

- keep the overall session active, but make each failed turn visibly/audibly resolve in under one cycle;
- distinguish `empty-asr`, `no-speech`, and microphone-level failure;
- after one failed window, surface a short state change and continue listening without resetting every learner-facing status to generic idle;
- after repeated failures, retain the one Start/End interface but enter an explicit recovery state rather than cycling invisibly.

### P1 — The phone's speech gate likely rejected most of the first utterance, but current telemetry cannot prove why

Evidence: `[V/A]`

Verified:

- the first 11.5-second WAV contained only 320 ms counted above threshold;
- Parakeet returned an empty transcript rather than failing;
- subsequent windows found no above-threshold speech;
- final persisted runtime level was `-53.58 dBFS`, noise floor `-54.88 dBFS`, SNR `1.31 dB`;
- the default RMS threshold is `0.018` (about `-34.9 dBFS`) at [frontend/src/voice/host-runtime-composition.ts:342](/home/USER
- the phone conversation stream requests echo cancellation and noise suppression with AGC disabled at [frontend/src/voice/coach-input.ts:152](/home/USER

Inference:

The phone audio reaching VAD was probably far below the fixed floor for much of the incident. However, the gateway records only `above-threshold`, not the effective threshold or privacy-safe level distribution for each segment. The final persisted level may describe a later silent window, so it cannot by itself prove that the first utterance was quiet.

Required instrumentation:

- effective RMS threshold per live socket;
- privacy-safe RMS p50/p90/max bands and voiced milliseconds per segment;
- requested versus resolved Android audio constraints;
- categorical reason for an empty ASR result;
- no transcript or audio content in telemetry.

Do not shorten the protected 1.8/4.5-second endpoint policy. The failure happened before endpoint quality: speech was not being counted as voice reliably.

### P1 — Start-to-Listening regressed to 11.2 seconds on the real phone

Evidence: `[V/R]`

The server-side prepare lifecycle finished near 22:56:03.581, but the live socket did not open until 22:56:12.897. The gap is in the phone/client startup lane before WebSocket admission.

[frontend/src/voice/coach-input.ts:951](/home/USER serially waits for:

1. the practice-release barrier;
2. `getUserMedia`;
3. `AudioContext.resume`;
4. PCM worklet/script creation;
5. WebSocket open and server acceptance.

Current durable witnesses begin at the WebSocket, so they cannot separate those client stages after the phone disconnects.

Required instrumentation:

- persist privacy-safe deltas for lifecycle prepare, practice barrier, `getUserMedia`, AudioContext resume, PCM capture construction, WebSocket open, server acceptance, and first PCM;
- attach the same start-attempt ID to the button event and socket;
- retain a bounded incident history long enough that health polling cannot evict the useful turn.

The phone was not present in `adb devices` during this review, so the exact 9.3-second client substage remains unverified.

### P2 — Visible Coach Start did not prewarm the selected tutor voice

Evidence: `[V/R]`

There was no `tts_reference_prewarm` or `/v1/reference-audio/prime` event at visible Coach Start. The first response paid:

- 1.917 seconds for reference feature preparation;
- 5.504 seconds to the first synthesized segment;
- 7.735 seconds for the complete TTS request.

The gateway has a prewarm implementation at [backend/voice-standalone-runtime.js:3081](/home/USER but invokes it from the VoiceTrainer analyzer session start at [backend/voice-standalone-runtime.js:3799](/home/USER Visible Coach Start uses only the Coach lifecycle at [frontend/src/voice/standalone-app.ts:836](/home/USER so a restored session can skip the prewarm crossing.

Required correction:

- prime the selected reference on every visible Coach Start/restart;
- deduplicate by selected reference and cache state;
- do not delay microphone readiness on the prewarm;
- expose cache-hit/miss and prewarm-ready on the same turn telemetry.

## What is not the cause

Evidence: `[V]`

- Tailscale transport: health/status requests were fast and returned 200; the gateway had no restart.
- GPU ASR speed: the successful incident transcription took 0.30 seconds inside Parakeet and 0.794 seconds gateway-observed.
- service crash/restart: gateway, VoiceTrainer, coach model, and VoxCPM all reported `NRestarts=0`.
- the careful-speaker endpoint policy: the fixed 1.8-second semantic candidate and 4.5-second conservative fallback behaved as designed.
- a missing frontend deployment: the phone loaded the currently served `voice-runtime-BO8JMwfq.js`.

## Coverage and test gap

Existing focused tests all passed:

- backend live input, ASR, and stale-take truth tests: 35/35;
- frontend coach input, loop, orchestration, and lifecycle tests: 78/78.

That is useful negative evidence: the incident is not covered by the present assertions.

Specific gaps:

1. the stale-take test proves stale evidence cannot authorize praise, but does not test that stale unusable evidence cannot force `repair_capture`;
2. the live-input test proves WAV reaches ASR, but does not require the same WAV/turn ID to reach acoustic analysis and coaching;
3. continuous-loop tests authorize idle reopening, but do not bound repeated no-speech latency or require a learner-visible recovery state;
4. prewarm integration tests exercise `/voice/session/start`, not the visible voice-only Coach `/session/start` lifecycle;
5. startup tests do not measure or bound real `getUserMedia → first PCM` stage latency.

## Recommended fix order

1. **Turn integrity:** make one finalized live audio artifact feed ASR and VoiceTrainer analysis, bound by one turn ID.
2. **Trust guard:** reject stale/unbound `lastSummary` for all current-turn decisions, not only praise.
3. **Failure loop:** replace invisible 12-second retry accumulation with an explicit bounded recovery state while preserving the one Start/End interface.
4. **Phone capture calibration:** add threshold/level witnesses, then tune based on real Pixel evidence; do not guess or shorten pause protection.
5. **Start latency:** instrument and remove the actual slow client barrier.
6. **TTS prewarm:** prime the selected preset on visible Coach Start without blocking listening.
7. **Regression proof:** add an end-to-end fixture asserting current WAV → ASR + same-turn analysis → coach → selected-voice TTS, plus stale-evidence and repeated-no-speech negative tests.

## Review classification

- `VERIFIED [V]`: incident timeline, service health, ASR provider timing, repeated capture resets, stale July 22 acoustic state, deterministic capture-repair response, cold TTS cost, served bundle, passing focused tests.
- `READ-ONLY [R]`: source tracing, caller/usage sweep, prewarm path, continuous-loop behavior, startup stage ordering.
- `ASSUMED [A]`: low phone level or threshold mismatch was the specific reason most first-turn speech was missed.
- `UNTESTED`: exact Android `getUserMedia`/AudioContext/worklet contribution; current effective phone-side RMS threshold/localStorage override; physical playback completion because no ADB device was connected.
