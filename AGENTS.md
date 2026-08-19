# TransVoice Repository Instructions

This public repository is the canonical engineering tree for TransVoice.

## Current milestone

The release-shaped target is **Pitch Shadow Alpha**: one comfortable-pitch FEM v1 motor-learning loop executing through the shared runtime in shadow before any learner-facing FEM activation.

Read `docs/CURRENT_STATUS.md`, `docs/CUE_QUALIFICATION.md`, and `docs/DETECTOR_BENCHMARK_LEDGER.md` before changing the FEM runtime, pitch detector, cue policy, or release gates.

## Product laws

- Preserve measurement honesty. Never convert missing/unreliable acoustic evidence into a learner correction.
- Never weaken preregistered detector gates to make a candidate pass.
- Do not tune on held-out release speakers.
- Comfortable-pitch targets are individualized and reachable; do not introduce a universal production-pitch target.
- Safety/capture validity outrank correction. Pain, increasing strain, explicit stop requests and unusable capture fail closed.
- Shadow mode must remain side-effect free and must not serve FEM instructions or request causal motor trials.
- Exact-next authority comes from the runtime-assigned canonical attempt sequence, not caller-supplied ordinals.
- Active state application, if introduced later, must be atomic, revision checked and idempotent.

## Cue evidence policy

A missing specialist is **not** an engineering blocker. Do not fabricate a specialist, clinical approval, study result, human recording or usability result.

For the narrow pitch alpha, cue authority comes from the executable non-clinical qualification contract in `backend/coaching/cue-alpha-qualification.js`. Qualification is content- and metadata-derived, scope-limited and fail-closed. It does not claim clinical approval. External specialist review is optional additional evidence when available.

Do not broaden this non-clinical qualification to resonance, phonation/weight, anatomy-directed manipulation or other skills merely to make them servable. Each broader skill needs its own bounded evidence contract.

A prerecorded human demonstration is not required for the first text-described pitch glide. TTS must never be treated as acoustic truth. If a future cue genuinely depends on imitation, establish and validate a demonstration-evidence contract for that cue rather than inventing one.

## Validation

Before publishing changes, run or obtain evidence for the relevant checks and report them separately:

- structural diff verification at an exact SHA;
- Node coaching tests;
- FEM product-law regressions;
- VoiceTrainer Python tests;
- frontend tests/typecheck where touched;
- detector development/held-out evidence only under the preregistered protocol.

A high test count is not a release claim. CI setup failure is not a product pass, and product failure is not to be hidden by changing the workflow.

## Scope discipline

Do not add generic metrics, prosody curriculum, phonation/weight curriculum, target-voice cloning, a larger LLM decision role, or femininity/passing scores unless they directly unblock an explicitly requested milestone.

Keep generated/vendor changes out of ordinary patches. Preserve concurrent work and never force-update shared branches.
