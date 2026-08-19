# Selected-preset tutor TTS receipt — 2026-07-22

Automated verdict: PASS for target-text synthesis, selected-reference conditioning/routing integrity, measured pace, fail-closed model readiness, fail-closed stream delivery, privacy-safe witnesses, and silent phone-route proof. Learner acceptance remains OPEN for one complete phone-speaker turn, comfortable pacing/pauses, clear technique-word emphasis, and perceptual preset-voice identity.

## Incident truth

One diagnostic verifier was confirmed to have played the saved Aster reference recording through the phone, and stopping that verifier cut its playback off. The reported sound occurred during that diagnostic period, but there is no timestamped incident receipt proving that it was the same sound; attribution therefore remains unconfirmed. Diagnostic reference playback must not be used on the phone again.

The investigation found four independently reproducible production hazards: multi-second PCM bursts could overwrite a 0.2-second AudioWorklet ring; an upstream timeout/error after HTTP 200 was converted to clean partial EOF; the gateway's one timeout budget began before uncached reference preparation; and End/audio-device stalls could leave playback promises unsettled, including a never-settling `AudioContext.resume()` or a short final PCM drain with no completion event. A fifth honesty defect let model-load failure report healthy cloned TTS while emitting placeholder sine audio. All five hazard classes are now repaired and kill-tested.

## Shipped contract

- A selected recording is conditioning input only. It is never a tutor-audio response.
- VoxCPM must synthesize the requested target text and return all of these facts before the gateway or browser will permit playback:
  - `X-Voice-Speech-Provider: voxcpm`
  - `X-Reference-Resolved: true`
  - `X-Voice-Cloned: true`
  - `X-TTS-Generation-Mode: cloned-synthesis`
  - `X-Reference-Audio-Role: conditioning-only`
  - the exact bounded `X-Speaking-Rate-Applied`
- Missing, ambiguous, unresolved, or mismatched evidence fails closed. A selected preset is never replaced with generic browser speech.
- Model readiness means the real VoxCPM model object is loaded. Load failure makes health/readiness and synthesis return 503; the production service has no placeholder-audio fallback.
- Normal Coach speech uses a fixed `0.76` rate. A spoken repeat-slower repair uses `0.65`. There is no pace button or extra UI.
- Tempo is applied after synthesis with FFmpeg `atempo`, preserving pitch. The unpaced synthesis is cached, so alternate rates cannot compound time-stretch artifacts.
- The renderer writes for listening: maximum two complete sentences / 45 spoken words, short clauses, clear punctuation, and one technique word placed where natural TTS stress is possible. It may not end mid-sentence.
- The PCM player waits for explicit `consumed` samples before enqueueing more. The worklet refuses overflow, renders the final sample before clean `ended`, reports cancellation explicitly, and bounds no-consumption and final-drain stalls. A pending or rejected audio-context resume is abortable and time-bounded; End always settles and disposes the audio context.
- Gateway preparation and each body read receive independent inactivity budgets. A timeout, cancellation, or upstream failure after response start destroys the downstream body instead of emitting clean EOF, so the browser rejects the utterance and cannot call `/voice/speech/played`.
- The phone Coach composition never attaches the selected recording URL to its hidden legacy audio element. The recording can cross only as server-side conditioning input.
- A selected reference bypasses the built-in profile description completely. A masculine, neutral, or custom recording can no longer be biased by the default feminine design prompt.
- Cache identity includes the synthesis-policy context. Audio cached under the old mixed-description policy cannot masquerade as current selected-reference output.
- The old think-gap filler was unreachable in the current app and was not the incident sound; it was removed anyway so it cannot be reconnected as lesson padding.

## Silent physical-phone proof

`studio/code/verify-phone-tts-synthesis.mjs --verify-asr` ran inside the connected Pixel 9 WebView at the real Tailscale `/app` origin. It fetched and consumed the response without creating an audio element, AudioContext, or speaker playback.

Synthetic target: 12 words / 72 characters.

Observed response:

- HTTP 200, provider `voxcpm`;
- reference resolved and voice cloned;
- mode `cloned-synthesis`, reference role `conditioning-only`;
- rate `0.76`;
- PCM16 mono, 48 kHz;
- 523,646 bytes / 5.454646 seconds;
- measured delivery pace approximately 132.0 WPM;
- generated SHA-256 `75983f9c977c89385942f5cba338d159035e2755f514b8bd80466bb113b4b2dd`.

GPU Parakeet ASR recovered exactly:

> Keep the sound forward. Let bright land clearly, then soften the ending.

