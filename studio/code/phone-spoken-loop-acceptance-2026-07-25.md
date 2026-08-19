# TransVoice Coach physical spoken-loop acceptance

Date: 2026-07-25 · Device: Pixel 9 (`46271FDAQ000BC`) · Route:
`https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1` · Result:
**PASS**

## Product contract under test

Coach is a continuous spoken lesson, not messaging. Its normal phone surface is
one fixed, no-scroll canvas with exactly:

1. the selected named voice-sample preset; and
2. the learner-owned `Start` / `End` control.

After `Start`, the loop must hear the learner, detect a real turn boundary,
process the spoken turn, speak the complete response in the selected cloned
voice, and reopen the microphone automatically. `End` must stop the loop at any
point. No transcript, chat history, replay button, reference player, hidden
fallback voice, or coach-owned stopping decision belongs in this contract.

## Defects found and repaired

| seam | defect | repair |
|---|---|---|
| phone PCM → live gateway | The client waited for `capture-ready` before marking capture active while the gateway discarded all pre-active PCM, creating a circular readiness wait. | A valid leased first frame now confirms transport and emits `capture-ready` during the starting phase. Bytes are still not retained or processed until the durable session is active. |
| PCM response → worklet accounting | `ArrayBuffer` transfer detached the typed array before its length was added, so real playback could be reported as zero queued samples. | Sample count is captured before transfer. An entirely zero-sample response fails closed and cannot acknowledge `/speech/played`. |
| runtime state → visible Coach activity | Internal controllers retained the runtime bridge's original render function and bypassed the standalone wrapper, leaving the visible surface at `Ready` during hearing/processing. | The shared host runtime bridge now owns removable, error-isolated render observers. Every internal render synchronizes the Coach surface and microphone floor. |
| tutor playback → microphone reopen | Render and post-playback handoffs could call input start concurrently. Each input start selected a new owner and invalidated the other, so the acknowledged post-playback start returned `false`. | The runtime coordinator now single-flights only concurrent continuous-listening requests. Input-controller replacement semantics remain unchanged. |
| deterministic phone verifier | The first verifier revision continued dropping the real microphone frames after its first injected fixture, causing a false second-session PCM timeout. | Fixture ownership ends with the first learner turn; suppression is released before the post-playback capture handshake. |

Privacy-safe phone diagnostics expose finite state and gate outcomes only. They
contain no learner speech, transcript, tutor text, prompt, session identifier,
memory, preset identifier, or audio bytes.

## Physical end-to-end receipt

`TRANSVOICE_ACOUSTIC_OUTPUT=phone-socket-fixture
TRANSVOICE_SPOKEN_LOOP_TIMEOUT_MS=70000 node
studio/code/verify-phone-spoken-loop.mjs`

The fixture is the repository's public Aster test WAV. It enters through the
Pixel WebView's real leased WebSocket only after the phone has independently
opened its microphone and the gateway has confirmed capture readiness.

| boundary | elapsed from Start |
|---|---:|
| first `Ready — speak now` | 1.554 s |
| positive speech evidence / `Hearing you` | 1.768 s |
| endpoint + processing / `Thinking…` | 9.629 s |
| real phone audio / `Speaking` | 12.359 s |
| tutor playback complete | 19.881 s |
| second `Ready — speak now` | 20.706 s |

Gateway witnesses:

- first live session: `session-opened → capture-ready → first-pcm →
  speech-started → semantic complete → asr-started → asr-completed`;
- GPU ASR: **542 ms**;
- tutor speech: actual PCM playback in the Pixel WebView, not a status-only
  transition;
- second live session: a second `session-opened → capture-ready → first-pcm`;
- handoff: `start-continuous-listening`, `listeningStarted=true`;
- final gate: `PASS`, no surfaced error.

The verifier then pressed `End`, confirmed the stopped state, restored its
temporary WebSocket proxy, and left the phone idle.

## Selected-voice and complete-playback receipts

The silent Pixel WebView synthesis verifier independently proved that Aster
resolved as selected-reference, `cloned-synthesis`, `conditioning-only`, rate
`0.76`, 48 kHz signed PCM16. One run returned 463,190 bytes / 4.8249 seconds,
and GPU ASR recovered the exact requested target sentence. The hash and duration
were distinct from the reference recording, so the source was newly generated
target text rather than replayed reference audio.

The physical loop observed actual phone playback until its final queued sample
and did not reopen capture until playback ended. Previous physical drain runs
also recorded honest non-zero playback accounting (341,741–351,308 samples,
7.12–7.32 seconds, zero underruns). Perceptual similarity to the named person
remains a human listening judgment; routing, conditioning, generation evidence,
complete drain, and non-reference-replay are mechanically proven.

## Phone UI and accessibility receipts

At the restored default Android font scale:

- viewport and document: **411 × 809**, scroll position 0, no horizontal or
  vertical overflow;
- visible controls: exactly `Aster` and `Start`;
- Start center: **540 px**, the 2/3-height thumb target;
- no visible text/message affordance;
- no reference-audio player;
- visible contrast: preset **14.89:1**, Start **8.34:1**, pronunciation
  **8.71:1**;
- persistent controls are at least 44 px high.

The preset disclosure physically proved three named uploaded-sample presets,
exactly one selected, an `Upload new voice sample` action, required name and
audio inputs, correct focus movement, Cancel containment, Escape closure, and
no change to Aster.

Android font scale was then set to **130%** and **200%** in separate physical
passes. At 200%, Start rendered at 36 px and the pronunciation at 36.2 px /
98 px high, while the 411 × 809 document remained fixed and unscrolled, the
action remained centered at 540 px, contrast remained unchanged, and the preset
disclosure still passed. The script restored the original **100%** setting and
relaunched the app after each pass.

## Final regression and deployed state

- frontend: **96 files, 710 passed, 2 intentional skips**;
- backend: **672 passed, 0 failed**;
- focused spoken-loop seams: **122 passed**;
- TypeScript + Vite: **112 modules transformed**, production build passed;
- `git diff --check`: passed;
- served runtime: `voice-runtime-BhKQpBD2.js`;
- gateway: active; VoiceTrainer, coach GGUF, VoxCPM, ASR, learner memory, and
  session memory all online;
- learner/session stores: healthy, unblocked, zero recovery/failure counters;
- telemetry: `ok`, current, sink failure count 0, no current failure families;
- final phone: Android font scale 1.0, `Aster`, `Start`, stopped, no diagnostics.

## Remaining honest residual

The deterministic loop uses a known public fixture so failures are repeatable.
It proves the phone transport and full conversational machinery, but it does
not replace a varied human corpus for careful pauses, stutters, accents, room
noise, or the learner's subjective judgment of voice identity and pacing.
Those are acceptance inputs, not unproven implementation seams.
