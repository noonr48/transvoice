# Feminization Foundations v1 — Decision Log

**Status:** authoritative until superseded by a later dated decision.

## 2026-08-17 — Narrow the initial product to beginner feminisation

**Decision:** The first active TransVoice product is adult beginner MTF/transfeminine English speaking-voice feminisation.

**Consequences:** Do not spend the v1 critical path on masculinisation, nonbinary/bidirectional training, singing, post-operative rehabilitation, or general-purpose voice transformation. Preserve extensible data models, but validate one direction first.

## 2026-08-17 — Curriculum controls the metric engine

**Decision:** The beginner curriculum decides which skill is being trained before any metric ranking occurs.

**Reason:** A globally ranked target-distance vector can select a technically measurable but pedagogically inappropriate dimension. The target-metric engine remains useful only after phase/skill/context filtering.

**Required flow:** `safety → capture → mastery/curriculum → eligible metrics → reachable target → reviewed cue → exact-next trial → verification → retention/mastery`.

## 2026-08-17 — First two product proofs are pitch and controlled resonance

**Pitch proof:** safe calibration → comfortable reachable pitch target → reviewed cue served → exact next take → protected verification → faded feedback → no-feedback retention → mastery update.

**Resonance proof:** validated controlled `/i/` evidence → reviewed cue served → exact next `/i/` take → formant movement with pitch/effort protected → word transfer → no-feedback retention → mastery update.

No additional acoustic domain is allowed to displace these proofs on the v1 critical path.

## 2026-08-17 — No universal pitch target

**Decision:** Do not assign every beginner a fixed female pitch such as 180/200/220 Hz.

Immediate practice targets must come from the learner's valid baseline, demonstrated comfortable movement, detector uncertainty, current task complexity, and a named/versioned reachable-target policy. Population ranges may be research context but are not pass/fail rules.

## 2026-08-17 — Controlled formants only

**Decision:** Arbitrary reference speech and clip-wide F2/frontness cannot drive learner-facing resonance coaching.

A coachable resonance observation requires explicit same phonetic/task context plus authoritative controlled-vowel evidence: stable segment, vowel/prompt identity, F0, F1-F3, confidence/continuity, high-F0 risk, analyzer version, recording context, and explicit invalidity reasons.

Same probe/context is necessary but not sufficient; detector validity must also pass.

## 2026-08-17 — Reference voices are optional long-range goals

**Decision:** Target/reference upload is not required for onboarding.

References may provide inspiration and, later, validated same-prompt distributions. They do not automatically define immediate learner pitch/formant targets. Synthetic/TTS clones are not acoustic ground truth in v1.

## 2026-08-17 — Separate mastery, motor response, goal, and training target

**Decision:**

- **Mastery** answers what the learner can reliably do.
- **Learner-general motor response** answers which reviewed cues tend to produce useful changes for this learner.
- **Goal profile/overlay** represents long-range desired style and target-specific cue relevance.
- **Reachable training target** represents the current temporary next step.

Changing a reference voice must not erase acquired beginner mastery or general motor-response evidence.

## 2026-08-17 — Exact-next causality

**Decision:** A cue can receive causal credit only when it was actually served and the exact next eligible attempt was captured under the same task/target/context.

The system may not skip later attempts until it finds a flattering result. Missing protected evidence or effort cannot become `worked_verified`.

## 2026-08-17 — Shadow never learns

**Decision:** Shadow-only target-metric decisions never update mastery, motor response, cue priors, or curriculum progress because the learner was not actually given the shadow cue.

## 2026-08-17 — Feedback must fade

**Decision:** Constant live biofeedback is not the end state. Guided attempts must progress to post-take feedback, hidden-guide attempts, different prompts, later-in-session retention, and cross-session retrieval.

The product must train a reproducible voice, not graph-steering behaviour.

## 2026-08-17 — Beginner UX hides internal metrics by default

Default learner views must not expose schema names, `worked_verified`, raw F1/F2/F3, confidence decimals, target-distance vectors, cue utility, gender probability, passing percentage, or gender-coloured normative bands.

The default result language distinguishes: could-not-measure, no reliable change, partial/confounded movement, verified change, and safety stop.

## 2026-08-17 — Safety authority

Explicit pain/acute symptoms outrank self-reported effort/fatigue, which outrank canonical safety policy; acoustic strain proxies are advisory only and never diagnosis.

No cue may instruct throat squeezing, forcing a laryngeal position, whispering as a feminisation shortcut, maximal range, or persistence through pain.

## 2026-08-17 — Validation before active rollout

Unit/contract tests are necessary but not sufficient. Public/limited active resonance requires a human-corrected acoustic golden corpus, low false-valid rate, high-F0 failure rejection, device/context evaluation, expert cue review, beginner usability testing, privacy review, and rollback capability.

## 2026-08-17 — PR #1 is an integration/reference branch

The large draft PR is not to be merged wholesale as active production coaching. It may receive documentation/stabilisation/extraction support, but new feature development should move to scoped branches/PRs after P0 audit/freeze.

Recommended extraction order:

1. metric/verification foundation;
2. shadow/evaluation;
3. feminization-v1 controller/curriculum;
4. pitch vertical slice;
5. controlled resonance/analyzer contract;
6. learning persistence/motor split;
7. beginner UI.

## 2026-08-17 — No self-mutating CI for source development

GitHub Actions must validate code, not rewrite source and push implementation commits. Local agents should make normal changes, inspect diffs, run tests, and push ordinary scoped commits.
