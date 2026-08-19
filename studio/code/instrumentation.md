# Instrument: Voice Tutor failure telemetry

Mode: RETROFIT · Medium: service + remote web frontend · Date: 2026-07-22 · Status: VERIFIED — service, automated, and physical Pixel gates complete

Literal ask: add enough telemetry to localize any plausible Voice Tutor failure.

Goal: a failed boot, request, stream, audio path, fallback, or persistence seam must leave a privacy-safe, correlated witness that survives the browser or server restarting.

Success bar: healthy operation is quiet apart from one boot breadcrumb; every selected seam has a structured failure event, fixed-cardinality health, and a kill test that proves the witness fires.

## SEAM MAP (I-G1)

| id | kind | seam | boundary? | silent? | tier |
|---|---|---|---|---|---|
| S1 | BOOT | HTML pre-bundle harness → health → session → passive workflow sync → standalone ready | yes | yes | load-bearing |
| S2 | EMITS | browser global error/rejection/offline → `/voice/debug/event` | yes | yes | advisory, counted |
| S3 | JOINS | existing runtime diagnostics → remote debug bus | yes | yes | advisory, counted |
| S4 | JOINS | HTTP request → gateway response/abort | yes | yes | advisory, counted |
| S5 | JOINS | WebSocket/audio capture/TTS fallback → runtime diagnostics | yes | yes | advisory, counted |
| S6 | EMITS | debug bus warning/error → persistent JSONL | yes | yes | advisory, counted |
| S7 | STATE | persistent telemetry status → health reader | yes | yes | advisory, stale-at-read |
| S8 | CONTRACTS | client event schema → safe server ingest | yes | yes | advisory, reject malformed |
| S9 | BOOT | fatal Node process event → persistent witness before exit | yes | yes | advisory, counted |
| S10 | JOINS | visible control click → DOM/semantic effect → server ingest | yes | yes | advisory, durable |
| S11 | BOOT | login/default target → four TransVoice services | yes | yes | load-bearing target |
| S12 | BOOT | systemd process start → gateway listener readiness | yes | yes | load-bearing |
| S13 | JOINS | phone WebSocket open/PCM → gateway live-turn owner | yes | yes | load-bearing |
| S14 | EMITS | candidate silence/current PCM tail → Smart Turn decision/fallback | yes | yes | load-bearing, advisory model |
| S15 | JOINS | accepted PCM→WAV Buffer → existing GPU ASR/session owner | yes | yes | load-bearing |
| S16 | JOINS | selected reference + target text → VoxCPM → synthesis-evidence gate | yes | yes | load-bearing |
| S17 | JOINS | response PCM burst → browser worklet ring → final audible sample | yes | yes | load-bearing |
| S18 | JOINS | learner Start → WebView microphone → gateway capture-ready | yes | yes | load-bearing |
| S19 | JOINS | tutor final audible sample → single post-playback microphone reopen | yes | yes | load-bearing |

Excluded: interior deterministic state reducers and render formatting. They are not boundary+silent seams and remain covered by unit tests.

## WITNESSES (I-G2)

