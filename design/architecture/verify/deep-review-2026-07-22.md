# S14/S15 deep-review ledger — 2026-07-22

## Cycle 1 — blocked

Three independent read-only reviewers examined the code, runtime contract, UI doctrine, tests, documentation, and existing phone receipts.

Shared blockers:

- gateway timeout/error after HTTP 200 ended a partial TTS body cleanly, allowing the frontend to report successful playback;
- model-load failure marked VoxCPM healthy and could emit placeholder sine audio under cloned-synthesis headers;
- AudioWorklet capacity wait and End-before-`ended` paths could remain unsettled and retain an AudioContext;
- the receipt overstated selected-reference conditioning as perceptual identity and complete audible delivery;
- pacing, clause pauses, emphasis, perceptual identity, and a complete post-fix speaker turn were not human-heard.

Additional findings:

- the one gateway timeout budget began before uncached reference quality/audio preparation;
- sparse frontend telemetry could overwrite a gateway TTS timeout with `null`;
- the phone composition retained a hidden legacy reference-audio source capability;
- the silent verifier could claim PASS without ASR and hard-coded its ASR endpoint.

Cycle-1 verdict: **BLOCKED. S15 reopened.**

## Repairs after cycle 1

- mid-body timeout/error/cancel now destroys the response so body readers reject; only normal upstream EOF ends cleanly;
- external phases receive fresh inactivity budgets;
- gateway failures survive sparse frontend telemetry;
- real model presence is required for health/readiness/generation; production mock audio was removed;
- PCM resume, capacity, abort, stop, and completion paths settle and dispose; client interruption telemetry is bounded;
- Coach never attaches a selected recording URL to its hidden legacy player;
- proof language now distinguishes conditioning/routing integrity from perceptual identity;
- release-grade silent verification requires external ASR configuration and `--verify-asr`.
- redundant cold-start session hydration was removed after a physical-phone trace showed its second coach-line ensure could block Start for 24.46 seconds; the same reload gate now settles in 2.002 seconds.

## Cycle 2 — blocked

After full tests, deployment, and silent phone proof, the same three reviewers independently re-examined the frozen tree. The design review found two documentation/terminology defects: the human gate omitted pace/pauses and perceptual preset identity, and active internal naming still described a spoken repeat as `replay`. The code and runtime reviews independently found two remaining PCM liveness holes:

- a short PCM response could fit entirely in the ring and then wait forever if the worklet never emitted `ended` or `failed`;
- `AudioContext.resume()` itself could remain pending forever, and End had no signal crossing into that await.

Cycle-2 verdict: **BLOCKED. S17 remained open.**

## Repairs under cycle-3 review

- the learner-owned human gate now requires all four audible facts: a complete sentence, comfortable pace/pauses, clear technique-word emphasis, and perceptual selected-preset identity;
- active repeat-on-success terminology no longer calls the spoken repair a replay;
- audio-context resume races an internal abort signal and a fixed timeout, with cross-realm errors normalized into the existing typed failure path;
- final PCM completion is bounded by remaining queued duration plus a fixed grace period; timeout aborts/disposes, reports `playback-interrupted`, rejects the turn, and cannot call `/voice/speech/played`;
- kill tests exercise a real Coach End against never-settling resume, an independent resume timeout, and a short final-drain timeout with no played acknowledgement.

Cycle 3 verdict is appended only after the rebuilt bundle is silently verified on the physical phone and all three independent reviewers re-check the frozen result. Human listening remains an explicit learner-owned acceptance gate.
