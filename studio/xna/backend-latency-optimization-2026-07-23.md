# Backend spoken-loop latency optimization — 2026-07-23

## Scope and product laws

This slice was completed without using the phone. It changes backend capture,
coach generation, cloned TTS, and privacy-safe diagnostics only. It does not add
text-chat behavior or UI controls.

The following constraints remained fixed:

- Coach is a continuous spoken vocal lesson, not messaging.
- The learner alone starts and ends the session.
- The selected uploaded preset is exactly the tutor voice. Reference audio is
  conditioning-only; generic/browser/mock fallback remains forbidden.
- The careful-speech endpoint remains exactly 1,800 ms candidate silence and
  4,500 ms conservative silence. Neither boundary was shortened.
- Tutor delivery remains paced at `0.76` through pitch-preserving FFmpeg
  `atempo`; the reference recording is never played as the response.

## Evidence-backed baseline

The reported short “hi?” pause had two independently verified backend hazards.

1. `voice-input-live` required 350 ms of voiced material before it evaluated
   either endpoint. A synthetic 200 ms utterance followed by 15 seconds of
   silence produced no Smart Turn call and no ASR submission. This was an
   unbounded short-utterance dead zone.
2. The likely live turn at 2026-07-22 23:36 used 2,081 prompt tokens and only 28
   completion tokens; GGUF completed in 2.302 seconds. The associated 96-character
   selected-reference TTS request then took 6.416 seconds before its first PCM
   bytes. The coach model was not the dominant stage for that turn.

The model service also had unrelated 15–21 second generations with much smaller
162–648-token prompts. They cannot be attributed to the live coach renderer, but
they proved that an unconstrained 1,024-token tail was unsafe for a realtime
two-sentence surface.

## Implemented changes

### 1. Bounded short greetings without weakening careful-speech safety

`backend/voice-input-live.js` now accepts at least 150 ms of detected voice only
at the existing 4,500 ms conservative boundary. Speech below the normal 350 ms
minimum still cannot use the 1,800 ms semantic cutoff. This gives “hi?” a bounded
exit while retaining the longer protection for careful phrasing, stutters, and
thinking pauses.

Regression coverage proves:

- 200 ms voice + 4,499 ms silence does not submit.
- The next 1 ms reaches the conservative boundary and submits once.
- Sub-350 ms speech never asks Smart Turn for the early cutoff.
- The exact 1,800/4,500 policy remains locked against client overrides.

### 2. Hard realtime renderer tail plus buffered-path telemetry

The live renderer budget is now 256 tokens on both buffered and SSE paths. Its
contract is at most two spoken sentences / 45 words plus small optional app-only
operation blocks. Buffered turns now mark signal completion, model request/model
completion, and final sanitizer completion, so `llm_ms` is no longer null.

An eight-turn synthetic stress probe covered greeting, adaptation, gentleness,
identity joy, normal conversation, concrete coaching, capture repair, and a
memory preference. All eight stopped naturally at 22–46 tokens, took
0.656–1.305 seconds, and had no truncation or degenerate output.

### 3. Sentence-first cloned synthesis

`services/voxcpm-tts/app/segmenter.py` now preserves complete sentence boundaries
even when a two-sentence reply is below the old 220-character segment ceiling.
VoxCPM therefore renders and paces the first complete sentence, emits it, and
generates the second sentence while the first is available to play.

This preserves complete phrases—no mid-sentence cutoff—and retains full-buffer
generation and bad-case retry inside each sentence.

### 4. Content-addressed selected-reference feature cache

VoxCPM previously re-encoded the same uploaded reference WAV into GPU features
for every uncached tutor sentence. `VoxCPMEngine` now keeps up to four encoded
reference prompt caches keyed by SHA-256 of the file content. Reusing a path with
different bytes rebuilds the features, so a newly uploaded voice cannot inherit
the old voice identity. The cache is cleared on model unload.

Observed reference preparation was 1.682 seconds on miss and 0 ms on subsequent
sentences/turns.

### 5. Durable, privacy-safe latency evidence

