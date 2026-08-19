# Physical Pixel live-turn receipt — 2026-07-22

> **Historical device receipt.** It certifies the named 2026-07-22 bundle, not
> the current 2026-07-25 candidate. Its stacked 120/240 geometry is superseded
> by the one-representation 120/160 contract in
> `docs/VOICE_COACH_MEMORY_CONTRACT.md`. A fresh physical-device pass remains
> required for the current bundle.

Verdict: PASS for deployed phone wiring, lifecycle communication, control law, geometry, detector readiness, cancellation, and telemetry.

## Target

- Device: Pixel 9 (`46271FDAQ000BC`), package `net.sloane.voicetutor`.
- WebView: `https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1` over Tailscale.
- CSS viewport: 411×809.
- Served runtime: `assets/voice-runtime-BkgaAvVT.js`.

## Controlled Start/End drive

The verifier refused to act unless the phone was stopped and an existing preset was already selected. With Aster selected, the observed lifecycle was:

1. `Start`, no routine status text.
2. `End` + `Starting…` while microphone/live transport opened.
3. `End` + `Listening` after the live transport became active.
4. `Start`, no routine status text after End.

Server status showed one live connection during Listening and zero after End. Smart Turn was enabled, available, and `ready`; no pending prediction or detector error remained. An earlier same-build-family physical capture recorded the first PCM frame 110 ms after live open.

## Product-law and geometry gate

- Exactly two visible/persistent buttons: preset + Start/End.
- No text input, composer, bubble, transcript history, or message affordance.
- Aster remains the selected tutor voice; the verifier never changed it.
- The one instruction canvas contains the practice line and sound spelling without an internal scroller.
- Document 411×809, scroll X/Y zero, no horizontal or vertical overflow.
- Start/End touch target 320×58; center Y 540 against target 539 (two-thirds of the viewport, one-pixel rounded difference).
- Routine status uses `role=presentation` and `aria-live=off`; it does not queue announcements over the audible lesson.
- The legacy runtime host is one inert, hidden pixel with no pointer events; it does not create a second UI.

## Shortest supported viewport

The deployed 360×620 headless probe injected the maximum supported 120-character practice line and 240-character sound spelling. Both remain inside the canvas, the canvas and document do not scroll, Start is centered at 413.33 px (two-thirds of the viewport), and exactly the same two controls are visible. Receipt: `design/frontend/verify/max-content-w360-h620.json`.

## Telemetry

`verify-phone-telemetry.mjs --read-only` returned PASS with an installed page trace, no browser diagnostics, telemetry `status=ok`, non-stale sink, zero sink failures, and no injected kill event.

## Visual receipts

- `design/frontend/verify/screenshots/physical-pixel9-live-turn-411x809.png`
- `design/frontend/verify/screenshots/physical-pixel9-starting-411x809.png`
- `design/frontend/verify/screenshots/physical-pixel9-listening-411x809.png`
- `design/frontend/verify/screenshots/max-content-w360-h620.png`

## Honest boundary

This receipt proves capture/socket ownership, state communication, End cancellation, and layout for the bundle that was deployed when it was recorded. It is not evidence for the later lease/generation and actual-audio-status hardening bundle. The deliberate-pause policy was falsified and then passed against a real human recording through the production gateway; a diverse human careful/stutter corpus spoken through the Pixel microphone and a complete current-bundle mic → endpoint → ASR → coach → selected-voice TTS → actual `Speaking` turn remain explicit quality-validation tasks.