| seam | failure witness | fallback accounting | boot breadcrumb |
|---|---|---|---|
| S1 | `client-runtime / boot-skip / boot-timeout|boot-incomplete`; the last fixed phase localizes the stall | none | `telemetry_boot` once; `health-ready → session-ready → workflow-ready → app-ready` |
| S2 | safe client `seam/class/code/phase` event | client dedupe + suppression count | none |
| S3 | diagnostic category mapped to ledger class | occurrence count remains in existing runtime diagnostics | none |
| S4 | request event with server trace ID, status, duration, abort | HTTP failures counted per seam | none |
| S5 | existing input/transport/TTS diagnostics cross S3 | every fallback remains explicit | none |
| S6 | sync append failure flips telemetry health degraded and emits one stderr line | fail count + last error | sink boot row |
| S7 | stale status reads RED | n/a | periodic status heartbeat |
| S8 | malformed/oversize events return 400/413 and are counted | no unsafe payload persisted | none |
| S9 | fixed `fatal-process-event / partial-function` event | legacy stderr and exit path still run | none |
| S10 | `control-activated` + `control-observed`, stitched by page trace and attempt | categorical DOM effect only; no button text | none |
| S11 | systemd unit state, `NRestarts`, and journald identity per component | each component retains its own restart policy | target activation |
| S12 | structured `not-connected` refusal after identity + Trainer + GGUF + VoxCPM health probes | systemd restart policy retries the failed activation | none |
| S13 | `session-opened`, `first-pcm`, `speech-started`, dropped-frame count, close/cancel class; timing only | active connection count and bounded rejected/dropped-frame counters | live handler attached/readiness state |
| S14 | `complete|incomplete|unavailable`, probability band, stale-decision outcome; never probability/audio/text | detector fallback count, pending count, bounded last error | `ready|degraded|disabled` detector state |
| S15 | `asr-started|asr-completed|asr-failed` with boundary, byte count, open/first-PCM/speech→ASR and provider/total durations | provider errors and cancellation remain categorical; stale work commits nothing | existing ASR readiness/provider identity |
| S16 | `tts-synthesis` with provider, `cloned-synthesis`, `conditioning-only`, applied rate, and verified/interrupted outcome; no text, reference ID, or audio | reference resolution, model readiness, stream timeout/error, and evidence mismatch stay explicit; selected voice never substitutes | real VoxCPM model ready + synthesis policy/version |
| S17 | client `tts-playback / pcm-underrun|pcm-overflow|playback-interrupted` plus per-turn first-audio/playback-done timings | first bounded underrun only; overflow, capacity stall, pending/rejected resume, final-drain stall, or body failure aborts; normal completion remains quiet | deployed worklet hash and player/audio-context availability |
| S18 | privacy-safe DOM/fetch/getUserMedia/worklet/WebSocket/first-PCM stage timings plus server `session-opened → capture-ready`; never content | startup failure remains fail-closed and End closes the lease | input provider and semantic detector ready |
| S19 | finite-state `action`, `listeningStarted`, owner/gate booleans, plus a second server `session-opened → capture-ready → first-pcm`; never text/audio/identity | concurrent reopen callers share one coordinator operation; lower input replacement semantics remain intact | post-playback coordinator attached |

Privacy budget: never persist transcripts, prompts, session IDs, learner memo, audio, request bodies, query values, tokens, cookies, or authorization headers. Client fields cross a closed server vocabulary; unknown categorical-looking text is rejected or dropped. Correlation IDs are random per page/request and contain no user identity.

## SELF-CHECK + HEALTH (I-G3)

- Boot path: `createVoiceStandaloneApp` constructs and starts the sink before request middleware and routes.
- Service boot path: `default.target` wants `transvoice.target`, which wants the gateway, VoiceTrainer, coach LLM, and TTS units; the gateway unit and three deployment drop-ins make every component `PartOf=transvoice.target`.
- Probes: sink directory writable; status file writable; client schema valid; debug routes mounted before app routes.
- Health: `~/.local/share/sloane/transvoice/status.json`, overwritten; `/voice/debug/health` reports only degraded/stale deltas and counters.
- Staleness: computed when health is read; a stopped heartbeat turns RED.

## PROOF (I-G4)

Completed kill tests:

- missing/unwritable sink → degraded health + exact `partial-function` class;
- stale status timestamp → RED;
- hostile client payload → safe categorical event only;
- malformed and flooded client events → 400/429 with one bounded witness;
- global browser error + rejected promise → exact client seam/class event;
- fatal process event → debug bus witness before legacy exit;
- prior Pixel WebView thrown error → server bus and persistent JSONL with the same page trace ID;
- managed service → `active/running`, zero restarts, telemetry health `ok` after final restart.
- visible button activation → durable categorical control row followed by an observed DOM-effect row with the same attempt number.
- Historical pre-voice-only UI only: Hear Line and Listen Back once produced explicit effect rows. Those controls are removed from the current Coach contract and must not be restored from this receipt.
- configured VoxCPM unavailable → `/health` and active readiness return 503.
- arbitrary private text encoded into client seam/code/phase/control/effect → rejected or removed before bus storage.
- killed gateway process → systemd restart counter increments and the Tailscale route returns HTTP 200 after readiness completes.
- wrong-port readiness probe → activation refuses with the exact structured `not-connected` witness.
- stopped VoxCPM service → `/health` returns 503 and the readiness gate refuses with the same exact witness; after service recovery health returns online.
- startup audio deadlock → fresh browser previously stopped before `app-ready`; passive bootstrap now reaches `health-ready → session-ready → workflow-ready → app-ready` without arming audio.
- stale build manifest → building before restarting the gateway serves the exact current hashed JS asset; restarting before a build is an invalid deployment order because the gateway caches the HTML manifest at process start.
- fresh 360×800 browser → Welcome, mic-check skip, chooser, preset cards, and practice all cross with a 360×800 document, no overflow, no descendant scrollers, and no clipped visible buttons.
- physical Pixel 9 (`net.sloane.voicetutor`) → Android WebView loaded `https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1`; CSS viewport and document remained exactly 411×809 in Coach with no horizontal/vertical overflow or descendant scrollers.
- physical microphone crossing → Android audio policy reported an active, unsilenced `CAMCORDER` capture owned by `net.sloane.voicetutor`; `/voice/session/start` and `/voice/session/take` both returned 200.
- Historical pre-voice-only target-speech/replay crossings remain diagnostic provenance only; neither is a current visible Coach affordance.
- silent physical take → measurement-validity gate rejected it and excluded it from achievements, proving the negative path rather than awarding false progress.
- live-input worker unavailable/timeout/queue-full → detector degrades and increments a bounded fallback counter while the 4.5-second conservative endpoint remains usable.
- resumed speech during a pending semantic prediction → generation changes, the stale result is ignored, and no early ASR/session mutation occurs.
- 900 ms candidate falsifier → a real human mid-thought prefix was classified complete, proving that the neural model alone cannot safely authorize such a short cutoff.
- deployed 1800/4500 policy → a real human fixture split after two seconds, followed by 1.2 seconds of deliberate silence, remained in one turn; the first pause reported `candidate-not-reached` and finalization used the conservative boundary only after the model reported incomplete.
- current-bundle complete-turn path → `session-started → speech-start → speech-end → processing → final-transcript`, 149 ms open→ASR, 326 ms provider ASR, 475 ms open→final; all witnesses passed the no-content scanner. The verifier injects frames faster than real time, so these durations isolate server/model/ASR overhead and do not erase the real 1.8-second protected pause.
- physical Pixel live path → one active PCM socket while `Ready — speak now`, detector `ready`, zero sockets after End, 411×809 no-scroll, and empty runtime diagnostics.
- two-phase session lease → a socket can be accepted during transient Start but pre-activation PCM is discarded; server acknowledgement precedes frontend success; End advances the generation, aborts in-flight ASR, suppresses late commits, and refuses old-lease reopen.
- first-audio truth → accepted TTS request remains `Thinking…`; only PCM `firstAudio`, media `playing`, or synthesis `onstart` publishes `Speaking`; completion/abort clears it.
- selected tutor-voice failure → fail-closed 409 headers are read before status rejection, generic TTS is never substituted, and one content-fixed visible recovery event is emitted.
- selected-reference conditioning/routing integrity → the built-in profile description is excluded whenever a recording is selected; the Coach page never attaches the recording to a player; cache policy is versioned; service, gateway, and browser require `cloned-synthesis` + `conditioning-only` + exact rate evidence before playback.
- silent Pixel-route synthesis → Aster-conditioned target text returned 523,646 bytes / 5.454646 s at rate 0.76; generated SHA-256 differs from the 12 s reference, and GPU ASR recovered the requested sentence exactly without playing it through the phone.
- PCM burst/tail backpressure → a 7,200-sample input cannot enqueue more than the 4,800-sample test ring; it resumes only after `consumed`, renders the final sample, and refuses overflow rather than silently dropping speech.
- partial upstream TTS body → timeout/error/cancel destroys the downstream response; browser consumption rejects, no played acknowledgement is possible, and the gateway fallback remains recorded.
- uncached clone preparation + multi-chunk delivery → each active phase receives a fresh inactivity budget, so preparation cannot consume the later speech-delivery window.
- missing real VoxCPM model → health/readiness/generation return 503 with no audio or synthesis evidence; explicit `mock-synthesis` is rejected at the gateway.
- repeated End/audio-device failure → three queued cancellation cycles settle/dispose with no played acknowledgement; End interrupts a real player whose resume never settles; an independently pending resume and a short final drain without a completion event both fail within a bound; rejected resume and no-consumption capacity stall remain covered.
- pre-active capture circular-wait kill test → the first valid leased PCM frame
  emits `capture-ready` during startup while content processing remains blocked
  until durable activation.
