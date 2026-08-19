# Feminization Foundations v1 — Agent Execution Runbook

**Authority:** This runbook operationalises `FEMINIZATION_V1_MASTER_PLAN.md`.
**Rule:** Complete tasks in dependency order. Do not expand scope merely because a later idea is technically interesting.

---

# 1. Immediate local takeover

```bash
git fetch --all --prune
git switch sol/target-metric-coaching-foundation
git pull --ff-only
git rev-parse HEAD
git status --short
git log --oneline --decorate --graph main..HEAD
```

Record:

- exact SHA;
- relationship to `main`;
- uncommitted files;
- one-shot workflow files;
- `.bak` files;
- test environment;
- deployment-repository status.

Run:

```bash
npm install --prefix transvoice-app/backend \
  --ignore-scripts --no-package-lock --no-audit --no-fund

node --test transvoice-app/backend/coaching/*.test.js

cd transvoice-app/services/voice-trainer
python -m pytest
```

Do not write “tests pass” without preserving exact command output.

---

# 2. Audit runtime connectivity

Run:

```bash
rg "feminization-v1-policy|feminization-v1-curriculum" transvoice-app
rg "beginner-mastery|beginner-feedback" transvoice-app
rg "evaluateTargetMetricRuntime|targetMetricMode" transvoice-app
rg "getBeginnerMastery|updateBeginnerMastery" transvoice-app
rg "motorMap|pendingTrial|cueServed" transvoice-app
rg "controlledProbe|targetMetricProbe|comparisonContextKey" transvoice-app
```

Create `docs/FEMINIZATION_V1_RUNTIME_AUDIT.md` with:

| Module | Imported by | Executed in buffered | Executed in SSE | Writes state | User-facing | Tested |
|---|---|---:|---:|---:|---:|---:|

Do not infer runtime integration from the existence of a file.

---

# 3. Freeze the integration branch

The current draft is a reference/integration branch.

Actions:

- remove source-mutating one-shot workflows;
- remove `.bak` source artefacts after confirming they are not authoritative;
- update from `main`;
- tag or record the integration SHA;
- stop adding unrelated feature work;
- create scoped branches for the tasks below.

---

# 4. Task batches

## Batch A — Controller and policy

Create:

```text
backend/coaching/feminization-v1-controller.js
backend/coaching/feminization-v1-controller.test.js
backend/coaching/metric-eligibility.js
backend/coaching/metric-eligibility.test.js
```

Required behaviour:

- safety precedes all;
- capture validity precedes correction;
- pending trial is resolved before new cue;
- phase allowlist filters observations;
- generic ranking sees only eligible dimensions;
- invalid mode fails to shadow;
- no active cue without approval;
- no mutation in shadow.

Acceptance tests:

- pitch phase cannot select breathiness;
- pitch phase cannot select prosody;
- pitch phase cannot select legacy weight;
- resonance phase cannot select arbitrary clip-wide F2;
- target upload absent is supported;
- pain yields stop;
- low capture yields repair.

## Batch B — Beginner mastery integration

Verify and refine:

```text
backend/coaching/beginner-mastery.js
learner-context-service.js or extracted voice-learning store
```

Requirements:

- learner-level, not target-scoped;
- excluded from LLM context;
- target change preserves mastery;
- memory reset clears mastery;
- shadow cannot mutate;
- analyzer/policy version recorded;
- retention and `review_due` supported.

Do not keep expanding `learner-context-service.js`; extract a dedicated persistence module.

## Batch C — Pitch vertical slice

Implement:

- pitch calibration evidence;
- named reachable-target policy interface;
- approved-dev cue subset;
- cue-served event;
- exact-next trial;
- effort and relative-level protection;
- feedback-fading schedule;
- no-feedback test;
- mastery mutation;
- beginner feedback card.

No universal production pitch target or step.

## Batch D — Language pack and controlled vowel evidence

Create a reviewed language pack. Candidate:

```text
backend/coaching/language-packs/en-AU-v1.js
```

Do not finalise IPA without review.

Implement authoritative evidence:

```text
backend/coaching/controlled-vowel-evidence.js
```

Required fields are defined in the master plan.

Formant coaching remains disabled until the golden-corpus gate passes.

## Batch E — Controlled `/i/` resonance slice

Implement:

- validated `/i/` probe;
- repeated baseline tokens;
- F1–F3 evidence;
- high-F0 risk;
- protected pitch;
- exact-next trial;
- word transfer;
- no-feedback retention;
- mastery mutation.

Reject:

- wrong vowel;
- prompt mismatch;
- arbitrary target speech;
- analyzer mismatch;
- high-F0 unreliable track;
- change below uncertainty.

## Batch F — Motor model split

Refactor:

```text
learner-general motor response
goal-specific cue overlay
```

Migration:

- preserve existing target-scoped maps;
- import only context-compatible evidence;
- do not invent confidence;
- mark migrated entries with source/version;
- keep old map readable until migration is verified.

## Batch G — Beginner UI

Implement the card:

```text
Today’s focus
Listen
Try
Record
Result
Next
```

Integrate:

- approved demo;
- best-take replay;
- capture repair;
- safety stop;
- hidden technical details;
- cue rejection;
- comfort/congruence check;
- feedback fading.

---

# 5. Validation workstream

Create:

```text
services/voice-trainer/tests/golden/
docs/ACOUSTIC_VALIDATION_PLAN.md
```

The golden corpus must contain:

- pitch truth;
- vowel/formant truth;
- high-F0 failure cases;
- noise/clipping;
- wrong prompt/vowel;
- device variation;
- expert annotations.

Create a replay evaluator that reports:

- eligible/rejected evidence;
- legacy/v1 focus;
- phase-policy violations;
- confounds;
- missing protected evidence;
- retention;
- effort.

---

# 6. Clinical review workstream

Generate `docs/CUE_REVIEW_MATRIX.md` from the registry.

No cue moves beyond `approved_dev` without a named specialist review.

Do not allow an environment variable to convert `clinical_review_required` into production approval.

---

# 7. Required PR structure

1. metric foundation;
2. shadow/evaluation;
3. controller/curriculum;
4. pitch slice;
5. controlled resonance;
6. persistence/motor split;
7. beginner UI.

Each PR:

- has one purpose;
- includes focused and full tests;
- documents scientific assumptions;
- cannot silently activate unreviewed behaviour;
- updates the master-plan status table.

---

# 8. Agent report template

```markdown
## Task
TV-FEM-...

## Current state
...

## Changes
...

## Tests run
- command:
- result:

## Evidence and assumptions
...

## Safety/privacy impact
...

## Remaining limitations
...

## Next dependency
...
```

---

# 9. Prohibited shortcuts

- no gender score;
- no arbitrary female pitch band;
- no direct anatomy claim;
- no arbitrary F2 target;
- no breathiness-as-femininity;
- no target clone authority;
- no LLM-selected technique;
- no shadow learning;
- no later-take cherry-picking;
- no missing effort treated as zero;
- no production cue without review;
- no source-mutating GitHub Action;
- no monolithic PR continuation;
- no spontaneous-speech resonance before controlled validation.

---

# 10. First completion checkpoint

Stop expansion and produce an internal demonstration when these are both complete:

- pitch calibration → served cue → exact attempt → verified protected change → hidden-guide retention → mastery;
- `/i/` calibration → served cue → exact attempt → verified formant movement with pitch protected → word transfer → hidden-guide retention → mastery.

At that checkpoint, perform a new architectural, scientific, safety, and beginner-UX review before adding intonation or spontaneous speech.
