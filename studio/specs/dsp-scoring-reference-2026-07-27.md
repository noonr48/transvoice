# DSP scoring reference — the authoritative bands

Extracted live from `services/voice-trainer/src/services/audio_analysis.py`
`TARGET_PROFILES` on 2026-07-27 by instantiating the module (not by reading the
source), via `services/voice-trainer/.venv/bin/python`.

**Why this file exists.** `VOICE_STUDENT_MODEL_PRESETS` in
`backend/voice-session-state.js` is a *hand-copied mirror* of this table. That is
the same convention-held-mirror pattern that produced nine leak sites during the
MTF-only removal, and it has already yielded three scoring defects found only by
accident. This is the reference the JS side must be audited against — and,
ideally, derived from at test time so the two cannot silently diverge.

## The 7 live target profiles

| preset | direction | pitch floor | pitch ceiling | max weight mean |
|---|---|---:|---:|---:|
| cute-feminine | feminine | 188.0 | 255.0 | 0.40 |
| everyday-feminine | feminine | 168.0 | 235.0 | 0.46 |
| bright-playful | feminine | 198.0 | 275.0 | 0.38 |
| australian-bright-feminine | feminine | 178.0 | 255.0 | 0.42 |
| soft-feminine | feminine | 175.0 | 255.0 | 0.44 |
| androgynous | neutral | 150.0 | 178.0 | 0.45 |
| gender-neutral | neutral | 152.0 | 172.0 | 0.45 |

`resonance_floor` / `resonance_ceiling` / `weight_floor` / `weight_ceiling` are
`None` on every profile — they are derived downstream, not declared here. Any JS
band claiming to mirror them is mirroring a derivation, not a value; that
distinction is where defect (c) below came from.

Retired: no `masc*` profile remains (MTF-only pivot). `min_resonance_mean` runs
0.20–0.38 across the feminine set and 0.28 for both neutral profiles.

## Cross-check against the published clinical targets

From `studio/research/mtf-voice-body-atlas-2026-07-27.md` §6: feminine-read is
**>180 Hz**, the ambiguous zone where resonance decides is **145–165 Hz**, and
the typical post-therapy plateau is **145–155 Hz**.

- The feminine floors (168–198) straddle the 180 Hz perceptual line;
  `everyday-feminine` at 168 sits *below* it, which is defensible as a
  working-toward band but is worth an explicit decision rather than an accident.
- Both neutral bands (150–178, 152–172) sit squarely in the published ambiguous
  zone — correct by design.
- Nothing in the table targets the 145–155 plateau, which is where the
  literature says most learners actually stall. Worth a deliberate look when the
  scoring audit runs.

## Known defects in the JS mirror (3 found incidentally, not by audit)

a. **Neutral learners scored against a feminine floor.** `androgynous` and
   `gender-neutral` were absent from `VOICE_STUDENT_MODEL_PRESETS`, so they fell
   through to `cute-feminine`'s ~195 Hz floor. *Fixed* — now 157 / 159.
b. **`soft-feminine` missing from the same table**, so it inherits
   `cute-feminine`'s floor (~195) when the DSP says **175.0**. A learner on this
   preset is judged ~20 Hz too high. *In the current repair round.*
c. **`maxWeightMean` used as a ceiling for feminine rows but as a band CENTRE
   for neutral** (`backend/voice-student-evaluations.js:246-249`), so the +0.16
   leniency offset *shifts* the neutral band (47–75%) instead of widening it — a
   neutral learner sitting exactly on the DSP target of 0.45 is scored
   **incorrect**. *In the current repair round.*

Three defects, all in one small table, none found by a test. That is the case
for deriving rather than copying.

## MEASURED COMPARISON — JS scoring table vs this reference (2026-07-27)

`VOICE_STUDENT_MODEL_PRESETS` in `backend/voice-session-state.js:74` is a
hand-maintained mirror that applies a **deliberate leniency offset** to each DSP
value, so the learner is not failed for sitting exactly on the analyser's floor.

| preset | DSP floor | JS minPitchHz | offset | DSP maxWeight | JS maxWeightMean | offset |
|---|---:|---:|---:|---:|---:|---:|
| cute-feminine | 188 | 195 | +7 | 0.40 | 0.60 | +0.20 |
| everyday-feminine | 168 | 182 | **+14** | 0.46 | 0.64 | +0.18 |
| bright-playful | 198 | 205 | +7 | 0.38 | 0.56 | +0.18 |
| australian-bright-feminine | 178 | 190 | **+12** | 0.42 | 0.58 | +0.16 |
| soft-feminine | 175 | 182 | +7 | 0.44 | 0.60 | +0.16 |
| androgynous | 150 | 157 | +7 | 0.45 | 0.45 | **+0** |
| gender-neutral | 152 | 159 | +7 | 0.45 | 0.45 | **+0** |

**The offsets vary, and the code says so** — the source documents
`minPitchHz = pitch_floor + 7 (family range +7..+14)` and flags the neutral
`maxWeightMean` as a deliberate exception ("read this before 'fixing' it back"),
because for neutral it is used as a band *centre* rather than a ceiling, so
adding the family offset would shift the band instead of widening it. **Both
comments check out against the values.** This is careful work, not drift.

### The one real gap: nothing *enforces* the relationship

Every number above is a hand-copy. If the analyser changes a floor, the JS row
keeps the old value silently and a learner is scored against a target that no
longer exists. That is the same mirror-drift class that let the UI keep offering
a preset the analyser had already dropped, and it has already produced three
scoring defects found only by accident (neutral presets on a feminine floor;
soft-feminine on the wrong floor; the neutral weight band offset rather than
widened).

**Deliverable:** a parity test that reads `TARGET_PROFILES` from
`audio_analysis.py` at test time and asserts each JS row sits within its
documented offset band — `+7..+14` on pitch, `+0.16..+0.20` on weight for the
feminine rows, and exactly `+0` on weight for the neutral rows. That converts a
convention into something a DSP change cannot silently break, exactly as
`frontend/src/voice/preset-parity.test.ts` now does for the preset *id list*.

## What the audit should deliver

1. A parity assertion (or derivation) so every JS band traces to this table —
   the same treatment `frontend/src/voice/preset-parity.test.ts` now applies to
   the preset *id list*, extended to the *values*.
2. An explicit decision on the two clinical questions above (the 168 Hz floor
   below the perceptual line; nothing covering the 145–155 plateau).
3. Confirmation that feminine bands are byte-identical before/after any change —
   the neutral fixes must not move the feminine path.
