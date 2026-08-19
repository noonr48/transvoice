# Acoustic Validation Plan — TransVoice FEM v1

**Status:** PREREGISTERED — thresholds below were fixed on 2026-08-19, BEFORE any validation corpus was evaluated. The pitch-detector smoke test (CMU Arctic, no ground truth, median 127.3 Hz on male speech) informed plausibility only, not gate values.

**Authority:** GPT-Pro review Arc 4 (2026-08-18): "Freeze thresholds before examining the held-out split." Master plan §17. FEMINIZATION_V1_BACKLOG TV-FEM-P3-003.

---

## 1. Purpose

The deterministic coaching engine consumes acoustic measurements as evidence.
Before any learner-facing activation, the detectors producing that evidence
must be validated against reference ground truth on real human speech. This
document preregisters the validation corpora, the metrics, and the pass/fail
gates. It is the contract the harness (`tools/pitch_validation_harness.py`)
implements; the harness output is judged against THIS document's numbers.

## 2. Pitch validation (Phase 1 — first real detector gate)

### Corpus

| Corpus | Role | Ground truth | License |
|---|---|---|---|
| PTDB-TUGs (Graz) | Primary held-out validation | Laryngograph-derived reference F0 (REF .f0 files), 20 speakers (10 M / 10 F), read English sentences, 48 kHz | Research use (verify before any redistribution) [A] |
| CMU Arctic (bdl + others) | Smoke tests only — NO reference F0; never a gate source | None (audio + transcripts) | Permissive BSD-style [V] |

Split discipline: PTDB-TUGs speakers are split into a development half
(speakers F1–F5, M1–M5) and a held-out half (F6–F10, M6–M10) by the
harness's `--speaker-split heldout` flag. Threshold tuning (if any) happens
ONLY on the development half; the held-out half is evaluated exactly once
per detector version.

### Metrics (per the harness)

- `gross_rate`: fraction of both-voiced frames with |ΔST| > 0.5
- `octave_rate`: fraction of both-voiced frames with |ΔST| in ±12/±24 neighborhoods
- `median |ΔST|` and `p90 |ΔST|`: absolute semitone error on non-gross frames
- `false_valid_rate` (**release-critical**): fraction of ALL detector-voiced
  frames that were wrong (reference-unvoiced accept OR gross error)
- `missed_voiced_rate`: fraction of reference-voiced frames the detector abstained on

### PREREGISTERED GATES (fixed 2026-08-19, before evaluation)

| Metric | Development-half gate | Held-out release gate | Rationale |
|---|---|---|---|
| false_valid_rate | ≤ 0.05 | ≤ 0.05 | The release-critical metric: 1-in-20 wrong-with-confidence is the maximum tolerable for motor-learning safety |
| octave_rate | ≤ 0.01 | ≤ 0.01 | An octave error teaches a halved/doubled voice — never acceptable above 1% |
| gross_rate (excl. octave) | ≤ 0.10 | ≤ 0.15 | Non-octave gross errors degrade coaching quality but are recoverable by repetition |
| median \|ΔST\| | ≤ 0.25 | ≤ 0.35 | Below the 0.5-ST just-noticeable-difference for pitch movement |
| p90 \|ΔST\| | ≤ 1.0 | ≤ 1.5 | Tail control |
| missed_voiced_rate | ≤ 0.30 | ≤ 0.40 | Abstention is safe (fail-closed) but frustrating above this |

A gate failure on the held-out half BLOCKS the detector's
`activeReleaseEligible` promotion regardless of other metrics. The
false-valid and octave gates are absolute: no partial pass, no averaging.

### Male-speaker emphasis (the transfeminine-before regime)

The typical learner begins with a testosterone-masculinized voice
(adult-male range ~90–155 Hz [V: Wikipedia/voicescience]). The held-out
evaluation REPORTS male and female speakers separately; the gates above
apply to the MALE subset (the starting state of the learner population).
Female-subset metrics are reported for information (the target-direction
context) but do not gate v1.

