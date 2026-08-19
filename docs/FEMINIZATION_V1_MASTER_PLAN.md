# TransVoice Feminization Foundations v1
## Master Development Plan, Architecture Contract, Validation Strategy, and Agent Handoff

**Status:** Authoritative development plan for the next phase  
**Plan version:** 1.0  
**Date:** 17 August 2026  
**Repository:** `USER/transvoice-handover`  
**Integration context:** draft PR #1, `sol/target-metric-coaching-foundation`  
**Initial product domain:** adult beginner male-to-female/transfeminine English speaking-voice feminisation  
**Production activation:** prohibited until the release gates in this document are satisfied

---

# 0. Authority and purpose

This document replaces the earlier, broader idea of allowing a generic target-distance engine to choose the next learner intervention from every measurable acoustic dimension.

The current branch contains valuable foundations. The next phase must reorganise them around one narrow product:

> **TransVoice Feminization Foundations v1 helps an adult beginner learn a comfortable, sustainable, conventionally female-sounding speaking voice by teaching one controllable skill at a time, verifying what changed, protecting effort and already-established skills, fading feedback, and testing retention.**

When existing code or older design documents conflict with this plan:

1. preserve safety, privacy, canonical evidence, and causal-verification laws;
2. preserve compatibility where doing so does not violate the v1 product contract;
3. place conflicting generic behaviour behind research/shadow mode;
4. do not activate an unvalidated path merely to preserve old behaviour;
5. document the conflict and resolve it in a scoped PR.

The immediate product proof is not a comprehensive voice score. It is two complete learning loops:

1. comfortable pitch acquisition and retention;
2. controlled `/i/`-family resonance acquisition and retention.

Everything else is subordinate until those loops work end to end.

---

# 1. Product scope

## 1.1 Included

The first active product supports:

- adults;
- beginner MTF/transfeminine learners;
- speaking voice;
- English;
- one versioned initial accent/language pack;
- microphone-guided practice;
- pitch acquisition;
- controlled-vowel resonance acquisition;
- effort, discomfort, fatigue, strain, pain, and capture checks;
- repeatability;
- no-feedback retention;
- short-phrase transfer;
- optional long-range human reference voices;
- deterministic cue trials and verification;
- privacy-bounded evaluation.

## 1.2 Explicitly deferred

The v1 critical path does not include:

- masculinisation;
- nonbinary or bidirectional curricula;
- paediatric use;
- singing;
- performance/theatre voice;
- post-operative rehabilitation;
- treatment or diagnosis of a voice disorder;
- exact speaker imitation;
- mandatory target-voice upload;
- TTS/synthetic target authority;
- unrestricted spontaneous-conversation correction;
- spontaneous-speech formant coaching;
- listener-gender classification as a success metric;
- global speaker-embedding similarity as a coach;
- numerical vocal-weight or breathiness meters;
- absolute dB targets on uncalibrated microphones;
- jitter/shimmer coaching;
- additional languages/accents before the first pack is validated.

## 1.3 First release boundary

The first validated release ends at:

```text
safe setup and calibration
→ auditory awareness
→ comfortable pitch elicitation
→ pitch repeatability
→ pitch stability and retention
→ controlled-vowel resonance elicitation
→ resonance repeatability
→ pitch/resonance integration
→ short-phrase transfer
```

Intonation, longer connected speech, spontaneous conversation, and real-world transfer are later milestones.

---

# 2. Non-negotiable product laws

1. **Curriculum before ranking.** The current mastery/curriculum phase decides the skill domain before metrics are ranked.
2. **One learner-facing focus at a time.**
3. **No gender/pass/femininity score.** There is no aggregate percentage that declares the learner male, female, passing, or non-passing.
4. **No anatomy from acoustics.** The app may describe measured acoustic movement, not claim that the tongue, larynx, vocal folds, or other anatomy occupied a precise state.
5. **Pain stops active training.**
6. **Unknown is not zero.** Missing effort/protected/context evidence cannot become success.
7. **Exact-next causality.** A cue receives credit only after it was actually served and the exact next eligible attempt is measured under the same task/target/context.
8. **Shadow never learns.** Shadow decisions do not update mastery, motor response, cue utility, or curriculum progress.
9. **No active unreviewed cue.**
10. **No universal production target.** No anonymous 180/200/220 Hz target and no hidden generic step size.
11. **Reference upload is optional.**
12. **TTS is not acoustic authority in v1.**
13. **Retention is required.** Stable mastery includes performance without continuous feedback.
14. **Capture failure is not learner failure.**
15. **The LLM explains; deterministic code decides.**

