# Cue Review Matrix — TransVoice FEM v1

**Status:** DRAFT — staged for owner approval. Per the product laws, no cue
may be served to a learner until a named reviewer approves it. This matrix
is the review surface: the narrow first-release set (GPT-Pro Arc 6), drawn
from the existing `cue-library-v3.js` with clinical-review fields.

**Reviewer:** _______________ **Date:** _______ **Qualifications:** _______________

---

## First-release cue set (5 cues)

### C1. Comfortable pitch elicitation — primary

| Field | Value |
|---|---|
| cueId | `pitch.register.small-glide-up.v1` |
| Skill / mastery stage | pitch / elicitation |
| Learner instruction | Start on an easy hum at your normal note, glide only a small step upward, then open into the first word without getting louder. |
| Intended acoustic effect | Median F0 moves upward a small, reachable step; loudness and effort stay steady |
| Protected metrics | safety.effort, phonation.pressedness, intensity.level |
| Contraindications | Any pain/strain report; effusive (pressed) phonation trending up |
| Stop conditions | Pain, throat pain, effort ≥ 4/5 sustained over 2 takes |
| Max reps per block | 6 |
| Rest guidance | 30s pause every 6 attempts; water freely |
| Fallback cue | C2 (hum into vowel) |
| Required demonstration | Approved human recording of the glide (NOT TTS — plan law) |
| Review checklist | ☐ wording safe ☐ no anatomy claim ☐ reachable step ☐ no forcing language ☐ fallback sound |

### C2. Easy onset / reset — hum into vowel

| Field | Value |
|---|---|
| cueId | `pitch.register.small-glide-down.v2` (matrix-specific wording — supersedes v1 instruction text; on approval, the library entry is updated to v2 wording or a new cueId is minted so the approved wording IS the served wording) |
| Skill / stage | pitch / elicitation (reset path) |
| Learner instruction | Start with an easy hum, glide a small step down, then open into the first word without adding weight or volume. |
| Intended effect | Registers a smaller, easier setting when the learner overshoots; recovery toward comfort |
| Protected metrics | safety.effort, phonation.pressedness, intensity.level |
| Contraindications | None beyond the global stop set |
| Stop conditions | Global stop set only |
| Max reps | 4 |
| Rest guidance | Standard |
| Fallback | End block; resume next session |
| Demo | Approved human recording |
| Review checklist | ☐ safe ☐ no anatomy ☐ comfort framing ☐ no "push down" language |

### C3. Controlled /i/ resonance contrast

| Field | Value |
|---|---|
| cueId | `resonance.front-vowel.ee-anchor.v1` |
| Skill / stage | resonance / elicitation |
| Learner instruction | Hold a comfortable "ee" on the same note you are already using. Keep the jaw easy and the lip spread small, then carry that vowel shape into "see me." |
| Intended effect | Controlled-vowel formant movement (brighter /i/ family) with pitch protected (max 1.0 ST drift) |
| Protected metrics | pitch.register (1.0 ST rule), safety.effort, phonation.pressedness |
| Contraindications | Pitch instability in the same session; no validated controlled-vowel evidence (detector gate — formants are research-only until the corpus gate passes) |
| Stop conditions | Global + pitch drift > 1.0 ST on 2 consecutive takes |
| Max reps | 6 |
| Rest | Standard |
| Fallback | Return to pitch practice |
| Demo | Approved human recording |
| Review checklist | ☐ safe ☐ no anatomy claim ("resonance" language stays acoustic) ☐ pitch protection stated ☐ word transfer honest |

### C4. Vowel-to-word transfer

| Field | Value |
|---|---|
| cueId | `articulation.vowel-isolate-transfer.v1` (narrowed to /i/) |
| Skill / stage | resonance / transfer |
| Learner instruction | Say the target vowel by itself, then put it in one word, then the same short phrase. Make the smallest mouth-shape change that moves the measurement. |
| Intended effect | Carries an elicited vowel feature into connected words without dragging the whole register |
| Protected metrics | pitch.register (1.0 ST), safety.effort |
| Contraindications | No prior verified controlled-vowel success in-session |
| Stop conditions | Global set |
| Max reps | 4 |
| Demo | Approved human recording |
| Review checklist | ☐ transfer framing honest ☐ no anatomy ☐ minimal-change language |

### C5. Same-phrase retention

| Field | Value |
|---|---|
| cueId | `transfer.same-sentence.v1` |
| Skill / stage | transfer / retention |
| Learner instruction | Keep the successful sound exactly as it was, but put it back into the full sentence. Do not add a new technique on this attempt. |
| Intended effect | Tests whether an elicited feature survives connected speech without new technique |
| Protected metrics | safety.effort |
| Contraindications | None beyond global |
| Stop conditions | Global |
| Max reps | 2 |
| Demo | None needed (uses the learner's own prior take) |
| Review checklist | ☐ no-new-technique framing ☐ honest retention test |

---

## Deliberately EXCLUDED from the first set

- All phonation/weight cues (research-only per the policy)
- All prosody cues (later curriculum extension)
- Any cue with "force", "squeeze", "hold the larynx", "whisper", or
  "push" language (banned outright — grep-verified absent from the five)

## Approval rule

A cue moves from `clinical-review-required` to `approved_internal` ONLY by
the named reviewer signing its checklist above. No environment variable,
agent action, or code path may manufacture approval. Human-recorded
demonstrations are required before any learner-facing use (TTS is not
acoustic authority — plan law).
