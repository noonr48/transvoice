# Final closure review ledger

## Defect cards

1. `[V] frontend/voice-tutor-app.html` — mobile fallback used `var(--tv-muted)` at 14px, producing 3.79:1 interactive text. Corrected to `var(--tv-text2)`; visible phone measurement is 7.88:1.
2. `[V] frontend/voice-tutor-app.html` — the claimed review-caption fix targeted hidden `#voice-review-focus`; live DOM showed the visible text is `.voice-coach-empty` at `rgb(111,114,110)`. Corrected the rendered selector; visible phone measurement is 7.88:1.
3. `[V] frontend/voice-tutor-app.html` — real tap from the thumb-zone welcome CTA could leave Android's compositor showing the next card's low frame while DOM scroll metrics already read zero. A card-visibility observer plus two-frame 1px scroll pulse makes the exact replay render at the top.
4. `[V] phone-apps/voicetutor/AndroidManifest.xml` — activity accepted orientation changes but had no portrait request. Added `android:screenOrientation="portrait"`; packaged and runtime orientation both verify portrait.
5. `[R/V] scripts/sync-from-sloane-ui.cjs` — the sync map could overwrite the entire mobile shell. Removed that map entry, documented standalone ownership, and confirmed sync-check no longer lists it.

## Usage / blast-radius sweep

| surface | affected? | proof |
|---|---|---|
| Vite app shell entry | yes | rebuild regenerates `dist/voice-tutor-app.html` |
| Android WebView | yes | dynamically loads tailnet `/app`; live CDP source contains reset |
| Explore desktop mode | no behavioral change | contrast/reset rules remain coach/mobile scoped |
| shared SLOANE UI shell | unaffected | direct mobile shell removed from one-way sync map |
| Vault Android app | unaffected | only Voice Tutor manifest changed |

## Coverage table

| surface | happy | edge/state | negative |
|---|---|---|---|
| portrait onboarding | physical welcome→chooser tap starts at top | prior low-frame case replayed after fix | horizontal overflow false |
| preset flow | three presets load; Aster reaches practice | long Morning Brew label wraps | picker remains usable with Back |
| contrast | live visible nodes = 7.88:1 | hidden nodes not counted as proof | prior muted values documented |
| Android shell | signed APK builds/installs | activity restart stays portrait | cleartext remains disabled |
| regressions | backend 421 + frontend 592 | 2 existing skips disclosed | tsc/build exit 0 |

## Smoke set

| path | command/entry | pass signal |
|---|---|---|
| BOOT | launch installed `net.sloane.voicetutor/.MainActivity` | live tailnet URL + portrait viewport |
| ONBOARD | real ADB tap `Let's begin` | chooser heading + pill visible at top |
| PRESET | real ADB taps preset escape + Aster | practice focus/sentence/orb visible |
| ACCESSIBILITY | `node studio/code/verify-phone-contrast.mjs` | fail-fast PASS: portrait, no x-overflow, 7.88:1 visible nodes |
| REGRESSION | frontend/backend suites | 592 and 421 pass |

## Verdict

VERIFIED [V]: build, tests, portrait lock, vertical flow, visible contrast, tailnet WebView, scroll-transition repair.

READ-ONLY [R]: sync ownership sweep and selector/cascade review.

INDEPENDENT REVIEW: PASS. The two low-severity notes (mixed shell/runtime typography and an observational-only phone probe) were fixed, rebuilt, and replayed on the Pixel after the review.

UNTESTED: physical rotation gesture was not forced after runtime portrait declaration; packaged manifest plus Android requested/override orientation are the stronger deterministic proof.

# Failure telemetry retrofit — wrap checkpoint

## Outcome

The browser, HTTP, WebSocket/audio, persistence, health, and fatal-process boundaries now emit privacy-safe categorical witnesses with page/request correlation. Warning/error rows persist in owner-only rotating JSONL; telemetry health detects write failure and stale heartbeat; malformed, oversized, and flooded client reports fail closed without storing user content.

## Receipts

| gate | result |
|---|---|
| backend regression | 155/155 pass |
| frontend regression | 597 pass, 2 existing skips |
| TypeScript | pass |
| production build | pass, 110 modules |
| targeted telemetry/fatal tests | 24/24 pass |
| managed service | active/running, `NRestarts=0`, telemetry `status=ok` |
| prior Pixel kill crossing | thrown WebView error reached persistent JSONL with matching trace ID |

## Remaining

Rerun `node studio/code/verify-phone-contrast.mjs` and `node studio/code/verify-phone-telemetry.mjs --read-only` tomorrow. The post-restart parallel attempt hung and both verifier processes were explicitly terminated; this does not affect the running app or server health.