---

# 3. Current foundation: preserve, restrict, defer

## 3.1 Preserve

The existing target-metric work established useful infrastructure:

- canonical target identity, freshness, take kind, analyzer version, and measurement usability;
- confidence-gated metric observations;
- target regions and semitone-relative pitch distance;
- full before/after comparison identity;
- protected metrics;
- exact-next motor trials;
- causal outcomes including `worked_verified`, `movement_observed_partial`, `confounded`, `moved_wrong_way`, `cost_too_high`, and insufficient-evidence states;
- fail-closed stale/noisy/clipped/incomparable evidence;
- shadow execution separated from learner-facing signals;
- privacy-bounded shadow witnesses;
- reachable-target infrastructure with no default step;
- controlled-probe context keys;
- learner-level beginner mastery;
- beginner-safe feedback abstractions;
- pain/throat-pain/discomfort/effort/strain/fatigue self-report;
- motor response learning that rewards only verified causal success.

## 3.2 Restrict or refactor

The following may remain for research but must not direct the beginner curriculum in their present generic form:

- unrestricted global ranking across pitch, resonance, weight, quality, stability, and prosody;
- legacy resonance proxy;
- legacy weight proxy;
- arbitrary uploaded-reference F2/frontness;
- breathiness as an independent feminisation target;
- acoustic strain risk as a diagnosis;
- spontaneous-speech formants;
- target-scoped storage of all motor knowledge;
- target-distance optimisation without a curriculum stage;
- technical metric language in default UI;
- constant live feedback on every attempt;
- cue activation merely because schema/confidence gates pass.

## 3.3 Research-only observations for initial active v1

These may be retained in offline/shadow data but cannot independently select a learner-facing early lesson:

- `legacy.resonance_mean` / `resonance.legacy_proxy`;
- legacy weight/source-weight proxies;
- clip-wide F2/frontness from unmatched text;
- breathiness risk;
- CPP/CPPS-like measures;
- harmonic-strength/HNR-like measures;
- spectral tilt;
- global speaker embeddings;
- spontaneous-speech formants;
- phrase-ending/prosody observations before the later curriculum phase.

Promotion requires a metric-definition version, validation data, uncertainty/error envelope, policy change, and reviewed cue path.

---

# 4. Authoritative architecture

## 4.1 Top-level flow

```text
Microphone
  ↓
Capture preflight
  ↓
Raw acoustic path ───────────┐
                            ├─ canonical evidence contract
Prompt/alignment path ──────┘
  ↓
Safety + capture + context gates
  ↓
FeminizationV1Controller
  ├─ reads mastery and current curriculum phase
  ├─ chooses one skill
  ├─ filters eligible observations
  ├─ resolves a reachable target when a validated policy exists
  ├─ selects one reviewed cue
  ├─ defines protected metrics
  └─ creates an exact-next trial
  ↓
Beginner practice card
  ↓
Exact next eligible attempt
  ↓
Causal verification
  ├─ intended change?
  ├─ exceeds measurement uncertainty?
  ├─ protected metrics stable?
  ├─ effort acceptable?
  └─ context unchanged?
  ↓
Feedback policy
  ├─ retry same cue
  ├─ change cue
  ├─ reduce difficulty
  ├─ fade feedback
  ├─ test retention
  └─ advance phase
  ↓
Mastery + learner-general motor response + goal overlay
  ↓
Optional LLM explanation
```

## 4.2 Central controller

Create one authoritative boundary:

```ts
resolveFeminizationV1Turn({
  domainPolicy,
  safetyState,
  captureState,
  curriculumState,
  masteryState,
  goalProfile,
  capabilityProfile,
  observations,
  motorResponseMap,
  goalCueOverlay,
  pendingTrial,
  sessionContext,
  now
})
```

It returns exactly one top-level action:

```text
stop_for_safety
repair_capture
collect_calibration
teach_awareness
serve_exercise
verify_attempt
repeat_same_cue
change_cue
reduce_difficulty
fade_feedback
test_retention
advance_phase
end_block
```

The generic target-metric engine is subordinate:

```text
curriculum phase
→ skill allowlist
→ task/context allowlist
→ eligible observations
→ generic ranking inside that narrow set
→ reviewed cue
```

Global ranking across all valid metrics is prohibited in active v1.

---

# 5. Domain policy and metric eligibility

Create/strengthen a versioned `feminization_v1` policy containing:

- supported population;
- active curriculum phases;
- active metrics by phase;
- protected metrics by phase;
- approved cues by phase;
- allowed take kinds by phase;
- research-only metrics;
- excluded metrics/cues;
- rollout mode and review gates.

