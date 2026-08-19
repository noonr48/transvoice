# Spoken turn pipeline — scope

Tier L — this change adds an endpoint-decision runtime, completes a WebSocket seam, changes live event contracts, and touches backend, frontend, deployment, and UX artifacts.

## Problem

Before this repair, Coach treated roughly 900 ms below an RMS threshold as proof that the learner had finished. That could interrupt deliberate voice practice, hesitation, or a stutter. It then stopped `MediaRecorder`, encoded the whole clip as base64, posted it through the gateway, and waited for remote ASR while the simplified Coach surface remained ambiguous. The measured phone turn reached GPU Parakeet only about six seconds after capture, even though Parakeet itself completed in 1.14 seconds.

## In Scope

- Complete the existing phone-to-gateway live PCM input path at `/voice/input/live`.
- Add a thin, optional Smart Turn v3.2 adapter that judges semantic/acoustic turn completion after candidate silence.
- Use a conservative adaptive-silence fallback whenever the neural detector is absent, late, or unhealthy.
- Continue using the existing GPU-backed Parakeet ASR service and existing coach/TTS loop.
- Add privacy-safe, stitched timing witnesses from live input open through ASR completion and final-transcript delivery.
- Reuse the existing Coach status region for four small in-place states: Listening, Hearing you, Thinking…, and Speaking. Startup may briefly show Starting…. Recognition and model work intentionally collapse into one learner-facing wait state.
- Preserve exactly two persistent Coach controls, the fixed no-scroll viewport, the single instructional canvas, and exact selected-preset tutor speech.

## Out of Scope

- Text chat, transcripts, message bubbles, a composer, or a per-turn submit control.
- Replacing Parakeet, the coach language model, or VoxCPM.
- Full-duplex speech or learner barge-in while tutor audio is playing.
- Persisting raw learner audio or a new conversation-history entity.
- Retraining Smart Turn on a TransVoice-specific stutter/deliberate-speech dataset in this pass.
- Mutating the remote Parakeet container; it is already GPU-backed and measured fast.

## Success Criteria (measurable)

- A semantically complete real-time turn can enter `processing` within 2.1 seconds of the last voiced frame: the 1.8-second protected floor plus a 150 ms detector budget and scheduling margin. Faster-than-real-time fixture injection is used only to isolate server/model/ASR overhead, never as a user-perceived wall-time claim.
- A Smart Turn `incomplete` decision does not finalize the turn; resumed speech remains part of the same segment.
- Detector failure or an uncertain/incomplete semantic result cannot restore the 900 ms cutoff: the semantic model is not consulted before 1.8 seconds of silence and the conservative fallback waits at least 4.5 seconds before finalizing.
- The existing 8.7-second ASR benchmark remains below 1.5 seconds warm end-to-end to the GPU provider; the live gateway adds no record-then-base64 phone upload.
- The visible Coach status changes within 100 ms of each client-observed lifecycle state, adds zero interactive controls, and does not queue routine screen-reader announcements over tutor audio.
- Phone verification passes at 360x620 and 411x809 with no document overflow or nested scroller.
- Persistent telemetry records each boundary and duration without transcripts, prompts, raw audio, request bodies, or query values.
- When Smart Turn is missing or crashes, readiness/health and one bounded witness identify the fallback; the spoken lesson remains usable.
- The selected preset identity still reaches the existing tutor-TTS request unchanged, and `Start`/`End` remains centred at `66.667dvh` with no extra visible lifecycle words on the button.
- The deployed production gateway preserves a 1.2-second deliberate pause in a real human recording and the physical Pixel opens/closes the same live PCM route with the detector ready.

## Constraints

- Start is pressed once; End ends the entire spoken lesson.
- The learner may pause, deliberate, or stutter without being forced into 900 ms turns.
- Premature endpointing is more harmful than modest added latency, so thresholds bias toward waiting.
- Smart Turn is optional and wrapped behind a project-owned adapter; the live PCM/ASR path must work without it.
- The shared dirty worktree must be preserved; edits stay inside the declared files.
- Raw audio is memory-only for the current turn and is discarded after ASR or cancellation.

## Non-goals

- Perfect human-equivalent turn-taking — defer until live traces establish false-cut and over-wait rates.
- On-device model inference — a server-side worker is smaller and avoids adding an 8.7 MB model plus runtime to the phone bundle.
- Visible progress bars — waits are short/indeterminate and the existing status region is sufficient.
