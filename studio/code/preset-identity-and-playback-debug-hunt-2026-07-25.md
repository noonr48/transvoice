# Instrument: TransVoice preset identity + full playback hunt

Mode: HUNT · Medium: service · Date: 2026-07-25 · Status: FIXED_DEPLOYED_AND_PHYSICALLY_PROVEN

## H-G0 REQUEST DECODE

| cell | value |
|---|---|
| SYMPTOM | A live phone Coach turn spoke in the wrong voice and stopped before the complete tutor reply was heard. |
| CLASS | Two `partial-function` failures: selected voice identity was lost before synthesis; complete synthesis did not cross the phone speaker at its source duration. |
| CHAIN | stored phone session → Coach session resume → selected preset/reference binding → VoxCPM cloned synthesis → gateway PCM stream → WebView PCM conversion → AudioWorklet drain → listening re-arm |
| OWNER-NAMED | Preserve the phone's explicitly selected uploaded preset and prove the complete generated reply drains audibly before the microphone is re-armed. |

## Failing incident receipts

The 15:48 ACST phone turn proves:

- the session exported `targetSource=built-in`, no selected custom preset, and no
  reference clip even though the learner's prior continuing Coach session had
  the named `Aster` reference preset;
- the gateway consequently recorded `profile-synthesis` and
  `reference_audio_role=none`, so the voice could not have been the selected
  clone;
- VoxCPM generated two segments and completed 823,636 bytes of 48 kHz mono
  PCM16;
- those bytes represent 8.58 seconds of audio;
- a silent replay of the exact PCM through the configured ASR recovered the
  complete target sentence, including its final words;
- the first subsequent frontend cancellation arrived only 5.25 seconds after
  first-response evidence, before an un-resampled 8.58-second stream could
  finish.

No transcript or learner audio is retained by this hunt.

## Seam map

| seam | proof required | current witness |
|---|---|---|
| phone session → resume | explicit existing session wins over unrelated checkpoint | source currently chooses checkpoint first |
| resumed session → TTS request | selected preset and reference clip remain bound | failed live export: both absent |
| TTS service → gateway | cloned target-text response is complete | full byte count + complete ASR |
| gateway → PCM player | all source samples are queued | add completion witness |
| PCM player → Android device | source duration is preserved across unequal sample rates | source currently has no output resampling |
| audible drain → capture re-arm | re-arm occurs only after final rendered sample | existing ended gate; add source/output sample receipt |

## Root causes

1. `startSession` prioritizes the global learner checkpoint over an explicitly
   requested, existing phone session. A newer generic checkpoint can therefore
   replace the phone's selected-preset session and overwrite its local session
   pointer.
2. `PcmStreamPlayer` feeds 48 kHz source samples directly to the AudioWorklet.
   The worklet renders at the Android `AudioContext.sampleRate`; when that rate
   differs, playback duration and pacing differ by the same ratio. The declared
   `ringBufferResample` option was not implemented.

## Repair gates

- Red/green continuity test: an explicit existing phone session must beat a
  different checkpoint while checkpoint-only startup still resumes normally.
- Red/green playback test: 48 kHz source entering a 96 kHz audio context must
  queue approximately twice as many render samples and preserve source
  duration.
- Completion telemetry must report source rate, playback rate, queued samples,
  played samples, and computed duration without text, audio, preset ID, or
  reference ID.
- Selected-reference synthesis must remain fail-closed; generic/browser speech
  must never substitute for a selected preset.

## Verification

- The two new tests were first run red against production behavior:
  checkpoint selection returned `continuing-session` instead of the explicit
  phone session; 48 kHz input queued only 480 samples into a simulated 96 kHz
  device instead of approximately 960.
- Both tests pass after the repairs.
- Frontend: 95 files passed; 696 tests passed, 2 skipped.
- Gateway/continuity/privacy integration: 109 tests passed.
- TypeScript and Vite production build passed.
- Deploy check passed.
- Gateway restarted healthy and the phone's Tailscale route
  `:3021/app?sameOrigin=1` serves `voice-runtime-GCdZz2rA.js`.
- The served asset contains output-rate resampling and
  `pcm-playback-complete` telemetry.
- The already-hijacked live session was rebound to the latest prior valid
  selection, `Aster`; its stored target is now `custom-reference`, cloneable,
  and bound to the Aster reference clip.
- A silent production-gateway synthesis returned HTTP 200 with
  `X-Voice-Cloned: true`, `cloned-synthesis`, `conditioning-only`, applied rate
  `0.76`, and 3.77 seconds of newly generated PCM. No reference audio was
  played.

## Close band

DEBUG-HUNT: CLOSED — the selected-session takeover and rate-mismatched playback
paths are repaired, gated, and deployed.

### Physical closure

The final Pixel loop crossed selected-voice target-text generation into actual
WebView audio, drained the response, then opened a second live-input session
with fresh `capture-ready` and first-PCM witnesses. Playback accounting is now
non-zero and honest after fixing detached-buffer length capture; a zero-sample
response fails closed and cannot acknowledge speech as played.

`studio/code/phone-spoken-loop-acceptance-2026-07-25.md` contains the complete
receipt, including the separate silent cloned-synthesis/non-reference-replay
proof. Perceptual Aster similarity remains human judgment, not an unresolved
routing or playback seam.

VERDICT: FIXED_DEPLOYED_AND_PHYSICALLY_PROVEN.