Illustrative early allowlists:

```js
const ACTIVE_METRICS_BY_PHASE = {
  calibration: [],
  awareness_and_easy_voice: [],

  pitch_elicitation: [
    'pitch.median_hz'
  ],

  pitch_repeatability: [
    'pitch.median_hz',
    'pitch.p10_hz',
    'pitch.stability'
  ],

  resonance_elicitation: [
    'resonance.controlled_vowel_index'
  ],

  resonance_repeatability: [
    'resonance.controlled_vowel_index',
    'pitch.median_hz'
  ],

  pitch_resonance_integration: [
    'pitch.median_hz',
    'pitch.p10_hz',
    'resonance.controlled_vowel_index'
  ],

  short_phrase_transfer: [
    'pitch.median_hz',
    'pitch.p10_hz',
    'transfer.retention'
  ]
};
```

The exact metric IDs may change during implementation, but the principle may not.

---

# 6. State-model separation

## 6.1 Goal profile

Represents long-range learner preference, not immediate thresholds:

- clearly female-sounding / subtly feminine / flexible;
- descriptors such as clear, bright, soft, grounded, calm, energetic, warm;
- important real-world situations;
- optional human reference clips;
- reference use mode (`inspiration_only` or later `validated_same_prompt`).

No passing score belongs here.

## 6.2 Capability profile

Represents what the learner has demonstrated comfortably under valid measurement:

- baseline pitch distributions;
- demonstrated comfortable upward movement;
- effort envelope;
- controlled-vowel baseline formants;
- demonstrated resonance-shift range;
- analyzer/language-pack versions;
- calibration status and freshness.

## 6.3 Reachable training target

Temporary, lesson-scoped, and versioned. It contains:

- skill/metric/direction;
- aspirational goal reference;
- capability version;
- derivation policy ID/version;
- current target region;
- protected rules;
- expiry and invalidation conditions.

There is deliberately no anonymous default step.

## 6.4 Beginner mastery

Learner-level and independent of reference changes.

Recommended stages:

```text
not_observed
awareness
elicitation
repeatability
stability
integration
transfer
retention
review_due
```

Evidence should include:

- valid attempts;
- verified attempts;
- no-feedback verified attempts;
- distinct prompts;
- distinct sessions;
- most recent verified time;
- detector/policy version;
- effort history.

One lucky attempt never advances stable mastery.

## 6.5 Motor response

Split into:

### Learner-general motor response

`cue × skill × context × direction`

Track eligible trials, verified successes, confounds, wrong-way trials, high-cost trials, partial trials, mean verified gain, effort delta, retention successes, and transfer successes.

### Goal-specific cue overlay

Stores whether a cue is especially relevant/useful for the current goal profile.

Changing a reference voice should not erase the learner-general motor response.

## 6.6 Pending motor trial

Session-scoped and terminal. Must bind:

- learner/session;
- curriculum/mastery stage;
- cue ID/review version;
- cue-served timestamp and acknowledgement;
- focus comparison key;
- protected rules;
- baseline attempt ID;
- exact next take kind/task/prompt/context;
- effort before;
- one eligible attempt expiry;
- invalidation reason/state.

No skipping ahead to a later successful take.

---

# 7. Safety and eligibility

## 7.1 Authority order

```text
explicit pain / acute symptom
> reported discomfort, effort, fatigue, strain
> canonical safety policy
> acoustic advisory metrics
```

Acoustic quality metrics cannot diagnose vocal-fold health.

## 7.2 Required/desired self-report fields

- pain;
- throat pain;
- pain severity/location where supported;
- discomfort;
- effort;
- fatigue;
- strain;
- new or increased hoarseness;
- sudden loss of range;
- voice loss/near-aphonia;
- frequent cough/throat clearing during block;
- breathlessness/dizziness;
- acute respiratory illness;
- recent laryngeal surgery;
- clinician restriction where relevant.

## 7.3 Behaviour

Immediate stop for pain, sudden voice loss, severe breathlessness/dizziness, explicit stop request, or known restriction conflict.

Reduce difficulty/end the block for escalating discomfort, effort, fatigue, or new hoarseness.

Never:

- diagnose;
- claim vocal folds are healthy/damaged from app acoustics;
- reward whispering as feminisation;
- instruct throat squeezing;
- instruct forced larynx holding;
- ask the learner to persist through pain;
- let acoustic `strainRisk` override self-report.

Beginner copy for pain:

> Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.

---

# 8. Capture and evidence validity

## 8.1 Separate audio branches

