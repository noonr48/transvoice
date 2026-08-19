# Physical phone runtime handoff — 2026-07-22

## Deployed path

- Device: Pixel 9, Android 16, ADB serial `46271FDAQ000BC`.
- Package: `net.sloane.voicetutor`.
- WebView URL: `https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1`.
- Coach CSS viewport: 411×809; document: 411×809; no horizontal or vertical overflow and no descendant scrollers.
- Network ownership: the phone uses the gateway's same-origin `:3021` routes. Direct Tailscale `:8002` is intentionally retained for the shared desktop/power-user VoiceTrainer profile and is restored by `sloane-remote-access.timer`.

## Repaired runtime seams

1. Bootstrap now synchronizes the persisted backend session before rendering and does not passively arm audio on page load.
2. Android WebView cannot provide a usable browser TTS or speech-recognition service. Target speech falls back to VoxCPM; the Coach orb falls back to the practice-take transport when backend live ASR is unavailable.
3. Speech claims the coach message synchronously before the async VoxCPM request, preventing render-driven duplicate generation. Auxiliary speech no longer corrupts coach-reply dedupe state.
4. Gateway and VoiceTrainer now exchange the target binding in the analyzer's flat start-session contract. The session response, summary, and attempt artifact preserve the exact target profile and analysis version.
5. Replay resolves the analyzer's `attemptArtifactId` for audio while retaining `clientAttemptId` for UI correlation.
6. Visible controls emit privacy-safe activation/effect telemetry; verifier output includes user agent, core-control states, and Coach-thread state.

## Physical receipts

- Startup reached `health-ready → session-ready → workflow-ready → app-ready` without arming audio.
- Hear Line emitted `speech-started`; `/voice/speech/generate` returned 200 exactly once after the dedupe fix.
- Android audio policy showed an active, unsilenced, 48 kHz mono PCM-float `CAMCORDER` capture owned by the app.
- `/voice/session/start` returned 200 and acknowledged the intended target binding.
- `/voice/session/take` returned 200; a silent take was correctly measurement-rejected and excluded from achievements.
- Listen Back emitted `replay-opened`; attempt audio streamed with HTTP 206.
- `node studio/code/verify-phone-contrast.mjs` passed on the physical WebView at 411×809.

## Operator commands

```bash
adb -s 46271FDAQ000BC shell am start -n net.sloane.voicetutor/.MainActivity
node studio/code/verify-phone-contrast.mjs
node studio/code/verify-phone-telemetry.mjs --read-only
node studio/code/cdp-click.mjs voice-hear-line
curl -fsS http://127.0.0.1:3021/voice/debug/health | jq
tail -f ~/.local/share/sloane/transvoice/witness.jsonl
```

CDP must be forwarded to port 9223 from the current app WebView socket after an activity restart.

## Verification state

- Frontend: 638 passed, 2 skipped.
- Gateway/backend: 209 passed.
- VoiceTrainer focused contract/hardening: 6 passed; exact target propagation regression: 1 passed; Python compilation passed.
- VoiceTrainer full suite before the added regression: 72 passed, 1 pre-existing environment-policy mismatch (`includesRawAudio` expected false while this runtime saves raw audio and truthfully reports true).
- Frontend production build and repository `git diff --check`: passed.

## Next recommendations

1. Enable a real backend ASR proxy only if conversational live input is required; do not advertise Android WebView browser recognition as available.
2. Resolve the raw-audio policy test by choosing one deployment policy, then make the test fixture and runtime configuration agree.

## Completed follow-up: single-orb capture lifecycle

The central Coach orb now renders its complete lifecycle in place: `Ready / Tap to record` → `Recording / Finish` → `Finishing / Scoring your take…` → `Ready`. The first tap prepares the microphone and automatically begins the take, reducing the fallback capture path from three taps to two. `Speaking / Tap to stop`, direct live-input, unavailable, and retry behavior remain on the same control. Physical Pixel replay confirmed active unsilenced capture, successful take finalization, telemetry health, and unchanged 411×809 no-scroll geometry.
