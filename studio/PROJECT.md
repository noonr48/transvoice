# PROJECT ledger — transvoice-app
Created: 2026-07-19 · updated 2026-07-28 for public-mobile voice-rights and
open-source phone-TTS recommendation research

## Profile
Goal (owner's words): make Coach a flowing spoken lesson that reliably hears a careful learner, responds after they are genuinely finished, and visibly confirms progress without becoming a messaging interface.
Constraints: preserve the shared dirty worktree; phone reaches DEVBOX over Tailscale; Coach is voice-first and never chat; exactly preset + `Start`/`End` controls; no scroll; selected preset is the tutor voice; user alone starts/ends; portrait-first Android app.

## Assumed
- Smart Turn completion probability is advisory, not a sole cutoff authority. It is not consulted before 1.8 seconds of silence; detector loss, low confidence, or an incomplete result falls back to at least 4.5 seconds.
- The existing Parakeet ASR remains on the RTX 5060 Ti: direct measurements show roughly 0.25 seconds warm inference and locate the observed delay before ASR begins.

## Decisions
- The phone streams 16 kHz PCM to an authenticated gateway route. The gateway owns turn segmentation, semantic endpoint checks, PCM-to-WAV conversion, and one internal Buffer handoff to the existing ASR/session mutation owner.
- Coach exposes one quiet activity instrument line: `Getting ready…` before the input is armed, `Ready — speak now` only for the real armed `waiting` state, `Hearing you` after positive speech evidence, `Thinking…` during recognition/model work, and `Speaking` only while tutor audio plays. Error/unsupported input says `Microphone unavailable.` and can never masquerade as ready. Routine changes are not live-announced; actionable errors are announced politely.
- The recorded rollback path uses the same conservative 4.5-second silence hold. No path may restore the 900 ms finalization behavior or lower the live semantic candidate floor below 1.5 seconds.
- `frontend/voice-tutor-app.html` is the standalone/mobile shell authority; upstream sync no longer overwrites it (`scripts/sync-from-sloane-ui.cjs`). This constrains future code work to edit the TransVoice shell directly.
- Android Voice Tutor is portrait-locked (`phone-apps/voicetutor/AndroidManifest.xml`). This constrains future UX to a vertical reading order.
- Front-door card swaps issue a two-frame 1px scroll pulse because Android WebView could hold a stale compositor frame even while DOM scroll metrics read zero. This constrains future onboarding transitions to preserve the reset observer.
- Failure telemetry persists only categorical warning/error witnesses; transcripts, prompts, audio, learner content, credentials, request bodies, and query values are forbidden. Client ingest is schema-bound, size-limited, deduplicated, and rate-limited.
- A selected reference is the sole tutor voice identity and is conditioning-only. Built-in design descriptions are excluded, successful audio must prove new cloned target-text synthesis at the exact applied rate, and ambiguous output is silent rather than substituted.
- Normal tutor delivery is fixed at rate 0.76 (currently about 132 WPM on the physical-route proof); spoken repeat-slower uses 0.65. No pace/replay control is added.
- PCM playback is backpressured by worklet consumption. Overflow is a failure witness, never permission to overwrite unheard speech.
- A valid first leased PCM frame may confirm live transport and emit
  `capture-ready` while the durable session is still starting. The gateway
  still refuses to retain/process those bytes until activation; this avoids a
  client/server readiness circular wait without weakening the session lease.
- Visible Coach activity observes the shared runtime render boundary. Internal
  controllers may not bypass the observer and leave `Ready` visible during
  hearing, processing, or playback.
- Concurrent render/post-playback microphone reopens are single-flighted by the
  runtime coordinator. The lower input controller keeps its intentional
  replacement and stale-owner invalidation semantics.

## Shelf map
| family | artifact | path |
|---|---|---|
| frontend | brief/direction/structure/controls | `design/frontend/` |
| frontend | deployed critique and lint | `design/frontend/verify/` |
| code | phone CDP verifier | `studio/code/verify-phone-contrast.mjs` |
| code | final review ledger | `studio/code/review.md` |
| code | failure seam/witness sheet | `studio/code/instrumentation.md` |
| code | phone telemetry verifier | `studio/code/verify-phone-telemetry.mjs` |
| architecture | live spoken-turn scope/map/contracts/plan/risks | `design/architecture/` |
| reasoning | endpoint decision and evidence ledger | `.deepthink/voice-turn-taking-2026-07-22.md` |
| code | live-input joinery contract | `studio/code/joinery-live-input.md` |
| code | deployed live-input verifier | `studio/code/verify-live-input-production.mjs` |
| code | physical phone live-turn verifier | `studio/code/verify-phone-live-turn.mjs` |
| architecture | implementation and phone receipts | `design/architecture/verify/` |
| architecture | selected-preset TTS receipt | `design/architecture/verify/selected-preset-tts-2026-07-22.md` |
| research | public-mobile voice-rights recommendation (awaiting owner approval) | `studio/research/mobile-public-voice-rights-options-2026-07-28.md` |
| reasoning | public-mobile voice-rights decision ledger (research closed; owner ruling pending) | `.deepthink/mobile-public-voice-rights-2026-07-28.md` |
| review | public-mobile voice-rights gated review | `.deepreview/mobile-public-voice-rights-2026-07-28.md` |
| research | open-source phone TTS and Qwen cloning decision (engineering research; no owner approval) | `studio/research/open-source-phone-tts-options-2026-07-28.md` |
| reasoning | open-source phone TTS decision ledger | `.deepthink/open-source-phone-tts-2026-07-28.md` |
| review | open-source phone TTS gated review | `.deepreview/open-source-phone-tts-2026-07-28.md` |
| code | silent physical-phone TTS/ASR verifier | `studio/code/verify-phone-tts-synthesis.mjs` |
| code | deterministic physical spoken-loop verifier | `studio/code/verify-phone-spoken-loop.mjs` |
| code | physical preset disclosure verifier | `studio/code/verify-phone-preset-disclosure.mjs` |
| code | final physical spoken-loop receipt | `studio/code/phone-spoken-loop-acceptance-2026-07-25.md` |

## Gate ledger
| family | gate | pass | evidence |
|---|---|---|---|
| frontend | portrait render | PASS | final Manrope Pixel screenshots + 411×809 CDP viewport |
| frontend | contrast | PASS | visible mic link 7.88:1; visible review queue 7.88:1 |
| frontend | lint | PASS | 0 error-severity; warnings documented |
| frontend | truthful capture-readiness refinement | PASS PHYSICAL | Pixel visibly crossed Ready → Hearing → Thinking → Speaking(actual audio) → Ready while finite-state diagnostics matched the underlying runtime; current full frontend 710 + 2 skipped; served `voice-runtime-BhKQpBD2.js` |
| code | current regressions | PASS | backend 591/591; frontend 684 passed + 2 intentional skips across 95 files; VoxCPM 91/91; tsc/build exit 0; diff check clean |
| code | prior independent UI review | PASS | fresh reviewer found no correctness blocker; both low-severity durability notes were then fixed |
| code | telemetry automated gates | PASS | included in current full suites; live worker/stale/ASR privacy witnesses and read-only phone telemetry pass |
| code | managed telemetry service | PASS | active/running, zero restarts, sink and upstream health ok |
| code | 2026-07-22 phone replay | HISTORICAL PASS, SUPERSEDED | `voice-runtime-BkgaAvVT.js`; its Start/End transport result is retained only as provenance. The 2026-07-25 full-loop row below certifies the current bundle. |
| architecture | spoken-turn implementation plan | PASS | independent review 18/18; exact rollback destinations mapped |
| code | live PCM + adaptive endpoint implementation | PASS | retained inside backend 591/591 and frontend 684 + 2 skipped; TypeScript/build; diff check |
| runtime | deployed semantic completion | PASS | faster-than-real-time fixture isolates server path: semantic complete, 104 ms open→ASR, 869 ms provider, 973 ms open→final; real-time use also includes the protected 1.8 s pause |
| runtime | deliberate-pause protection | PASS WITH RESIDUAL | real human fixture: 1.2 s pause preserved; 4.5 s conservative boundary; physical-phone human/stutter corpus remains |
| runtime | connected-phone transport proof | PASS | Pixel 9 411×809: Start→Starting…→Listening→End; live socket 1→0; detector ready; no scroll/diagnostics. This does not claim a complete human audible turn. |
| runtime | cold Coach restoration | PASS | removed a redundant second session hydration that could block on coach-line generation for 24.46 s; physical Pixel reload now restores Aster and enables Start in 2.002 s without interaction |
| frontend | shortest supported max-content proof | PASS | 360×620, one 120-character phrase or 160-character pronunciation, exactly two controls, no clip/scroll, native 150% text enlargement, Start at 2/3 viewport |
| runtime | selected-preset target-text synthesis | PASS AUTOMATED | silent Pixel WebView route: cloned/conditioning-only evidence, 0.76, 48 kHz PCM16, 5.454646 s / ~132 WPM, distinct reference hash/duration, exact GPU-ASR sentence; perceptual Aster identity remains human acceptance |
| runtime | complete PCM tail | PASS PHYSICAL | constrained-ring automation remains green; Pixel produced actual audio through the final drain, then and only then reopened capture. Detached-buffer accounting now reports real queued samples and zero-sample playback fails closed. |
| runtime | post-fix audible tutor turn + teaching delivery | HUMAN RESIDUAL | learner must Start, speak once, and confirm all four: the sentence completes, overall pace/clause pauses are comfortable, the technique word is clearly emphasized, and the tutor sounds like the selected preset; automated proof intentionally stayed silent |
| memory/privacy | 2026-07-25 repaired candidate | GATED PASS ACTIVE; PHONE CLOSED | isolated live-model gate 6/6 with zero error/fallback turns; Delete All corrupt/no-backup/eval coverage and three independent reviews remain green; final gateway reports both stores healthy/unblocked and all services online; phone diagnostics expose finite state only; current backend 672/672, frontend 710 + 2 skipped |
| runtime | 2026-07-25 complete physical spoken loop | PASS | Pixel 9: Ready 1.554 s → Hearing → Thinking → actual selected-voice audio → second Ready 20.706 s; GPU ASR 542 ms; two session-opened + two capture-ready + post-playback `listeningStarted=true`; verifier End cleanup |
| frontend | physical preset + large-font accessibility | PASS | 411×809, exactly preset + Start, no message affordance/scroll, Start center 540; preset naming/upload/focus disclosure passed; Android 130% and 200% font passes retained the no-scroll surface; restored to 100% |
| code | final 2026-07-25 regressions | PASS | backend 672/672; frontend 96 files, 710 passed + 2 intentional skips; focused spoken-loop seams 122/122; TypeScript/Vite 112 modules; diff check clean; served `voice-runtime-BhKQpBD2.js` |