- detached transfer accounting kill test → browser-realistic `ArrayBuffer`
  detachment cannot turn a non-empty PCM queue into zero samples; an actually
  zero-sample response fails closed before `/speech/played`.
- physical full loop → Pixel WebView crossed Ready → Hearing → Thinking →
  actual tutor audio → Ready, with GPU ASR 542 ms, two live session opens, two
  capture-ready signals, a successful single-flight post-playback handoff, and
  clean End.
- physical Android text scaling → 130% and 200% enlarged computed Coach fonts
  while preserving the exact 411×809 fixed surface, 2/3-height Start target,
  contrast, preset disclosure, and zero page scroll; the phone was restored to
  100%.

## RIPPLE (S-G6)

- Upstream: `frontend/voice-tutor-app.html`, `frontend/src/runtime-diagnostics.ts`, and the standalone bootstrap produce client events.
- Downstream: `backend/voice-standalone-debug.js` persists failures and serves `/voice/debug/events` plus `/voice/debug/health`; operators and future agents read those surfaces.
- Sideways: `backend/voice-standalone-runtime.js` owns bus construction; security tests constrain redaction; Android WebView uses the same `/app` HTML and same-origin ingest.

## DELTA (I-G5)

| change | seam | map | witness | probe | kill test |
|---|---|---|---|---|---|
| persistent sink | S6/S7 | yes | yes | yes | yes |
| safe client schema/correlation | S2/S8 | yes | yes | yes | yes |
| pre-bundle harness | S1/S2 | yes | yes | yes | yes |
| runtime diagnostic bridge | S3/S5 | yes | yes | yes | yes |
| fatal process witness | S9 | yes | yes | yes | yes |
| client ingest flood control | S8 | yes | yes | yes | yes |
| control/effect tracing | S10 | yes | yes | yes | yes |
| boot-persistent service target | S11 | yes | journald + health | yes | process-kill restart test |
| listener readiness gate | S12 | yes | exact structured refusal | identity + full voice-stack health | wrong-identity and TTS-down kill-tests |
| live PCM gateway | S13 | yes | yes | input-status + envelope sequence | malformed/auth/oversize/close/resume tests + physical socket |
| semantic endpoint worker | S14 | yes | yes | detector health/fallback count | missing worker, timeout, malformed output, queue saturation, stale prediction, 900 ms falsifier |
| internal GPU ASR crossing | S15 | yes | yes | split pre-ASR/provider/total timings | provider error, timeout, abort, stale session, one-Buffer production crossing |
| selected-reference synthesis proof | S16 | yes | yes | evidence headers + service/gateway witnesses | ambiguous/mock headers, no-model/unresolved reference, generic-description exclusion, Coach source isolation, cache-context separation, Pixel silent-fetch + GPU ASR |
| complete PCM playback | S17 | yes | yes | first-audio/playback-done + bounded client/gateway interruption events | partial-body rejection, phase-budget, constrained-ring burst, final-sample, overflow/capacity-stall, pending/rejected-resume, final-drain, and repeated-End tests |
| physical Start latency | S18 | yes | privacy-safe stage timings | phone DOM/fetch/GUM/worklet/WebSocket/first-PCM timeline | six consecutive Start→Ready→End cycles; narrow-payload provider-omission regression |
| post-playback continuous loop | S19 | yes | safe handoff outcome + second live-session boundaries | `verify-phone-spoken-loop.mjs` | concurrent render/post-playback start regression + deterministic Pixel full-loop gate |

