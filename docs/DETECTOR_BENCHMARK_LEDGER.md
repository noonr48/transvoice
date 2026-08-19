# Detector Benchmark Ledger

This is the canonical index of detector-validation runs that are safe to cite as product evidence. It does not replace raw reports or `ACOUSTIC_VALIDATION_PLAN.md`.

## Rules

Every new canonical row must record: detector identity/code SHA, corpus and split, harness/metric definition, gate version, measured values, verdict, and whether the run was used for tuning. Missing values stay **unknown** rather than being reconstructed from memory.

The PTDB-TUG held-out release speakers must not be used for detector tuning. A held-out run is not made merely to see how development is going.

## Pitch / F0

| ID | Detector / code provenance | Corpus split | false-valid | octave | gross | missed-voiced | Gate | Verdict | Notes |
|---|---|---|---:|---:|---:|---:|---|---|---|
| pitch-dev-000 | production `_estimate_pitch`, pre-voicing-hardening public result | PTDB-TUG dev sample F01-F05 + M01-M05, 20 utterances | 0.405 | 0.031 | 0.149 | 0.012 | preregistered v1 | **FAIL** | First real-human validation; see `PITCH_VALIDATION_FIRST_RESULTS.md`. |
| pitch-dev-001 | detector round 1 included in public baseline `29a6b6cb...` | PTDB-TUG development half | ~0.167 | unknown | unknown | unknown | preregistered v1 + Amendment 1 | **FAIL** | Latest public sync claim. Improvement is material but false-valid remains >0.05. Do not infer unreported metrics. |
| pitch-heldout-release | **not frozen** | PTDB-TUG held-out | — | — | — | — | preregistered v1 + applicable pre-run amendments | **UNEVALUATED** | Do not run for tuning. |

### Release-critical gate

The current preregistered held-out false-valid gate remains **<= 0.05**. A development result around 0.167 is not close enough to promote the detector, regardless of unit tests.

## Formants / controlled vowel

No release-eligible real-human expert-corrected formant benchmark is recorded yet. The controlled-vowel contract therefore remains research/shadow evidence only where the detector authority says so.

## Adding a result

Attach or link the machine-readable/raw report where possible and record:

```yaml
benchmark_id: ...
detector_id: ...
code_sha: ...
corpus: ...
split: development|heldout
speaker_set: ...
harness_version_or_sha: ...
metric_definition: ...
gate_version: ...
used_for_tuning: true|false
metrics: {}
verdict: PASS|FAIL|UNEVALUATED
run_at: ...
```

If any gate definition changes, first add the dated pre-run amendment to `ACOUSTIC_VALIDATION_PLAN.md`; never edit a gate after seeing the run it judges.
