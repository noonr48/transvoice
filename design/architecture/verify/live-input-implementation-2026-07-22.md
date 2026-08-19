# Live spoken-input implementation receipt — 2026-07-22

Verdict: PASS for transport, endpoint policy, ASR handoff, cancellation, observability, and deployment. Model quality across a diverse physical-phone careful/stutter corpus remains a declared residual.

## Shipped contract

- The phone streams 16 kHz mono PCM16 over authenticated `/voice/input/live`; it no longer waits for a complete `MediaRecorder` blob or base64/JSON upload on the primary path.
- The gateway owns one in-memory segment, caps it at 4 MiB, converts it once to a WAV `Buffer`, and calls the existing ASR/session owner with cancellation and current-owner guards.
- Smart Turn v3.2 is advisory. Production waits exactly 1800 ms before asking it. `incomplete`, unavailable, late, or low-confidence work cannot finalize before the exact 4500 ms conservative fallback. Client, environment, and persisted overrides are ignored.
- Resumed speech changes the endpoint generation, so a stale semantic result cannot cut or commit the current turn.
- The existing Parakeet service remains on the remote RTX 5060 Ti (`gpu_available:true`). A fresh three-run direct multipart probe measured 1.235 s once, then 0.235 s and 0.234 s warm for the 6.4-second fixture, so replacing the ASR model or moving it to another GPU is not justified by the original 7.4-second observation.
- Privacy-safe witnesses contain durations, categorical outcomes, byte counts, and bounded health only—never audio, transcript, prompt, session content, or credentials.

## Falsification that set the policy

The initial design still asked Smart Turn at roughly 900 ms. A real human Aster reference recording was split two seconds into a mid-thought prefix; Smart Turn returned `complete` with a high probability band. That was a release-blocking false cutoff.

The deployed revision moved the protected candidate floor to 1800 ms and the conservative fallback to 4500 ms. Replaying the human fixture with 1.2 seconds of deliberate silence produced `candidate-not-reached`, resumed the same segment, later received `incomplete/low`, and finalized exactly once through the conservative boundary. This proves the tested pause policy, not population-level model quality.

## Production crossings

Current-bundle complete-turn verifier (`voice-references/aster-tts-sample.wav`, 6.4 s):

- semantic outcome `complete/high`; no fallback;
- open→ASR 149 ms;
- GPU provider ASR 326 ms;
- open→final transcript 475 ms;
- envelope order `session-started → speech-start → speech-end → processing → final-transcript`;
- no errors and privacy scanner PASS.

The verifier injects PCM and silence frames faster than real time. Its 149/326/475 ms values isolate gateway/model/ASR overhead; they are not a claim that a learner can speak 6.4 seconds and receive a transcript in 475 ms. In real time, a semantic-complete turn intentionally includes the 1.8-second protected pause before the approximately 92 ms detector and measured ASR work. An uncertain turn intentionally waits to 4.5 seconds.

Deliberate-pause verifier (`voice-references/aster-voice-ref.wav`, split at 2.0 s):

- 1.2-second pause preserved;
- first-pause decision `candidate-not-reached`;
- semantic result after resumed speech `incomplete/low`;
- boundary `conservative-fallback` at 4500 ms of modeled silence;
- current-bundle provider ASR 412 ms; open→final 2125 ms in faster-than-real-time injection; one final transcript; no errors.

## Post-review hardening

The independent runtime review found that the original evidence did not yet prove backend-authoritative End, exact (rather than minimum) endpoint timing, cumulative fallback accounting, first-audio `Speaking`, or visible selected-voice failure. Those gaps are now closed in code and kill tests:

- Start uses a two-phase process-local lease; durable active/restart memory is written only after microphone capture and the server `session-started` acknowledgement.
- End clears the lease, advances the session generation, closes matching live sockets, aborts ASR, and makes `shouldCommit()` false. A stopped session cannot reopen with an old lease.
- Both boundaries are exact constants: 1800 ms neural candidate and 4500 ms conservative/recorded fallback.
- Live-service fallback telemetry increments cumulatively per accepted conservative endpoint.
- `Speaking` begins only on an actual audio witness and ends on completion/abort. TTS generation remains `Thinking…`.
- A selected-reference 409 is inspected before status rejection, remains fail-closed, never invokes generic browser speech, and visibly reports `Selected tutor voice is unavailable.`

## Automated gates

- Backend: 260/260 Node tests pass, including real WebSocket upgrade, auth, two-phase lease activation, stopped-session refusal, End during semantic inference and ASR, exact policy locks, cumulative fallback telemetry, internal Buffer, timeout, and privacy-safe witnesses.
- Frontend: 674 pass, 2 intentional skips across 94 files. Tests require the server lease acknowledgement, preserve 1.2-second careful pauses, bind `Speaking` to actual audio, and surface selected-voice failure without substitution.
- TypeScript + Vite production build: PASS; current asset `assets/voice-runtime-BXph8oZP.js`.
- `git diff --check`: PASS.
- `systemd-analyze --user verify voice-tutor-standalone.service`: PASS.
- Upstream sync check intentionally reports pre-existing/local TransVoice divergence; it was not auto-synced because that would overwrite the project-owned mobile shell and shared dirty-tree work.

Two root `tests/` scripts are not counted as regression tests: `tests/test-runtime-endpoints.js` probes deprecated debug routes that now intentionally return 404, and `tests/test-tts-reference.js` requires a non-project `/tmp/aster-voice/...` fixture. They are legacy/prerequisite smoke scripts, not silent green claims.

## Runtime state

- `voice-tutor-standalone.service`: active/running, `NRestarts=0`.
- Gateway health: online; VoiceTrainer, coach GGUF, VoxCPM, and ASR online.
- Live input: attached/ready, `liveCapture:true`, `automaticTurnBoundary:true`.
- Smart Turn: enabled/ready, zero pending, zero current fallback/error count after final restart.

## Reproduce

```bash
node studio/code/verify-live-input-production.mjs
TRANSVOICE_SPEECH_FIXTURE=voice-references/aster-voice-ref.wav \
  TRANSVOICE_PAUSE_SPLIT_SECONDS=2.0 \
  node studio/code/verify-live-input-production.mjs --deliberate-pause
```

Revisit the policy if a consented physical-phone corpus shows premature cuts, if the 4.5-second fallback produces unacceptable over-wait, or if warm semantic inference exceeds 150 ms. Never lower the protected floor from anecdote alone.