**Acoustic branch:** keep as unprocessed as the platform allows for pitch/formant/spectral evidence.

**Recognition/alignment branch:** may use processing for ASR, prompt checking, timing, and eventual phoneme alignment.

Do not feed noise-suppressed/AGC-enhanced recognition audio into authoritative acoustic metrics unless separately validated.

## 8.2 Recording context

Create a recording-context fingerprint containing the relevant device/runtime/sample-rate/processing state. Spectral and level-dependent comparisons must respect validated device/context policies.

## 8.3 Capture outcomes

Examples:

```text
valid
retry_noise
retry_clipping
retry_too_quiet
retry_too_short
retry_wrong_prompt
retry_unstable_distance
unsupported_device_context
insufficient_voiced_material
```

Capture repair language is neutral and does not judge the learner’s performance.

---

# 9. Pitch metric and learning specification

## 9.1 Initial pitch measurements

- median F0;
- P10 F0 / low-tail pitch;
- P90 F0;
- robust semitone span;
- voiced coverage;
- tracker confidence;
- gross octave-error risk;
- sustained-note stability;
- phrase retention of an established region.

Use semitones for relative movement:

`ΔST = 12 * log2(F0_after / F0_before)`.

## 9.2 No universal female pitch target

Do not assign every beginner a fixed 180, 200, or 220 Hz goal.

A reachable pitch target requires:

- valid baseline evidence;
- comfortable exploratory movement;
- user-acceptable effort;
- detector uncertainty;
- current task complexity;
- named/versioned target policy;
- safety envelope.

Population norms may be research context but never the pass/fail engine.

## 9.3 Pitch success

`worked_verified` requires:

- the reviewed cue was genuinely served;
- exact next eligible attempt;
- same task/context;
- movement larger than uncertainty;
- movement toward the reachable region;
- protected effort/other required evidence available and acceptable;
- no pain or context drift.

## 9.4 Feedback fading

```text
first guided attempts
→ post-take feedback
→ hidden-guide attempt
→ different word/token
→ later-in-session retention
→ next-session retrieval before showing guide
```

Stable mastery requires no-feedback evidence.

---

# 10. Controlled-vowel resonance specification

## 10.1 Core rule

> Formants are comparable only when phonetic/task context is comparable and the detector itself is valid for that take.

Never compare `/i/` with `/u/`, arbitrary target speech with a learner vowel, or unrelated sentences using one F2 value.

## 10.2 Initial language pack

Recommended first development pack: `en-AU-feminization-foundations-v1`.

The exact IPA/vowel inventory and lexical tokens require phonetic/specialist review before being treated as final. Initial controlled set should cover:

- reviewed `/iː/`-family token;
- one reviewed mid-front vowel;
- one reviewed open vowel;
- reviewed `/uː/`-family token;
- `mmm → /iː/` transfer;
- later fixed words and one fixed phrase.

Every probe stores language-pack ID, IPA, exact prompt, accepted variants, review status, and demonstration asset contract.

## 10.3 Authoritative controlled-vowel evidence

The VoiceTrainer/analyzer should emit a canonical object containing at least:

- probe ID;
- language-pack ID;
- canonical vowel/IPA;
- prompt ID and match confidence;
- attempt/session/recording-context ID;
- analyzer version/profile;
- stable-segment start/end/duration/confidence;
- median F0;
- F1/F2/F3 and optional F4;
- confidence per formant;
- track continuity;
- estimator agreement;
- high-F0 reliability/risk;
- repeated-token group/consistency;
- comparison-context key;
- target-evidence kind;
- `validForCoaching`;
- explicit invalidity reasons.

Same probe/context is necessary but not sufficient.

## 10.4 Stable segment

Analyse the stable vowel centre. Exclude onset, offset, consonant transition, pitch break, creak, unvoiced region, clipping, and unstable candidate tracks.

## 10.5 Estimation requirements

- multiple frames;
- candidate-track retention;
- plausibility and continuity checks;
- more than one estimator/configuration where practical;
- high-F0 failure detection;
- repeated-token consistency;
- explicit uncertainty;
- fail closed rather than silently fall back to a weak track.

## 10.6 Resonance movement

For within-learner research and later coaching, store per-formant log shifts relative to the learner’s own controlled baseline:

`ΔFi = log2(Fi_take / Fi_baseline)`.

A combined controlled-vowel index may be explored as a confidence-weighted combination of F1-F3, but it must be calibrated empirically and must never be presented as a universal femininity or anatomical score.

## 10.7 Target priority

