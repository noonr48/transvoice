# TransVoice Agent Entry Point

## Canonical repository

This public repository (`noonr48/transvoice`) is the canonical development surface. Do not use paths or branch instructions from the historical handover estate as current instructions.

Before changing code, pin the exact `main` SHA and record it in your task evidence. Develop on a scoped branch; do not pile unrelated work directly onto `main`.

## Authoritative current direction

Read these in order:

1. `docs/CURRENT_STATUS.md`
2. `docs/FEMINIZATION_V1_MASTER_PLAN.md`
3. `docs/FEMINIZATION_V1_AGENT_EXECUTION.md`
4. `docs/FEMINIZATION_V1_BACKLOG.yaml`
5. `docs/FEMINIZATION_V1_STATUS.md` (historical implementation ledger and receipts)
6. `docs/FEMINIZATION_V1_DECISION_LOG.md`
7. `docs/ACOUSTIC_VALIDATION_PLAN.md`

Older design documents are useful context but do not override the v1 product laws.

## Current product scope

The first active product remains deliberately narrow: adult beginner MTF/transfeminine English speaking-voice feminisation. The next milestone is a **pitch shadow alpha**, not feature expansion.

Do not expand into masculinisation, nonbinary/bidirectional training, singing, surgery rehabilitation, target-voice cloning, generic femininity scoring, or new acoustic dimensions until the v1 release gates are met.

## Non-negotiable laws

- Deterministic code chooses safety action, curriculum phase, metric, target and cue. LLMs may only phrase an already-approved decision.
- Curriculum phase selects the skill before metrics are ranked.
- One learner-facing focus at a time.
- No gender, femininity, passing or global voice-quality score.
- No anatomical position inferred from acoustics.
- Pain and immediate-stop self-report outrank acoustic evidence.
- Missing or unknown evidence is never zero or success.
- A cue receives causal credit only from the exact next eligible finalized attempt after it was genuinely served and acknowledged.
- Shadow decisions never mutate learner/session learning state.
- No active unreviewed cue and no configuration shortcut that manufactures review approval.
- No universal pitch target or anonymous pitch-step constant; reachable movement derives from the learner's demonstrated comfortable movement.
- Arbitrary uploaded speech and TTS/synthetic output are not acoustic ground truth.
- Retention without continuous feedback is required before stable mastery.

## Repository layout

- `backend/` — Node coaching gateway/runtime and deterministic coaching engine.
- `backend/coaching/` — FEM v1 control plane, motor-trial lifecycle, cue lifecycle and replay/eval logic.
- `frontend/` — TypeScript/Vite learner UI.
- `services/voice-trainer/` — Python FastAPI/Praat DSP analyzer.
- `docs/` — product contracts, status, validation plans and evidence.
- `tools/` — offline validation tooling.

There is no `transvoice-app/` prefix in this canonical repository.

## Required validation

From repository root:

```bash
npm ci
npm run test:backend

cd frontend
npm ci
npm test
npx tsc --noEmit
cd ..

bash services/voice-trainer/setup-venv.sh
services/voice-trainer/.venv/bin/pip install pytest httpx
bash scripts/test-python.sh
```

GitHub Actions must run the equivalent permanent gates. A workflow dispatch or queued run is not evidence of success; match results to the exact candidate commit SHA.

## Runtime adoption rule

`backend/coaching/fem-v1-runtime-turn.js` is the shared FEM orchestration seam. Buffered and streaming paths must converge on it rather than implementing separate controller semantics.

Until the release gates are explicitly satisfied, runtime adoption remains **shadow-only**. Do not wire active state application or learner-facing cue serving merely because the controller can compute an `active` decision.

Any future active application must be atomic, version-checked and idempotent by finalized-attempt identity.

## Acoustic validation discipline

Pitch detector tuning uses only the preregistered development split until it passes the development gate. Do not inspect/tune against the held-out release speakers. Gate changes require a dated amendment written before the run being judged.

Detector benchmark results must identify detector/code SHA, corpus split, harness version, metric-definition/gate version and verdict. See `docs/DETECTOR_BENCHMARK_LEDGER.md`.

## Human-only gates

Agents may prepare review material, tests and tooling, but may not manufacture:

- clinical/specialist cue approval;
- human-recorded cue demonstrations;
- expert-corrected acoustic ground truth;
- beginner usability-pilot evidence.

Keep those gates visibly blocked until real evidence exists.