- The gateway journal now records live-input stage names and numeric timings for
  first PCM, speech detection, endpoint-to-ASR, ASR duration, and finalization.
- It records no audio, transcript, learner text, clip ID, session ID, or turn ID.
- VoxCPM now logs per-segment character count, segment index/count, exact-PCM
  cache hit, synthesis time, tempo time, and first-chunk time without text.
- Compatibility-route cache hits/misses now contribute to `/metrics`.
- The backend-generated coach `turnId` is now retained as a distinct runtime
  value and sent to TTS. It no longer reuses the unrelated legacy coach-task ID,
  so model and speech timing records correlate on the real spoken turn.
  Auxiliary speech such as target-line playback always uses a fresh local ID
  and cannot overwrite the preceding coach turn's latency record.

### 6. Cancellation-safe synthesis admission and voice-identity cache invalidation

VoxCPM synthesis now runs through one dedicated worker and tracks the actual
executor future. If an HTTP stream is cancelled, the service remains busy until
the underlying GPU call really finishes; another request receives `429` instead
of overlapping model/cache mutation. Shutdown drains that worker before model
unload, with a bounded service stop window.

The exact-PCM disk cache now includes a SHA-256 digest of reference *content*,
not merely its path. Replacing a downloaded/uploaded sample at the same path
therefore cannot replay audio synthesized in the previous voice. Cloning logs
and dependency request logs no longer expose reference paths or download URLs.

### 7. Cold-start lifecycle budget

The gateway readiness gate inherited a 15-second host startup timeout even
though cold VoxCPM model loading had taken 27.61 seconds. The canonical and
active systemd configuration now allow 60 seconds for gateway startup, while
the VoxCPM service has 75 seconds to drain synthesis and unload cleanly.

### 8. Selected-reference prewarm on learner-owned Start

VoxCPM now exposes a reference-only preparation route. It content-hashes and
encodes the selected reference into the existing prompt-feature cache without
generating, returning, or playing any audio. Coach Start launches this work in
the background after the analyzer has acknowledged the exact reference target,
so Start itself remains immediate. If the learner reaches the first tutor reply
while preparation is still running, the speech proxy waits on that same promise
instead of colliding with VoxCPM's single GPU worker.

The cold preparation cost measured **1,420–1,588 ms**. This work is now paid
during the learner's first speaking turn rather than after the tutor response is
ready to synthesize. The implementation remains fail-open to the existing honest
generation path if prewarm is unavailable; it never substitutes another voice.

Prewarms are globally serialized across sessions and preset changes. A queued
prewarm re-checks that its reference is still current before admission, retries
categorical `429 busy` responses with a bounded backoff, and the gateway close
path prevents new admissions while retaining a drain promise for admitted work.
Late VoxCPM worker failures are consumed and logged by exception category only.
If cancellation leaves the GPU worker occupied beyond the prewarm backoff, the
real `/generate` admission now retries categorical `429 busy` responses within
the existing request-phase timeout. A released worker continues the same reply;
a persistently occupied worker ends at the configured timeout rather than an
immediate learner-visible `502`.

### 9. Lower first-sentence tail without partial speech

The prior 40-character minimum merged a complete 37–39 character opening
sentence into the next sentence, producing an 80+ character first synthesis and
roughly doubling time to first PCM. The first *complete* sentence now has a
conservative 24-character floor; truly tiny fragments such as `Okay.` are still
merged. Later fragments retain the 40-character floor, and the 220-character
maximum remains unchanged.

The boundary parser now preserves decimals, common abbreviations, intra-token
punctuation, and closing quotation marks instead of inserting spaces or moving
quotes between segments.

An initial old-policy observation was **1,752 ms median / 3,297 ms batch maximum**
across 7 runs. A preliminary 10-run candidate observation was **1,763 ms median /
1,983 ms batch maximum**. Because these were small, different cohorts, they are
evidence of an observed tail reduction—not a general p95 claim. AutoResearch run
`ars-mrwtgxlk-ieccgt` recorded and selected between those supplied observations;
it did not itself execute the audio requests.