1. learner’s own controlled baseline and demonstrated comfortable movement;
2. learner’s best verified attempt;
3. same-probe human reference distribution;
4. broader aspiration/reference;
5. synthetic reference only as demonstration, not authority.

## 10.8 Resonance success

Requires:

- same controlled vowel/prompt/language pack/context;
- valid formant evidence;
- change exceeds measurement uncertainty;
- pitch remains inside protected tolerance;
- effort/discomfort acceptable;
- repeated evidence;
- no pain.

One `/i/` success must not be called general whole-voice resonance mastery.

---

# 11. Curriculum and mastery progression

Recommended phases:

```text
eligibility_and_calibration
auditory_awareness
easy_phonation
pitch_elicitation
pitch_repeatability
pitch_stability_and_retention
resonance_elicitation
resonance_repeatability
pitch_resonance_integration
short_phrase_transfer
retention_and_review
```

Later: intonation, connected speech, real-world transfer.

## 11.1 Calibration

Collect safety self-report, comfortable speech, controlled vowels, comfortable glide, fixed short phrase, and recording context. Advance when enough valid evidence exists and no safety stop applies. Do not score the learner.

## 11.2 Awareness/easy voice

Teach the beginner to hear higher/lower pitch, larger/darker versus smaller/brighter resonance, phrase movement, and easy versus pushed effort. Use A/B examples varying one dimension at a time.

## 11.3 Pitch elicitation

Progression:

`easy hum → small comfortable glide → vowel → syllable → word → short phrase`.

Primary: median pitch movement. Protected: effort, discomfort, relative level where valid, gross phonation stability.

## 11.4 Pitch repeatability/stability

Require repeated valid successes. Stable progression also requires hidden-guide/no-feedback evidence and later retention. Evidence counts belong in a named/versioned policy, not scattered magic numbers.

## 11.5 Resonance elicitation/repeatability

Begin with one validated `/i/` vertical slice, then repeated `/i/` tokens, no-feedback token, word transfer, and eventually another vowel class. Protect pitch and effort.

## 11.6 Integration

Internally track pitch and resonance but expose one correction at a time.

Examples:

```text
pitch outside reachable region + resonance stable → pitch cue
resonance needs work + pitch stable → resonance cue
both move but effort rises → reduce difficulty
resonance improves but pitch escapes tolerance → confounded
both stable → fade feedback / test retention
```

## 11.7 Short-phrase transfer

Progress `vowel → word → fixed phrase → changed phrase → short predictable answer` with more than one prompt, no-feedback success, acceptable effort, and later retention.

---

# 12. Cue registry and clinical review

Every active cue is finite, versioned, and reviewed. Cue definitions should include:

- cue ID/version;
- review state (`draft`, `clinical_review_required`, `approved_internal`, `approved_limited_active`, `retired`);
- domain/skill/mastery stages;
- take kinds/language packs;
- learner instruction;
- internal rationale;
- demo asset;
- intended effects;
- protected rules;
- required verification evidence;
- contraindications;
- stop conditions;
- maximum repetitions per block;
- fallback cue IDs;
- learner success/partial/retry copy.

Initial review set should stay small:

1. easy hum + small upward glide;
2. hum into vowel;
3. controlled `/i/` resonance contrast while pitch stays stable;
4. `mmm → /i/` easy onset/reset;
5. vowel → word transfer;
6. same-phrase retention.

Prohibited wording includes “force,” “squeeze the throat,” “hold the larynx up,” “whisper to sound feminine,” or “push higher.”

---

# 13. Exact-next causal verification

A trial is created only when:

- current phase permits the cue;
- review status permits the rollout mode;
- cue was actually shown/played;
- delivery is acknowledged;
- baseline attempt is valid;
- task/target/context are fixed;
- exact next take is known.

Terminal invalidations include:

- target change;
- task/prompt/language-pack change;
- take-kind/session change;
- analyzer/profile version change;
- device/context mismatch under the relevant policy;
- another cue intervened;
- learner skipped the requested exercise;
- baseline repeated as after-take;
- missing required protected evidence;
- pain;
- expiry.

Only `worked_verified` positively updates cue effectiveness or mastery. Partial movement remains research evidence but is not success.

---

# 14. Beginner UX

## 14.1 Onboarding

Do not require target upload. Ask for general direction, preferred descriptors, important situations, experience level, safety exclusions, and optional references; then guide calibration.

## 14.2 Practice card

```text
TODAY'S FOCUS
Comfortable pitch

LISTEN
[approved demonstration]

TRY
Start with an easy “mm.”
Glide a small step upward.
Open into “mee” without getting louder.

[Record]

RESULT
Your note moved upward and stayed easy.

NEXT
Try it once without the guide.
```

