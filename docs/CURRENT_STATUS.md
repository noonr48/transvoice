# TransVoice — Current Status

**Canonical repo:** `noonr48/transvoice`  
**Status date:** 2026-08-19  
**Reference public baseline:** `29a6b6cb30209fc6e05006f80afc150215022e57`

This file is the short current-state entry point. `FEMINIZATION_V1_STATUS.md` remains the detailed historical implementation ledger and receipt archive.

## Product state

TransVoice is a research/development voice-feminisation training system. The deterministic FEM v1 control plane is substantially implemented and test-backed, while learner-facing FEM v1 activation remains disabled.

The next release-shaped milestone is **Pitch Shadow Alpha**: one comfortable-pitch motor-learning loop running end-to-end on real sessions without serving its FEM decision to the learner.

## Current foundations

- Deterministic FEM v1 controller and curriculum/metric eligibility gates.
- Reachable comfortable-pitch calibration/step policy; no universal production pitch target.
- Cue-served/acknowledged lifecycle and exact-next motor-trial contracts.
- Shared `fem-v1-runtime-turn` orchestration seam used by the common target-metric runtime in hard shadow.
- Atomic state transaction contract with session-scoped compare-and-swap and per-attempt idempotency.
- PTDB-TUG pitch-validation harness and preregistered release gates.
- Executable non-clinical pitch-alpha cue qualification contract.

## Open engineering/release work

1. **Pitch detector development gate — FAIL.** Latest public sync reports false-valid reduced from 0.405 to about 0.167, still above the preregistered <=0.05 gate. Continue development-split work only; held-out release speakers remain untouched for tuning.
2. **CI/runtime verification.** Permanent CI exists but the current candidate must be brought green at one exact SHA; failures are repaired rather than waived.
3. **Cue qualification integration.** The primary pitch cue has an executable non-clinical qualification path. Wire that qualification as authority for the narrow alpha without relabelling it as clinical approval.
4. **Controlled-vowel/formant validation — partial.** This is not on the critical path for the pitch-only alpha.
5. **Shadow pilot evidence.** Real-device/real-session proposed decisions need capture, replay and review before active alpha.
6. **Held-out pitch release evaluation.** Run once only after the detector version is frozen and development gates pass.

A missing specialist is **not** an engineering blocker. `CUE_QUALIFICATION.md` replaces the staffing-dependent pitch gate with deterministic, non-clinical evidence qualification. External specialist review is optional additional evidence and must never be fabricated.

## Pitch Shadow Alpha acceptance gates

- [x] Public repo instructions and permanent CI are canonical.
- [x] Shared FEM orchestrator is used by the common target-metric runtime in hard shadow.
- [x] Shadow execution is side-effect free, including attempt sequencing.
- [x] Duplicate/retried finalized attempts are idempotent and conflicting reuse fails closed.
- [x] Exact-next settlement uses the runtime-assigned canonical attempt ordinal, never caller-supplied ordinal authority.
- [x] Atomic/versioned active-state application boundary has a session-scoped concurrency contract; active coaching remains disabled.
- [x] Primary pitch cue has an executable non-clinical alpha qualification rubric; no specialist credential is claimed or required.
- [ ] CI is green at the exact candidate SHA.
- [ ] Pitch detector passes the preregistered development gate.
- [ ] Real-session shadow capture/replay is operational and reviewed.

Only after those gates: freeze the detector candidate, evaluate the held-out corpus once, and consider a tiny internal active pitch-only alpha if it passes.

## Validation truth

A high unit-test count is not a release claim. For each candidate record the exact SHA and distinguish structural/code review, relevant automated validation, real-human acoustic validation and real-human usability evidence. Missing human evidence stays unknown; it is not replaced with invented approval.