The selected Aster reference is 12.000 seconds with SHA-256 `d19aed07c97d39610ae9dce757f42f181868bb8baeac97dab04eec5fb74c9855`. Different duration, digest, and recognized words falsify direct reference playback. This proves newly generated target speech and selected-reference conditioning/routing; it does not by itself prove perceptual voice identity.

The uncached corrected synthesis reached its first and only PCM segment in 5.85 seconds. `Thinking…` remains visible during this interval; `Speaking` begins only on the first audible frame. This latency is a declared optimization target, not hidden as playback or filler.

## Phone and deployed-asset proof

- Pixel 9 WebView: 411×809, no document/canvas scroll, exactly preset + Start/End, no messaging affordance.
- Selected preset: Aster.
- A startup trace found a redundant second session hydration blocking on `/voice/cockpit/line` for 24.46 seconds. Removing that duplicate reduced physical-Pixel cold restoration from observed 13.56–26.70 seconds to 2.002 seconds; Aster and enabled Start return without interaction.
- Latest built bundle awaiting physical-phone reload: `assets/voice-runtime-C1nn7YbU.js`. The last silently verified phone runtime served `assets/voice-runtime-EGzvonBg.js`.
- Tested and served PCM worklet SHA-256: `932c80dca9c8fd6cbde9a85987349e820cfb59e540e8100ebb72af409b49d936`.
- Gateway and VoxCPM services are active; VoiceTrainer, coach model, TTS, and GPU ASR report online.

## Automated gates

- Closing source gates before the final receipt-only documentation edits: backend 591/591; frontend 684 passed + 2 intentional skips across 95 files; VoxCPM 91/91; TypeScript and production build passed; `git diff --check` passed. Re-run the diff check after these documentation edits on resume.
- Backpressure kill tests prove a 7,200-sample burst never places more than 4,800 samples in a 4,800-sample worklet, resumes only after consumption, preserves the final sample, and rejects overflow.
- Synthesis tests prove the rate bounds, duration change, pitch preservation, evidence headers, fail-closed gateway/browser checks, reference-only identity, and cache-policy isolation.
- Endpoint tests inject a deterministic fake model object. The production engine has no mock-audio mode, and explicit `mock-synthesis` evidence is rejected by the gateway.
- Stream kill tests prove partial timeout/cancel bodies reject, cannot acknowledge playback, and preserve the gateway failure witness; a deliberately slow uncached reference preparation plus multi-chunk response succeeds because each active phase receives a fresh budget.
- Cancellation and liveness tests repeat End during queued PCM three times, interrupt a real player whose audio-context resume never settles, time-bound an independently stuck resume, and time-bound a short final drain whose worklet never emits completion. Every path aborts/disposes, reports selected-voice playback failure, and proves no `/voice/speech/played` acknowledgement.

## Residuals and next falsifier

- The pace is objectively measured and the words are ASR-intelligible. Comfortable teaching pace, clause pauses, technique-word emphasis, and perceived preset identity are human-listening questions.
- No automated tool may claim the post-fix phone speaker rendered a complete tutor sentence; this proof intentionally stayed silent after the earlier verifier mistake.
- The next valid check is one learner-owned Start, one real spoken turn, and confirmation of all four: the sentence finishes, the overall pace/pauses are comfortable to understand, the technique word lands clearly, and the tutor sounds like the selected preset. If it cuts out, inspect gateway `tts-synthesis / Tutor speech stream interrupted`, client `tts-playback / playback-interrupted|pcm-underrun|pcm-overflow`, and the turn fallback/duration before changing the model.
- Native incremental VoxCPM streaming may reduce the roughly 5.85-second uncached first-audio delay, but it must preserve selected-reference conditioning/routing integrity, the human-confirmed preset identity, the 132 WPM teaching pace, complete-tail backpressure, and all synthesis-evidence gates.

## Reproduce

```bash
TRANSVOICE_CDP_URL=http://127.0.0.1:9223 \
  VOICE_ASR_URL=http://INTERNAL_HOST:PORT \
  node studio/code/verify-phone-tts-synthesis.mjs --verify-asr

TRANSVOICE_CDP_URL=http://127.0.0.1:9223 \
  node studio/code/verify-phone-coach-surface.mjs --reload

TRANSVOICE_CDP_URL=http://127.0.0.1:9223 \
  node studio/code/verify-phone-telemetry.mjs --read-only

curl -fsS 'http://127.0.0.1:3021/voice/debug/events?since=0&limit=200' \
  | jq '[.events[] | select(.kind == "tts-synthesis" or .kind == "client:tts-playback")]'
```