## Operator view

- Current merged health: `curl -fsS http://127.0.0.1:3021/voice/debug/health | jq`
- Recent correlated events: `curl -fsS 'http://127.0.0.1:3021/voice/debug/events?since=0&limit=100' | jq`
- Durable failures and control traces: `tail -f ~/.local/share/sloane/transvoice/witness.jsonl`
- Component errors: `journalctl --user -u 'voice-*' -u voxcpm-tts.service -p err --since -2h`
- Restart counters: `systemctl --user show voice-tutor-standalone.service voice-trainer.service voice-tutor-gemma4-iq4nl-attnq8-last10.service voxcpm-tts.service -p Id -p NRestarts`
- Deployment order: run the frontend build first, then restart `voice-tutor-standalone.service`; verify the served `/assets/voice-runtime-*.js` returns 200.
- Phone route: the Android app uses same-origin `:3021/app`; direct Tailscale `:8002` remains an intentional desktop/power-user VoiceTrainer surface maintained by the shared remote-access timer. Do not remove it as a phone fix.
- Live input health: `curl -fsS http://127.0.0.1:3021/voice/input/status | jq '.providers.backend.live'`
- Production turn falsifier: `node studio/code/verify-live-input-production.mjs`; deliberate-pause mode adds `TRANSVOICE_SPEECH_FIXTURE=voice-references/aster-voice-ref.wav TRANSVOICE_PAUSE_SPLIT_SECONDS=2.0 ... --deliberate-pause`.
- Threshold invariant: production candidate is exactly 1800 ms and conservative/recorded fallback is exactly 4500 ms. Client, environment, and persisted overrides are ignored. Any change requires a new accessibility review and deliberate-pause/careful-speech corpus receipts.
- Silent selected-TTS proof: `TRANSVOICE_CDP_URL=http://127.0.0.1:9223 VOICE_ASR_URL=http://INTERNAL_HOST:PORT node studio/code/verify-phone-tts-synthesis.mjs --verify-asr`. It fetches and hashes PCM but deliberately does not play it. `--headers-only` is diagnostic and exits incomplete; it cannot PASS.
- TTS playback diagnosis: filter `/voice/debug/events` for gateway `tts-synthesis / Tutor speech stream interrupted`, client `tts-synthesis`, and client `tts-playback / playback-interrupted|pcm-underrun|pcm-overflow|pcm-playback-complete`; the completion receipt records source/playback sample rates, queued/played sample counts, output duration, and underruns without text, audio, preset IDs, or reference IDs. Compare it with the VoxCPM `generate-compat` outcome/rate/first-chunk/byte count. The phone player resamples source PCM to the live Android `AudioContext.sampleRate`, so unequal hardware rates cannot accelerate or shorten tutor speech. Never log or replay the reference as a tutor-response diagnostic.
- Physical Start latency: with the current WebView forwarded to CDP 9223, run `node studio/code/probe-phone-start-latency.mjs`. The probe clicks Start and then End, records categorical timing only, and verifies zero live connections after cleanup. A narrow mutation payload without `providers.backend` must preserve the last verified provider-health snapshot; omission is not an offline signal.
- Physical full loop: `TRANSVOICE_ACOUSTIC_OUTPUT=phone-socket-fixture TRANSVOICE_SPOKEN_LOOP_TIMEOUT_MS=70000 node studio/code/verify-phone-spoken-loop.mjs`. It requires the phone to be idle with a selected preset, injects only the public repository fixture through the real phone socket, demands actual audio plus a second server-confirmed microphone-ready session, and always presses End/restores its proxy.
