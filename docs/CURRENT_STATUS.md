# TransVoice — Current Status

**Canonical repo:** `noonr48/transvoice`  
**Status date:** 2026-08-19  
**Reference public baseline:** `29a6b6cb30209fc6e05006f80afc150215022e57`

This file is the short current-state entry point. `FEMINIZATION_V1_STATUS.md` remains the detailed historical implementation ledger and receipt archive.

## Product state

TransVoice is a research/development voice-feminisation training system. The deterministic FEM v1 control plane is substantially implemented and test-backed, but learner-facing FEM v1 activation remains blocked.

The next release-shaped milestone is **Pitch Shadow Alpha**: one comfortable-pitch motor-learning loop running end-to-end on real sessions without serving its FEM decision to the learner.

## What is already in the public tree

- Authoritative deterministic FEM v1 controller and curriculum/metric eligibility gates.
- Reachable comfortable-pitch calibration/step policy; no universal production pitch target.
- Controlled-vowel evidence contracts and the `/i/` resonance vertical proof.
- Cue-served/acknowledged lifecycle and exact-next motor-trial contracts.
- Feedback fading, retention/review scheduling and beginner-session-card components.
- Learner motor-response and goal-overlay foundations.
- Detector-authority/release registry and replay/shadow evaluation machinery.
- Shared `fem-v1-runtime-turn` orchestration seam.
- PTDB-TUG pitch-validation harness and preregistered release gates.
- First-release five-cue specialist review matrix.

## Open release blockers

1. **Pitch detector development gate — FAIL.** Latest public sync reports false-valid reduced from 0.405 to about 0.167, still above the preregistered <=0.05 gate. Continue development-split work only; held-out release speakers remain untouched for tuning.
2. **Shared runtime adoption.** Buffered and streaming coach paths must converge on `resolveFemV1RuntimeTurn` in shadow mode and prove semantic parity.
3. **State transaction boundary.** Before any active mode, attempt sequencing/trial settlement/mastery/motor learning must have atomic, revision-checked, idempotent application.
4. **Cue specialist review — HUMAN GATE.** No first-release cue is learner-servable until exact wording is approved by a named qualified reviewer.
5. **Human cue demonstrations — HUMAN GATE.** Approved teaching demonstrations are required where the cue matrix says so; TTS is not acoustic authority.
6. **Controlled-vowel/formant validation — BLOCKED/PARTIAL.** The evidence contract is ahead of expert-corrected real-human formant validation.
7. **Shadow pilot evidence.** Real-device/real-session proposed decisions need replay/manual review before any active alpha.
8. **Held-out pitch release evaluation.** Run once only after the detector version is frozen and development gates pass.

## Pitch Shadow Alpha acceptance gates

- [ ] Public repo instructions and permanent CI are canonical.
- [ ] Shared FEM orchestrator is used by all relevant coach paths in shadow.
- [ ] Shadow execution is side-effect free, including attempt sequencing.
- [ ] Duplicate/retried finalized attempts are idempotent and conflicting reuse fails closed.
- [ ] Exact-next settlement uses the runtime-assigned canonical attempt ordinal, never caller-supplied ordinal authority.
- [ ] Atomic/versioned active-state application boundary is implemented and adversarially tested (but not learner-enabled).
- [ ] Pitch detector passes the preregistered **development** gate.
- [ ] At least one pitch cue is approved by a named qualified human reviewer.
- [ ] Required human demonstration exists for that exact approved cue version.
- [ ] Real-session shadow capture/replay is operational and reviewed.

Only after those gates: freeze the detector candidate, evaluate the held-out corpus once, and consider a tiny internal active pitch-only alpha if it passes.

## Explicitly deferred

Do not spend the next arc adding generic acoustic metrics, prosody curriculum, phonation/weight curriculum, target-voice cloning, a larger LLM decision role, or a femininity/passing score. Those do not unblock the first trustworthy motor-learning loop.

## Validation truth

A high unit-test count is not a release claim. For each candidate record the exact SHA and distinguish:

- structural/code review;
- unit/integration/end-to-end coverage;
- GitHub Actions result matched to that SHA;
- real-human acoustic validation;
- human specialist/usability evidence.
