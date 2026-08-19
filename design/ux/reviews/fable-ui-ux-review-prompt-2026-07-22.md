# Fable task — independent TransVoice mobile UI/UX review

You are Fable, acting as an independent senior product designer, interaction designer, accessibility reviewer, and usability critic. Review the current deployed TransVoice Voice Tutor experience comprehensively. This is a read-only assessment: do not modify source, configuration, services, app data, or durable user state.

## Product intent

TransVoice is a private, affirming voice-coaching app for transgender, gender-diverse, and voice-exploring people. It helps someone select or supply a target voice, practise a line, hear a target rendering, record a take, receive careful coaching, and listen back.

The intended Coach experience is deliberately minimal: one portrait UI, one obvious primary action, and no document scrolling. It should be only as complex as necessary. Explore may expose more detail, but Coach should feel like a calm coach in a quiet room—not an analytics dashboard.

Treat these as strong constraints, not unquestionable dogma. If a constraint causes a measurable usability problem, identify the conflict and propose the smallest justified exception.

## Current deployed context

- Project: `/home/USER
- Physical device: Pixel 9, Android 16, ADB serial `46271FDAQ000BC`
- Package: `net.sloane.voicetutor`
- WebView: `https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1`
- Current Coach viewport/document: 411×809 CSS px, portrait, no horizontal or vertical overflow and no descendant scrollers.
- The central orb currently renders `Ready / Tap to record` → `Recording / Finish` → `Finishing / Scoring your take…`; coach speech uses `Speaking / Tap to stop`.
- The phone uses same-origin gateway port 3021. Direct Tailscale port 8002 is an intentional desktop/power-user VoiceTrainer route; do not recommend removing it as a phone fix.
- The working tree is intentionally dirty and contains user work. Preserve it.

Start by reading:

- `design/frontend/brief.md`
- `design/frontend/direction.md`
- `design/frontend/structure.md`
- `design/frontend/controls.md`
- `design/ux/states.md`
- `design/frontend/verify/critique.md`
- `studio/code/phone-runtime-2026-07-22.md`
- `studio/code/instrumentation.md`

Useful visual/runtime evidence:

- `design/frontend/verify/screenshots/transvoice-orb-recording.png`
- `node studio/code/verify-phone-contrast.mjs`
- `node studio/code/verify-phone-telemetry.mjs --read-only`
- `adb -s 46271FDAQ000BC shell am start -n net.sloane.voicetutor/.MainActivity`

If the phone or CDP socket is unavailable, continue from checked-in screenshots, source, tests, and review artifacts. Label anything not replayed as unverified. Do not stop services, clear app data, revoke permissions, delete sessions, or force destructive failure states.

## Review question

Does the current experience feel immediately understandable, trustworthy, affirming, low-effort, and usable with one hand by both a first-time and a returning user? Where does it make the user pause, guess, re-read, wait without confidence, fear losing progress, or confront complexity that does not help them practise?

## Required walkthroughs

Review these as complete journeys, not isolated screens:

1. First run: Welcome → target-voice choice → preset path → practice.
2. Alternative target paths: upload and record-from-mic, including permission and analysis expectations.
3. Returning user: resume context, understand what is selected, and begin a useful practice take quickly.
4. Coach loop: understand the current line → Hear it in target voice → Ready → Recording → Finish → scoring → coaching response → Listen back → next useful action.
5. Speaking/interrupt behavior: distinguish the coach speaking from the app listening or recording.
6. Coach ↔ Explore: understand what each mode is for, switch safely, and return without losing context.
7. Recovery: offline/service unavailable, microphone unavailable, silent or unmeasurable take, slow scoring, target speech failure, and replay failure. Inspect existing logic/artifacts when safe live reproduction is unavailable.
8. First-run, habituated, lapsed/returning, and recovery-after-error versions of the main Coach surface.

## Evaluation lenses

For each journey, assess:

- Discoverability: is the next action obvious without explanation?
- Mental model: can the user tell whether the app is listening, recording, speaking, thinking, scoring, or idle?
- Control mapping: does each label predict what a tap will do?
- Feedback and latency: visible acknowledgment within 100 ms; honest feedback for 1–10 s waits; recovery/cancel strategy for waits over 10 s.
- Information hierarchy: one primary action, useful supporting context, no competing emphasis.
- Cognitive load: jargon, choices, repeated explanation, and controls that can be removed or deferred.
- Continuity: selected target, current line, take state, coaching response, and replay relationship remain understandable.
- Error recovery: every failure explains what happened and gives a next action without blaming the user.
- Accessibility: 44 px touch targets, contrast, Dynamic Type/text scaling risk, focus/keyboard path, semantics/ARIA, reduced motion, screen-reader clarity, and color-independent state.
- One-handed/real-world use: thumb reach, accidental taps, interruptions, backgrounding, headphones, noisy rooms, short sessions, and privacy in public.
- Inclusive trust: affirming and non-assumptive language; no implication that one gender has one correct voice; calibration and uncertainty communicated honestly; no false praise from unusable measurements.
- Visual coherence: calm graphite/amber direction, state legibility, spacing, wrapping, density, and whether Coach truly remains a single no-scroll surface.
- Learnability versus efficiency: first-time guidance should fade; returning users should reach practice quickly.

## Evidence discipline

Tag every substantive claim:

- `[V]` directly verified in the physical UI, screenshot, source, test, log, or runtime output. Cite the exact receipt.
- `[I]` reasoned inference from verified evidence.
- `[Q]` open question requiring a real user or product-owner decision.

Do not call personal taste a defect. Do not recommend a change without naming:

1. the observed moment;
2. the user problem or missed opportunity;
3. who it affects and how often;
4. the smallest viable improvement;
5. the expected user outcome;
6. how to verify whether it worked.

Separate findings into:

- defect: behavior/copy/accessibility contradicts the product intent;
- improvement: current behavior works but creates avoidable friction;
- experiment: promising idea whose value needs user evidence;
- keep: a current choice that should be protected.

Use severity independently of effort:

- `P0` blocks or endangers the core practice loop;
- `P1` causes major confusion, distrust, exclusion, or repeated failure;
- `P2` meaningful recurring friction;
- `P3` polish or low-frequency refinement.

Also score confidence (`high/medium/low`) and implementation effort (`S/M/L`) separately.

## Required deliverable

Write the review to:

`design/ux/reviews/fable-ui-ux-review-2026-07-22.md`

Use this structure:

1. Executive verdict — five sentences maximum.
2. What already works — choices to protect, with evidence.
3. Journey walkthrough — first-run, returning, Coach loop, Explore, recovery.
4. Findings ledger — ID, category, severity, confidence, frequency, evidence, observed moment, user impact, smallest improvement, verification.
5. State-completeness audit — empty/loading/error/partial/success/disabled for each primary surface.
6. Control and copy audit — every visible phone control: intent, predicted effect, actual effect, visible confirmation, ambiguity.
7. Accessibility and inclusive-trust audit.
8. Simplification pass — what can be removed, combined, deferred, or made contextual.
9. Idea portfolio:
   - five low-risk quick wins;
   - three bounded usability experiments;
   - three longer-horizon ideas;
   - for each, state why it belongs and what evidence would kill it.
10. Prioritized recommendation slate — top five changes in order, with expected benefit and dependency/risk.
11. Product-owner questions — only decisions that cannot be resolved from evidence.
12. Final rubric:
   - intuitive next action;
   - state clarity;
   - error recovery;
   - first-run learning;
   - returning-user speed;
   - one-handed use;
   - accessibility;
   - inclusive trust;
   - no-scroll Coach integrity;
   - overall coherence;
   Score each 1–5 with a one-sentence anchor. Do not average away a P0/P1.

End with a short section titled `If we change only one thing`.

## Anti-generic constraints

- Do not redesign the product from scratch.
- Do not propose more visible controls unless you first identify why contextual disclosure cannot solve the problem.
- Do not equate “modern” with gradients, cards, animation, or more data.
- Do not recommend gamification without addressing dysphoria, comparison pressure, and measurement uncertainty.
- Do not assume a feminine, masculine, or neutral target is inherently correct for any user.
- Do not infer usability from code alone when physical evidence is available.
- Do not implement fixes during this task.

## Memory handoff

After the report is complete and evidence-checked:

1. Append structured project events for each `P0/P1`, major decision, and review milestone under project `transvoice`.
2. Use the shared SLOANE general-memory guard and commit a distilled review handoff titled `TransVoice Fable UI/UX review — 2026-07-22`, with report path, verified receipts, top-five slate, rejected ideas, assumptions, and revisit conditions.
3. Do not store speculative `[I]` claims as facts; preserve their labels.