The final cache-disabled benchmark harness is
`studio/code/benchmark-selected-reference-tts.mjs`. Against the deployed service,
its first post-restart 10-run batch reported a **1,648 ms upper-middle p50
estimate / 2,977 ms maximum** (including the cold first generation kernel). An
immediately repeated steady 10-run batch reported a **1,650 ms upper-middle p50
estimate / 1,886 ms maximum**. Both batches used
unique uncached first sentences, reference prewarm, rate `0.76`, cloned-synthesis
proof headers, and discarded PCM. The harness now calculates the conventional
even-sample median, retains nearest-rank p95 labeling, and rejects an empty first
audio read; the wording above preserves exactly what the earlier runs recorded.

## Post-change backend benchmarks

All measurements used synthetic text, discarded PCM, the selected reference as
conditioning, rate `0.76`, and no phone/audio playback.

| Case | First body PCM | Total response | Notes |
|---|---:|---:|---|
| Historical 96-char selected-reference reply | 6,416 ms | 6,420 ms | old one-segment cold miss |
| Latest 104-char two-sentence reply, reference-feature cold | 5,258 ms | 7,849 ms | includes 1,575 ms feature preparation and cold clone path |
| Latest 109-char two-sentence reply, reference-feature warm | 1,923 ms | 4,287 ms | fixed service deployed; first sentence available while second renders |
| New 103-char one-sentence reply, reference-feature warm | 4,524 ms | 4,526 ms | unsplittable control |

The steady selected-reference two-sentence first-audio improvement is
`6,416 - 1,923 = 4,493 ms`, or 70.0%.

## Verification receipts

- Backend Node suite: **597 passed, 0 failed**.
- VoxCPM Python suite: **97 passed, 0 failed**.
- Frontend orchestration suite: **684 passed, 2 skipped, 0 failed**.
- Focused endpoint/ASR/Smart Turn suite: **33 passed, 0 failed**.
- Focused modified VoxCPM set: **63 passed, 0 failed**.
- JavaScript syntax, Python byte-compilation, and `git diff --check`: clean.
- Live services after reload: gateway, GGUF, VoxCPM, VoiceTrainer, and ASR all
  online; restarted services report zero restart loops.
- Effective lifecycle limits: gateway startup **60 seconds**, VoxCPM graceful
  stop/drain **75 seconds**.
- A cold service restart loaded VoxCPM in **20.73 seconds** and allowed the
  gateway readiness gate to complete with **zero restart loops**.
- Independent post-change endpoint, TTS, and adversarial reviews: **PASS**.

Second optimization pass receipts:

- Recursively discovered backend Node suite: **604 passed, 0 failed**.
- VoxCPM Python suite: **109 passed, 0 failed**.
- Focused prewarm gateway integration proves Start does not wait and generation
  cannot enter before an in-flight prewarm completes.
- Model tests prove preparation performs no synthesis, is content-addressed,
  hits on unchanged bytes, and rebuilds when bytes change at the same path.
- Segmentation tests prove 24+ character complete opening sentences stream
  independently while truly tiny fragments still merge; decimals, abbreviations,
  and closing quotes remain byte-for-byte intact.
- Cross-preset tests prove Start A → End → select B → Start B cannot overlap
  prewarms; busy retry and gateway-close drain/skip paths are covered. Separate
  generation-admission kill tests prove a worker that releases after two `429`
  responses continues successfully, while persistent busy state uses the phase
  timeout and never becomes an immediate `502`.
- Seeded privacy tests prove exception-carried reference secrets never enter
  logs, and a timed-out worker's later failure is consumed categorically.
- Live VoxCPM and gateway health: online after deployment; generated benchmark
  PCM was read, counted, and discarded without phone playback.
- Independent identity/privacy, evidence, and final concurrency re-reviews:
  **PASS** with no remaining blocker.

## Deferred gates

Native `generate_streaming` plus a persistent streaming `atempo` pipe could
reduce the remaining 2.0-second first-sentence generation latency. It is not
enabled yet because VoxCPM disables bad-case retries in native streaming mode,
and cancellation, chunk seams, speaker similarity, ASR fidelity, pacing, and
listening quality need proof. Reducing inference steps from 8 to 6/4 also showed
large compute gains, but requires the same auditory quality gate.

