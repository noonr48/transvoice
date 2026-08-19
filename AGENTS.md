# TransVoice Agent Entry Point

## Authoritative current product direction

For new development, read these files in order:

1. `docs/FEMINIZATION_V1_MASTER_PLAN.md`
2. `docs/FEMINIZATION_V1_AGENT_EXECUTION.md`
3. `docs/FEMINIZATION_V1_BACKLOG.yaml`
4. `docs/FEMINIZATION_V1_STATUS.md`
5. `docs/FEMINIZATION_V1_DECISION_LOG.md`

These documents define the next product phase. Older design documents remain useful historical context, but they do not override the Feminization Foundations v1 contract when they conflict with it.

## Initial product scope

The initial active product is **adult beginner MTF/transfeminine English speaking-voice feminisation**. It is deliberately narrow. Do not expand into masculinisation, nonbinary/bidirectional training, singing, surgery rehabilitation, open-ended spontaneous-speech coaching, target-voice cloning, or extra acoustic dimensions until the v1 release gates are met.

The first two end-to-end product proofs are:

1. **Comfortable pitch:** calibration → approved cue genuinely served → exact next take → protected verification → feedback fading → no-feedback retention → mastery update.
2. **Controlled `/i/` resonance:** authoritative controlled-vowel evidence → approved cue genuinely served → exact next `/i/` take → resonance movement with pitch/effort protected → word transfer → no-feedback retention → mastery update.

## Non-negotiable laws

- Curriculum phase selects the skill before metrics are ranked.
- One learner-facing focus at a time.
- No gender, femininity, passing, or global voice-quality score.
- No anatomical position inferred from acoustics.
- Pain stops active training.
- Missing/unknown evidence is never treated as zero or success.
- A cue receives causal credit only from the exact next eligible take after it was actually served.
- Shadow decisions never update mastery or motor learning.
- No active unreviewed cue.
- No universal production pitch target or anonymous step constant.
- Arbitrary uploaded speech cannot become a vowel/formant target.
- TTS/synthetic output is not acoustic ground truth in v1.
- LLMs may explain an approved deterministic decision; they may not choose technique, safety action, metric, target, or threshold.
- Retention without continuous feedback is required before stable mastery.

## Repository/branch protocol

`sol/target-metric-coaching-foundation` is an **integration/reference branch**. Do not continue piling unrelated features into PR #1. After the audit/freeze work, create scoped branches/PRs from the recorded integration SHA according to the master plan.

Do not use GitHub Actions or other CI jobs to rewrite source and push generated code. Make source changes in the local checkout, inspect the diff, run tests, and push normal commits.

## First action for a new local agent

Run the P0 audit from `docs/FEMINIZATION_V1_AGENT_EXECUTION.md`. In particular:

```bash
git fetch --all --prune
git switch sol/target-metric-coaching-foundation
git pull --ff-only
git rev-parse HEAD
git status --short
git log --oneline --decorate --graph main..HEAD

npm install --prefix transvoice-app/backend \
  --ignore-scripts --no-package-lock --no-audit --no-fund
node --test transvoice-app/backend/coaching/*.test.js

cd transvoice-app/services/voice-trainer
python -m pytest
```

Then create/update `docs/FEMINIZATION_V1_RUNTIME_AUDIT.md` and `docs/FEMINIZATION_V1_STATUS.md`. Do not claim that a module is active merely because a file or unit test exists; trace the actual buffered, SSE, persistence, and UI call paths.

## Development priority

Do not add more generic metrics. The next priority is:

`audit/freeze → hard curriculum gate → authoritative controller → pitch vertical slice → authoritative controlled-vowel evidence → /i/ resonance vertical slice → feedback fading/retention → motor-response split → acoustic validation → specialist review → limited active rollout`.