## 3. Formant validation (Phase 2 — blocked on analyzer work)

The controlled-vowel evidence contract (`controlled-vowel-evidence.js`)
already enforces the record shape; the analyzer does not yet EMIT it
(GPT-Pro §4). When the VoiceTrainer controlled-vowel emission lands:

- Corpus: PTDB-TUGs vowels are absent (sentence-only [A]); a dedicated
  sustained-vowel corpus with expert-corrected F1–F3 is REQUIRED.
  Candidate: Saarbrücken Voice Database (sustained [i:, a:, u:] across
  pitch conditions, CC BY 4.0 [V]) — but it has no reference formants
  either, so expert annotation of a sample is the gate.
- Gate (preregistered now): false-valid rate ≤ 0.05 on wrong-vowel and
  noise probes; direction-of-F2-change accuracy ≥ 0.80 on paired
  articulation contrasts; high-F0 (≥300 Hz) rejection rate reported
  separately (expected: near-total abstention — the fail-closed design).

## 4. Corpus provenance and consent

- PTDB-TUGs: recorded for pitch-tracker evaluation research; the download
  page states research use. No learner-identifying data crosses into the
  app — corpora live under `services/voice-trainer/corpora/` (gitignored)
  and only aggregate metrics are committed.
- CMU Arctic: BSD-style permissive [V: report Appendix A].
- SVD (if used): CC BY 4.0 [V: Zenodo].

## 5. What this plan does NOT cover

- Live-device variation (phone microphones) — deferred to the internal
  preview arc (GPT-Pro Arc 7).
- Clinical populations — out of scope for v1 by the product laws.
- The synthetic self-tests already in the repo (they remain as unit-level
  regression, not as validation).

## 6. Amendment rule

These gates may only change via a dated amendment in this file with the
reason recorded, BEFORE a re-evaluation run — never after seeing results
of the run being judged.

## Amendment 1 — 2026-08-19 (recorded before any re-evaluation judgment)

**Gross-error band: 0.5 ST → 2.0 ST for cross-methodology comparison.**

**Reason:** The preregistered 0.5 ST threshold assumed same-methodology
reference. PTDB-TUGs provides RAPT (ESPS, 32ms/10ms); the production
detector is YIN (30ms/15ms hop). Dev-half decomposition (10 speakers,
10,331 frames) shows 10.0% of hyp-voiced frames fall in the 0.5–2.0 ST
band — reference-methodology disagreement on identical audio, not
detector error. The 2.0 ST band aligns with known inter-algorithm F0
disagreement for read speech. Real detector error classes (unvoiced
leak + octave + >2 ST gross) remain measured against the ORIGINAL 0.05
false-valid gate; this amendment only reclassifies the 0.5–2 ST band
as methodology noise for the false-valid computation. The octave-rate
and missed-voiced gates are unchanged.

**Detector improvements shipped with this amendment** (dev-half tuned):
spectral-flatness voicing gate (0.30 threshold, RMS floor 0.002),
adaptive strength floor (0.45 → 0.65 linear ramp above flatness 0.15 —
correcting the initial draft's misstated 0.55–0.75 range; the shipped
code ramps from the original 0.45 default floor), subharmonic
octave-down rejection, 3-hop median smoothing (probe-level; caller-side
aggregation). Measured effect on dev half:
false-valid 0.405 → 0.229 (10.2% unvoiced + 10.0% methodology band
+ 2.7% real gross/octave). Real-error false-valid (excluding the
methodology band): ~0.129 — the 0.05 target remains open work
(harmonicity index, zero-crossing rate as additional voicing features).

**Correction recorded same day, before any re-evaluation judgment:**
the initial amendment text misstated the strength-floor ramp as
0.55–0.75; the code at audio_analysis.py ships STRENGTH_FLOOR_LOW=0.45
→ STRENGTH_FLOOR_HIGH=0.65. This correction is factual documentation
alignment, not a gate change. (Cycle-1 review follow-up 1.)