When the phone is available, validate:

1. A short “hi?” completes at the conservative boundary instead of hanging.
2. A normal careful sentence is not cut at a thinking pause.
3. The first tutor sentence begins materially sooner and the second follows with
   no audible seam, cutoff, overlap, or pacing change.
4. The tutor voice remains the selected uploaded preset on every turn.
5. Large-font/no-scroll UI behavior separately; this backend slice did not alter UI.

## Physical Start-path optimization and repeatability — 2026-07-23 evening

The connected Pixel exposed a separate pre-speech delay: the first measured
Start took **8,430 ms** to reach Listening even though microphone capture and the
live-input service were healthy.

The measured causes were cumulative:

- session prepare and state mutations returned the complete learner snapshot,
  producing roughly 279 KB responses for state changes that needed only a few
  fields;
- Start synchronously queued lesson planning even though the voice-only Coach
  does not force a warm-up or need a plan before listening;
- continuous-mode persistence added another serial cockpit request after the
  live socket had already been accepted;
- the selected learner snapshot was loaded more than once during a coach turn;
- narrow responses initially exposed a frontend merge bug: an omitted
  `providers` property was interpreted as backend availability becoming
  unknown, making every subsequent Start resolve Backend input to `none`.

The deployed fix now:

- uses narrow mutation payloads for lifecycle, cockpit, and input-runtime
  writes;
- leaves lesson-plan creation explicit rather than blocking Start;
- commits `continuousEnabled` atomically with activation;
- treats the post-socket local continuous update as a local mode commit, not a
  second preflight or hidden practice-loop arm;
- releases any restored hidden practice owner once at standalone boot;
- reuses the already-loaded learner snapshot during reply construction;
- preserves verified provider health when narrow mutation payloads omit health
  fields.

`studio/code/probe-phone-start-latency.mjs` records the phone DOM lifecycle,
fetches, `getUserMedia`, AudioContext/worklet setup, WebSocket acceptance, first
PCM, server witnesses, cleanup, and categorical frontend start-stage logs. It
does not capture audio or learner content.

Six consecutive Pixel Start→Listening→End cycles passed after the final fix:

| run | Start→Listening | socket accepted | open→first PCM |
|---:|---:|---:|---:|
| 1 | 1,472 ms | 1,183 ms | 246 ms |
| 2 | 2,288 ms | 1,981 ms | 268 ms |
| 3 | 2,335 ms | 2,083 ms | 214 ms |
| 4 | 1,409 ms | 1,134 ms | 196 ms |
| 5 | 1,651 ms | 1,357 ms | 223 ms |
| 6 | 1,877 ms | 1,637 ms | 212 ms |

The median Start latency is **1,764 ms**, the observed maximum is **2,335 ms**,
and all six cycles cleaned up to zero live connections. Relative to the
8,430 ms physical baseline, the median reduction is **6,666 ms (79.1%)**.

The six-run cohort used `voice-runtime-5VvFVgqV.js`. After reducing diagnostic
console noise, the final served `voice-runtime-BO8JMwfq.js` separately passed at
**1,324 ms Start→Listening / 203 ms open→first PCM** and cleaned up to zero live
connections. The 411×809 no-scroll surface still exposes exactly the Aster
preset button and Start/End button, with no messaging affordance or reference
player source.

Post-fix synthetic production crossings also passed:

- a 46.93-second clean fixture completed GPU ASR in 1,700 ms;
- a 0.60-second short fixture completed GPU ASR in 285 ms and reached final in
  419 ms of server/model overhead;
- a deliberate 1.2-second mid-thought pause remained one turn under the locked
  1,800/4,500 endpoint policy.

These synthetic timings inject PCM faster than real time. They isolate backend
overhead and do not include the protected silence window.

The remaining gate is deliberately human and auditory: speak a real short
greeting and a careful sentence on the phone, then confirm the selected Aster
voice begins promptly, remains intelligible at rate 0.76, finishes both
sentences without cutoff or overlap, and returns to Listening. No reference
recording may be played as a substitute for that gate.
