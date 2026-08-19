# First Real-Data Validation Results — Pitch Detector

**Date:** 2026-08-19 · **Corpus:** PTDB-TUGs (dev-half sample: F01-F05 + M01-M05, 20 utterances, 10,213 frames) · **Reference:** RAPT pitch tracks (the corpus's designed ground truth) · **Detector:** production `_estimate_pitch` (YIN, 80-400Hz, 0.45 strength floor, 30ms window @ 15ms hop)

## Results vs preregistered gates (ACOUSTIC_VALIDATION_PLAN.md)

| Metric | Measured | Gate | Verdict |
|---|---|---|---|
| false_valid_rate | **0.405** | ≤ 0.05 | **FAIL (8×)** |
| octave_rate | **0.031** | ≤ 0.01 | **FAIL (3×)** |
| gross_rate | 0.149 | ≤ 0.10 | FAIL (1.5×) |
| missed_voiced_rate | **0.012** | ≤ 0.30 | PASS |

## Root mechanism

The detector reports voiced on 3,342 of 10,213 frames; the RAPT reference
confirms 2,367. The 98.8% catch rate on truly-voiced frames (missed rate
1.2%) proves alignment and voiced-frame accuracy are sound. The failure is
**over-triggering on unvoiced speech**: YIN's cumulative-mean-normalized
difference dips below the 0.45 threshold on periodic-looking unvoiced
segments (voiced fricatives, aspiration, silence tails), and the production
detector has no independent voicing decision — it returns pitch whenever
strength clears the floor. ~1,000 false accepts per 20 sentences.

The 3.1% octave rate compounds this: when the detector does fire on marginal
segments, it sometimes locks onto the wrong harmonic.

## What this means

- The preregistered gates held: the detector is **not release-eligible**
  for active coaching on this evidence (consistent with the
  detector-validation registry's `activeReleaseEligible: false`).
- The production app is unaffected today: the runtime is shadow-only, and
  no cue is approved — no learner-facing path consumes this detector's
  output yet. The fail-closed design did its job.
- This is the first real-human-speech validation in the project's history.
  The corpus, harness, and preregistration discipline all functioned.

## Identified fix directions (for the detector-improvement arc)

1. **Independent voicing decision**: separate "is this frame voiced?" from
   "what is the pitch?" — energy threshold + spectral flatness + strength
   floor combination, tuned on the dev half.
2. **Harmonic-consistency check**: reject candidates whose sub-harmonic
   also shows strong periodicity (octave disambiguation).
3. **Median filtering over the hop window**: single-frame outliers drive
   much of the false-valid count.

These are detector improvements, not gate changes: the gates stay frozen.

## Provenance

- Corpus: PTDB-TUGs (Graz), downloaded from
  https://www2.spsc.tugraz.at/databases/PTDB-TUG/ (research use)
- Reference format verified against the official PTDB-TUG report PDF
  (4-column .f0: pitch Hz | voicing prob | RMSE | peak NCCF)
- Harness: `tools/pitch_validation_harness.py` (calls the production
  `_estimate_pitch` directly; corpus-agnostic)
- Raw report: `/home/USER
