# Instrument: TransVoice remote-phone no-response hunt — round 2

Mode: HUNT · Medium: service · Date: 2026-07-25 · Status: FIXED_DEPLOYED_AND_PHYSICALLY_PROVEN

## H-G0 REQUEST DECODE

| cell | value |
|---|---|
| SYMPTOM | Over the remote Tailscale path, the learner spoke and heard no tutor response. |
| CLASS | `partial-function`: capture and downstream generation worked, but playback was cancelled before the audible crossing. |
| CHAIN | phone mic → live WebAudio attempt → recorded fallback → ASR → coach runtime → selected-preset VoxCPM generation → phone playback → listening re-arm |
| OWNER-NAMED | Diagnose the actual remote incident, preserve the voice-only continuous conversation, and repair the silent path. |

## Failing incident receipts

The gateway debug ring for the 15:04 ACST attempt proves:

- The phone fetched the then-current deployed bundle
  `voice-runtime-D2M80bYS.js`; this was not a stale-client incident.
- Live WebAudio opened but produced zero PCM frames.
- Recorded fallback captured the learner and `/voice/input/turn` returned 200 in
  3639 ms.
- `/voice/coach/runtime` returned 200 in 1208 ms and persisted a fresh coach
  reply.
- Selected-preset target-text TTS began, then the phone aborted
  `/voice/speech/generate` twice (one after 2067 ms, one after 88 ms).
- Repeated `/voice/speech/cancel` calls followed until the learner pressed End.

Therefore Tailscale, ASR, and coach generation all crossed successfully. The
silent boundary was frontend playback ownership.

## Root cause

`prepareInputStart()` awaits asynchronous practice teardown before it stops
tutor speech and opens the microphone. A render can start this listening intent
while the tutor is idle. While it is suspended in that await, a fresh coach
reply can begin selected-voice synthesis. When the old listening intent resumes,
it still calls `stopCoachSpeech()` and aborts the new TTS fetch.

The prior busy-state repair only prevented a *new* render from choosing
listening while VoxCPM was busy. It did not revalidate a listening operation
that was already in flight.

## Repair and kill tests

- `coach-input.ts` revalidates real custom-speech activity after the awaited
  practice release. A stale listener yields without touching TTS; playback
  completion remains the only owner of the next microphone handoff.
- Privacy-safe telemetry records
  `voice-input-handoff/listening-yielded-to-coach-speech`.
- A red/green regression defers practice release, begins tutor speech while the
  listener is suspended, then proves the listener returns false without calling
  `stopCoachSpeech()` or opening the microphone.
- Both WebAudio modes must now prove a first PCM frame within one second.
  Worklet may recover once to ScriptProcessor; a zero-frame ScriptProcessor
  immediately hands off to recorded capture instead of waiting through the
  backend and client timeout stack.
- Telemetry distinguishes `worklet-no-pcm` and
  `script-processor-no-pcm` without retaining audio or transcript content.

## Verification

- Frontend: 95 files passed; 695 tests passed, 2 skipped.
- Production TypeScript/Vite build passed.
- Gateway TurnTelemetry privacy suite: 14/14 passed.
- Deploy check passed.
- Served production shell points to `voice-runtime-DTELIb1j.js`.
- The served asset contains both
  `listening-yielded-to-coach-speech` and `script-processor-no-pcm`.

## Close band

DEBUG-HUNT: CLOSED — failing crossing was a stale listening owner aborting a
new selected-voice playback.

### Physical closure

The connected Pixel exposed one additional handoff race: render-driven and
post-playback microphone reopens could overlap and invalidate one another. The
runtime coordinator now shares one pending continuous-listening operation
without changing intentional input-owner replacement semantics.

The deterministic full-phone gate then passed:
`Ready → Hearing → Thinking → Speaking(actual audio) → Ready`, GPU ASR 542 ms,
two live `session-opened` witnesses, two `capture-ready` witnesses, and
`listeningStarted=true`. The verifier ended the session cleanly.

VERDICT: FIXED_DEPLOYED_AND_PHYSICALLY_PROVEN — see
`studio/code/phone-spoken-loop-acceptance-2026-07-25.md`.