## 14.3 Result states

- **Could not measure:** explain capture repair.
- **Valid but no reliable change:** suggest retry/alternate cue.
- **Partial/confounded:** name the second changing variable without blame.
- **Verified change:** state the successful acoustic/comfort outcome simply.
- **Safety stop:** immediate, unambiguous stop language.

Do not label the learner a failure.

## 14.4 Hide by default

- raw F1/F2/F3;
- confidence decimals;
- schema IDs;
- normalized target distance;
- cue utility/motor internals;
- gender/pass probabilities;
- gender-coloured normative bands.

Technical detail is opt-in.

---

# 15. LLM boundary

The LLM receives a bounded deterministic decision object, not raw authority. It may rephrase within allowed facts and explain reviewed educational content. It may not:

- invent a new exercise;
- choose a different focus;
- change a target or threshold;
- diagnose;
- override safety;
- infer anatomy;
- declare gender/passing status.

All model output remains subject to deterministic sanitisation.

---

# 16. Persistence boundaries

## Session-scoped

- pending motor trial;
- current curriculum phase/exercise;
- current reachable target;
- feedback-fading stage;
- current block effort/fatigue;
- persistence counters.

## Learner-level

- beginner mastery;
- learner-general motor response;
- language-pack calibration;
- capability profile;
- retention history;
- preferences/consent.

## Goal-scoped

- goal profile;
- references;
- target-specific cue overlay;
- long-range style preferences.

Do not inject raw motor statistics, attempt IDs, formants, target-distance histories, or cue probabilities into the LLM learner memo.

---

# 17. Validation programme

## 17.1 Unit/contract tests

Cover policy allowlists, invalid evidence, exact-next lifecycle, protected metrics, no shadow learning, cue review gates, target/context invalidation, mastery progression, feedback fading, persistence normalisation, and privacy boundaries.

## 17.2 Acoustic golden corpus

Create a versioned local corpus with consent/provenance.

### Pitch corpus

- synthetic/reference tones;
- expert-corrected sustained vowels;
- words/phrases;
- breathy/clear/creaky examples;
- pitch breaks;
- octave-error cases;
- supported devices;
- quiet/noisy cases.

### Formant corpus

- all supported vowels;
- multiple speakers/pitch levels;
- repeated tokens;
- deliberate resonance/articulation contrasts;
- expert-corrected trajectories;
- high-F0 failure examples;
- supported devices.

### Capture-invalid corpus

- clipping;
- fan/music/another speaker;
- excessive distance/device movement;
- reverb;
- wrong prompt/vowel;
- whispering;
- coughing;
- hum mixed with speech.

## 17.3 Engineering gates

Final numerical gates must be preregistered before the held-out set is inspected. Candidate development targets may include strict pitch error/octave-error limits and strong formant repeatability/direction agreement, but do not silently convert provisional numbers into clinical or product norms.

The most important measurement-quality outcome is a low **false-valid** rate. Rejecting a usable take is inconvenient; accepting a bad take and giving confident motor coaching is worse.

## 17.4 Replay evaluator

For each retained attempt report:

- capture validity;
- curriculum phase;
- eligible/rejected metrics;
- legacy focus vs v1 focus;
- cue eligibility;
- exact-next verification;
- protected regressions;
- effort change;
- feedback mode;
- mastery effect.

Aggregate no-evidence rate, focus distribution, phase-policy violations, expert focus agreement, confound rate, missing-protected-evidence rate, no-feedback retention, effort increase, cue repetition, and capture-repair performance.

## 17.5 Expert review

Experienced gender-affirming voice professionals should review skill selection, safety stops, cue wording, contraindications, repetition/rest rules, progression, and whether the app should repeat/simplify/change cue/stop.

## 17.6 Beginner pilot

Measure comprehension of pitch versus resonance, actionability, comfort, whether displays increase dysphoria/compulsive optimization, no-feedback retention, phrase transfer, safety events, satisfaction/congruence, and dropout/friction.

The success criterion is not merely that a graph moved.

---

# 18. Repository and PR strategy

PR #1 is an integration/reference branch. At plan handoff it has grown into a large multi-purpose draft. Do not merge it wholesale as active production coaching.

After the P0 audit/freeze, extract scoped PRs:

1. **Metric/verification foundation** — observations, confidence, target distance, comparison identity, protected verification; no active runtime.
2. **Shadow/evaluation** — buffered/SSE boundary, privacy witness, replay reporting; no learner mutation.
3. **Feminization v1 controller/curriculum** — domain policy, controller, mastery, allowlists.
4. **Pitch vertical slice** — calibration, served cue, exact trial, retention, beginner feedback.
5. **Controlled resonance/analyzer contract** — language pack, F1-F3 evidence, formant validity/golden fixtures.
6. **Learning persistence/motor split** — learner-general motor response, goal overlay, mastery/retention.
7. **Beginner UI** — one-card experience, playback, capture repair, feedback fading.

Do not use GitHub Actions to rewrite source and push implementation commits. CI validates; local development changes source.

Resolve whether this handover repo is the canonical deployment repository before production merge.

---

# 19. File-level implementation map

## Preserve/refine

- `backend/coaching/metric-observations.js`
- `backend/coaching/target-coaching-engine.js`
- `backend/coaching/target-metric-runtime.js`
- `backend/coaching/target-metric-bridge.js`
- `backend/coaching/training-target.js`
- `backend/coaching/motor-trial.js`
- `backend/coaching/motor-map.js`
- `backend/coaching/beginner-mastery.js`
- `backend/coaching/beginner-feedback.js`
- `backend/coaching/feminization-v1-policy.js`
- `backend/coaching/feminization-v1-curriculum.js`
- `backend/coaching/controlled-probes.js`

## Add

- `backend/coaching/feminization-v1-controller.js`
- `backend/coaching/feminization-v1-controller.test.js`
- `backend/coaching/metric-eligibility.js`
- `backend/coaching/metric-eligibility.test.js`
- `backend/coaching/feedback-schedule.js`
- `backend/coaching/feedback-schedule.test.js`
- `backend/coaching/language-packs/en-AU-v1.js`
- `backend/coaching/controlled-vowel-evidence.js`
- `backend/coaching/controlled-vowel-evidence.test.js`
- `backend/coaching/learner-motor-response.js`
- `backend/coaching/goal-cue-overlay.js`
- `backend/coaching/curriculum-progress.js`
- `services/voice-trainer/tests/golden/`
- `docs/FEMINIZATION_V1_RUNTIME_AUDIT.md`
- `docs/ACOUSTIC_VALIDATION_PLAN.md`
- `docs/CUE_REVIEW_MATRIX.md`
- `docs/BEGINNER_SESSION_FLOW.md`

## Persistence refactor

`learner-context-service.js` is already large. Avoid adding more direct responsibilities. Extract a narrow voice-learning store/service with methods such as:

```text
getBeginnerMastery
updateBeginnerMastery
getLearnerMotorResponse
updateLearnerMotorResponse
getGoalCueOverlay
updateGoalCueOverlay
```

Keep compatibility adapters until migration tests prove the new storage.

---

# 20. Required test matrix

## Policy

- pitch phase cannot choose breathiness;
- pitch phase cannot choose prosody;
- pitch phase cannot choose legacy weight;
- feminisation pitch foundation cannot choose a downward corrective cue merely because a long-range reference is lower;
- resonance phase cannot use arbitrary clip-wide F2;
- legacy weight/resonance cannot become active v1 focus;
- target upload absent is supported;
- target change preserves mastery and learner-general motor response;
- shadow never mutates.

## Curriculum

- calibration precedes correction;
- awareness precedes manipulation;
- resonance requires controlled evidence;
- integration requires prior pitch/resonance evidence;
- transfer requires no-feedback evidence;
- one take cannot create stable mastery;
- pain stops;
- increasing effort simplifies/ends rather than chasing target.

## Acoustic

- wrong prompt invalidates;
- wrong vowel invalidates;
- high-F0 unreliable formants invalidate;
- movement below uncertainty is no effect;
- analyzer mismatch invalidates;
- language-pack mismatch invalidates;
- device/context mismatch follows policy;
- pitch octave errors reject/fail closed;
- `no_formants` profile cannot coach resonance.

## Motor trial

- cue must be served;
- exact next eligible attempt only;
- no target/task/take/analyzer drift;
- terminal trial cannot resurrect;
- missing effort/protected evidence cannot verify;
- durable updates are idempotent.

## UX

- no schema terms or `worked_verified` in beginner output;
- no gender/pass score;
- capture failure neutral;
- confound explained;
- pain message immediate;
- technical details opt-in;
- no unreviewed cue wording.

---

# 21. Work packages and execution order

## P0 — Audit/freeze

- record exact branch SHA and relation to main;
- rerun full Node coaching suite;
- rerun full VoiceTrainer suite;
- inventory one-shot workflows and `.bak` debris;
- trace policy/curriculum/mastery/feedback through buffered, SSE, persistence, and UI;
- decide canonical deployment repo;
- freeze integration SHA and split plan.

