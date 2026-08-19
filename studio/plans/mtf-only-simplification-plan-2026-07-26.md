# MTF-only simplification — scope + removal plan

Date: 2026-07-26 · Status: PLAN ONLY (execution gated on user go)
Decision it serves: `mtf-only-scope-pivot` — user verbatim: *"i am beiginning to
realise i don't care about fealme to male as that has proven to overcomplicate
literally everything"*.

## The load-bearing distinction (verified, not assumed)

`direction` in this codebase means **gender/practice direction**
(`feminizing` | `masculinizing` | `neutral`), derived from the target preset —
it is NOT the correction direction (raise/lower relative to band). Verified at
`backend/coaching/signal-builder.js:96-120` (`TARGET_PRESET_DIRECTION_HINTS`
block) and `backend/voice-target-identity.js:34-40`
(`canonicalizeDirection` maps `mtf|feminizing → feminine`,
`ftm|masculinizing → masculine`).

Consequence: removing the masculine direction does **not** touch the
above-band/below-band correction logic. Those are separate axes. This is the
single most important fact in this plan — conflating them would break feminine
coaching.

## What actually costs complexity: INVERSION, not the third option

The expensive property is that a masculinizing target **inverts every band, cue
polarity, and forbidden list** (`signal-builder.js:1273-1275`:
*"A masculine (or any darker/heavier) target inverts the feminine default"*).
Every cue, gate, and preset therefore needs a mirrored twin and a
direction-safety check to stop a wrong-way instruction.

The `androgynous` / `gender-neutral` presets do **not** invert. The code
deliberately assigns them **no** direction hint (`signal-builder.js:112-114`:
*"'neutral' is not a direction to move in, and claiming one would risk a
wrong-direction cue"*) — they simply omit the Direction line.

**Therefore: remove `masculinizing`; KEEP `neutral`/`androgynous`.**
The user's words dropped FTM specifically and never mentioned neutral, and
neutral is not a source of the complexity he described. Neutral costs an omitted
line; masculine costs a mirrored universe.

## Measured surface

| Surface | Count | Source |
|---|---|---|
| Non-test backend files referencing masculine/FTM | 20 | `grep -rIl` over `backend/`, tests excluded |
| Densest files | `voice-cue-sheet.js` 19 · `signal-builder.js` 11 · `voice-drills.js` 8 · `voice-cockpit-lines.js` 6 · `practice-cards.js` 6 · `sanitizer.js` 6 | per-file `grep -c` |
| Eval fixture surface | `eval/fixtures/ood-learners.js` 23 | same |
| Neutral/androgynous surface (retained) | 6 files, ≤6 hits each | `grep -c androgynous\|gender-neutral` |

## Removal order (dependency-ordered; each step reviewer-gated)

1. **Choke point first** — `backend/voice-target-identity.js:34-40`:
   `canonicalizeDirection` stops resolving `ftm`/`masculinizing`/`masculine`.
   Decide fail mode: reject with `missing_target_direction` (fail-closed, matches
   the house "fail silent rather than substitute" law) vs silently coerce
   (rejected — substitution is banned).
2. **Preset registry** — drop `masc-deep`/`masc-natural`/`masc-warm`/`masc-bright`
   from `voice-cue-sheet.js` PRESET_PROFILES and the DSP's `TARGET_PROFILES`
   (`services/voice-trainer/src/services/audio_analysis.py`). These two lists are
   documented as mirrors (`sanitizer.js:787-788`) — they must stay in sync or the
   direction filter silently changes behavior.
3. **Sanitizer direction filter** — `backend/coaching/sanitizer.js:787-799`:
   the `masculinizing` branch and the `s.includes('masc')` preset fallback become
   dead; collapse the filter to feminizing-or-skip. Keep the identity-word regex
   at `sanitizer.js:47` unchanged — it bans gendered nouns in coach speech and is
   unrelated to target direction.
4. **Signal builder inversion** — `signal-builder.js:1273-1275` and the darker/
   fuller inversion paths; remove the mirrored branch, keep the feminine path as
   the only path.
5. **Cue/drill banks** — remove masculine-mirror entries in `voice-drills.js`
   (e.g. L309 *"Open the back of the mouth and throat space for a darker, fuller
   resonance."*), `voice-cue-sheet.js`, `voice-cockpit-lines.js`,
   `practice-cards.js`.
6. **Eval fixtures + gates** — `eval/fixtures/ood-learners.js` (23 hits),
   `eval/lib/engine-b-gates.js`, `eval/lib/judge.js`: retire masculine learner
   fixtures. **Do not delete the direction-parity tests blindly** — re-point them
   at feminizing-vs-neutral so wrong-direction protection stays covered.
7. **Dataset generator** — retire the 60/40 MTF/FTM allocation, FTM target
   presets, masc-side forbidden lists and bidirectional direction-gates in
   `sloane-ui/backend/voice-tutor-v2/` (`cue-families.js`,
   `target-presets-v2.js`, `style-compliance-v2.js`, `direction-gate.test.js`).
   Lands naturally inside the v3 regeneration rather than as a separate pass.

## Risks

- **R1 — the parity tests are load-bearing.** `voice-direction-parity.test.js`
  and `sanitizer-direction.test.js` exist to prove a cue never pushes the wrong
  way. Deleting them with the masculine path removes the guard that also protects
  the feminine path from a polarity regression. Mitigation: re-point, don't
  delete (step 6).
- **R2 — engine/DSP drift.** The preset lists in the Node cue sheet and the
  Python analyzer are mirrors by convention, not by a shared source. Removing
  from one only would change direction-filter behavior silently. Mitigation:
  step 2 touches both, and a mirror-consistency assertion is added.
- **R3 — stored learner state.** Existing sessions/profiles may carry
  `direction: 'masculine'`. A fail-closed canonicalizer turns those into an error
  state. Mitigation: decide the migration (reject-with-message vs one-time
  profile scrub) BEFORE step 1 ships.
- **R4 — scope creep into neutral.** Neutral is retained by this plan. Any change
  that also drops androgynous presets is out of scope and needs the user.

## Not decided here (needs the user)

- Whether existing masculine-target learner profiles are migrated or rejected (R3).
- Whether `androgynous`/`gender-neutral` presets stay long-term (this plan keeps
  them; the user's words did not cover them).