## P1 — Authoritative controller

- hard `feminization_v1` domain;
- safety/capture before correction;
- phase allowlists before ranking;
- pending-trial resolution before new cue;
- invalid mode fails to shadow;
- shadow non-mutating.

## P2 — Pitch vertical slice

- pitch calibration evidence;
- versioned reachable-target policy interface;
- small approved-dev cue set;
- cue-served lifecycle;
- exact-next verification;
- protected effort/level;
- feedback fading;
- no-feedback retention;
- mastery update;
- beginner card.

## P3 — Controlled vowel/analyzer + `/i/` resonance

- first versioned language pack;
- stable-segment controlled-vowel evidence;
- F0/F1/F2/F3/confidence/continuity/estimator agreement/high-F0 risk;
- human-corrected golden corpus;
- controlled `/i/` resonance trial;
- protected pitch/effort;
- word transfer;
- hidden-guide retention.

## P4 — Integration

- protect established pitch while training resonance and vice versa;
- short-phrase transfer;
- cross-session retrieval.

## P5 — Motor model split

- learner-general motor response;
- goal-specific overlay;
- migration provenance/no invented confidence;
- LLM-context exclusion.

## P6 — Evaluation/review

- replay evaluator;
- cue review matrix;
- beginner usability pilot;
- privacy review;
- safety/failure analysis.

## P7 — Limited active

Only after all release gates pass: rollback, approved devices/language pack/cues, telemetry, privacy, internal pilot, owner approval.

Do not jump directly from shadow to production active.

---

# 22. Release gates

No learner-facing active release until all are true:

- canonical repo confirmed;
- scoped reviewable PRs;
- full Node suite green;
- full VoiceTrainer suite green;
- no source-mutating CI workflow;
- pitch golden-corpus gates passed;
- controlled-resonance golden-corpus gates passed;
- false-valid gate passed;
- reviewed/approved cue subset;
- authoritative beginner controller integrated;
- exact served-cue lifecycle integrated;
- no-feedback retention integrated;
- privacy review passed;
- beginner usability pilot completed;
- rollback tested;
- no unresolved high-severity safety issue.

---

# 23. First complete milestone

A fresh local install must demonstrate both loops.

## Pitch

```text
safe calibration
→ app selects pitch phase
→ reviewed cue shown/played
→ cue-served event stored
→ exact next attempt captured
→ pitch movement verified
→ effort/protected metrics verified
→ feedback faded
→ no-feedback repetition
→ mastery updated
→ later retention checked
```

## Controlled `/i/` resonance

```text
validated /i/ probe
→ formant evidence passes
→ reviewed resonance cue served
→ exact next /i/ captured
→ multi-formant movement verified
→ pitch and effort protected
→ word transfer
→ no-feedback repetition
→ mastery updated
→ later retention checked
```

Until both exist, TransVoice remains a research foundation rather than a finished beginner coach.

---

# 24. Agent operating procedure

Before editing:

```bash
git fetch --all --prune
git switch sol/target-metric-coaching-foundation
git pull --ff-only
git rev-parse HEAD
git status --short
git log --oneline --decorate --graph main..HEAD
```

Run the supported Node and Python suites and retain exact output. Then search actual runtime reachability; do not infer integration from file existence.

For every task:

1. identify the canonical existing contract;
2. write/update tests;
3. implement the smallest coherent change;
4. run focused tests;
5. run the full relevant suite;
6. update `FEMINIZATION_V1_STATUS.md`;
7. commit one purpose;
8. avoid source-mutating workflows;
9. do not activate unvalidated behaviour;
10. record remaining uncertainty.

Use the task IDs in `FEMINIZATION_V1_BACKLOG.yaml` and the report template in `FEMINIZATION_V1_AGENT_EXECUTION.md`.

---

# 25. Final priority order

1. audit and freeze the oversized integration branch;
2. prove runtime use of policy/curriculum/mastery/feedback;
3. implement the authoritative feminisation controller;
4. complete the pitch vertical slice;
5. implement authoritative controlled-vowel evidence;
6. complete the `/i/` resonance vertical slice;
7. integrate feedback fading and retention;
8. split learner-general motor response from goal utility;
9. validate acoustics against human-corrected evidence;
10. obtain specialist cue review;
11. run beginner usability testing;
12. consider limited active rollout;
13. only then add intonation, spontaneous speech, target cloning, additional languages, or additional gender directions.

The project succeeds when it becomes a reliable motor-learning system—not when it accumulates the largest set of acoustic numbers.
