# Cue Vocabulary Spec — the coach's permitted language

Source of truth: `studio/research/mtf-voice-body-atlas-2026-07-27.md`.
Consumers: (a) the deterministic sanitizer law, (b) the cue/drill/card string
rewrite, (c) the v3 dataset generator's style gate.
Scope: male-to-female only.

---

## 1. THE CUE SHAPE (the rule the law enforces)

Every coaching instruction must contain **an action** and, where it makes a
claim about whether the learner did it, **a valid check**.

> **ACTION** = a body part + what it does (or an imitation task the body can
> just perform).
> **CHECK** = one of the seven valid signals in §3 — or nothing.

A cue **fails** if it names only a *quality of the sound* the learner is
supposed to produce ("brighter", "lighter", "more feminine", "warmer",
"rounder") with no body action. Those describe the destination, not the road.

**Passing examples**
- "Press the sides of your tongue against the inside of your upper back teeth
  and keep that contact through the whole sentence."
- "Draw your lip corners straight back so your lips are flat against your teeth."
- "Slide the tone up in one unbroken line without letting it get louder."
- "Palm flat on your breastbone — make the buzz weaker without getting quieter."

**Failing examples (and why)**
- "Use a brighter voice." — quality word, no action. *Brightness names four
  different configurations; the learner cannot act on it.*
- "Keep one feature stable: smaller brighter vowels." — two quality words.
- "Let the resonance move forward." — nothing moves; sound is not placed.
- "Feel the buzz in your cheekbones as the resonance improves." — invalid
  check: facial buzz tracks pitch, not tract shape.
- "Contract your cricothyroid to raise pitch." — unfeelable muscle; chasing the
  sensation is the strain pathway.

---

## 2. BANNED LEXICON (deterministic reject list)

Reject in coach-facing output. Internal metric/axis identifiers are exempt —
the law applies to rendered text, not variable names.

**Quality words with no body referent**
`bright` · `brighter` · `brightness` · `dark` · `darker` · `warm` (of tone) ·
`round` (of tone) · `rich` · `full`/`fuller` (of tone) · `light`/`lighter` when
used alone about the sound

**Placement fictions**
`forward placement` · `place the sound` · `the mask` · `masky` · `project into` ·
`resonate in your (face|nose|cheekbones|sinuses|head)` · `head voice` ·
`chest voice` · `head resonance`

**Vague throat/breath folklore**
`open throat` · `open your throat` · `support` (as an undefined instruction) ·
`sing/speak from the diaphragm` · `breathe into your belly` · `belly breathing`

**Community shorthand**
`big dog` · `small dog` · `vocal size` · `size` (as an axis name to the learner) ·
`twang` (use the anatomy) · `knodel` · `R1`/`R2` as learner-facing terms

**Muscle-introspection frames**
`feel your (cricothyroid|thyroarytenoid|vocal folds|larynx muscles) (contract|
tighten|work|engage)` · any instruction to feel an intrinsic laryngeal muscle
move

**Invalid-check frames**
Any instruction to judge **resonance** by felt vibration anywhere — chest,
sternum, face, nose, cheekbones, skull, "the mask". *(Felt chest vibration
remains legal when the claim is about **weight**; see §3 signal 3.)*

---

## 3. THE SEVEN VALID CHECKS (nothing else may verify a claim)

| # | Check | Legal to claim about | Illegal to claim about |
|---|---|---|---|
| 1 | Tongue sides against inner upper molars | Tongue-body position, resonance configuration | — |
| 2 | Where the fastest/coolest air is felt on the palate | Location of the narrowest point | — |
| 3 | Palm flat on the breastbone | **Vocal weight**, pressing, clean onset/offset | **Never resonance** |
| 4 | Fingertip on the voice box (whole cartilage) | Larynx **travel** during swallow/yawn; that voicing buzzes there | Absolute larynx height |
| 5 | Two fingertips in the soft triangle under the chin | Suprahyoid load — must stay soft while speaking | — |
| 6 | Fingertip beside the nose; nostril pinch/release | Velopharyngeal port open/closed | Resonance generally |
| 7 | Effort level and sound texture | Weight (easy vs push), pressing (harsh buzz vs rumble) | — |
| 8 | **Temperature** — where the airstream feels coolest and fastest on the palate | Where the tract's narrowest point is | Resonance shaping |
| 9 | **The half-volume test** — ask for the same sound quieter | Whether the pitch came from the larynx or from pushing air. *"Height that survives quiet was real."* Pressure-made pitch drops with the volume; laryngeal pitch holds | Pitch — **never** resonance |

**8 and 9 added 2026-07-27** from the failure-points dossier
(`/home/USER — an independent research
lane that reached the same cue-validity conclusions from clinical literature plus
~3,961 community posts. Its `coach response principle` field is script-verified
free of jargon and homework framing, so its phrasings are directly usable here.
Check 9 is the coaching counterpart to the pitch/pressure scoring defect: it is
pedagogy, not measurement — do not derive analyzer thresholds from it.

## 3a. WHERE THE CUE-SHAPE RULE MUST *NOT* APPLY

*(Added 2026-07-27 from the failure-points dossier — a limit this spec originally
missed.)*

Some things a learner gets stuck on are **not technique problems and have no
physical answer.** Forcing a body-part instruction onto them is worse than
saying nothing, because it answers a question they did not ask.

- **"If it takes effort it isn't really me."** An identity objection. No cue
  addresses it. Answer the objection.
- **The voice dies around people who knew you before.** The most-reported social
  block in the community corpus. The body is demonstrably capable — the setting
  is the problem.
- **Flawless as a character, unavailable as yourself.** Proves anatomy is not the
  limit, which is exactly why a tongue-position cue insults the difficulty.
- **Fear of sounding ridiculous mid-attempt.** Take the pressure off the sound;
  ask for something too small to be embarrassing.
- **Expecting hormones to have done it.** Say plainly that this is learned, not
  given, then offer one doable thing.

The deterministic cue-shape rule (§1) must therefore be scoped to **coaching
instructions**, not to every coach sentence. A reply that answers an objection,
acknowledges a feeling, or declines to prescribe is compliant with no body
referent at all. A rule that demanded one everywhere would force the coach to be
obtuse at precisely the moments that matter most.

**Gross landmarks only.** Never instruct a search for the cricothyroid gap or
other fine landmarks: identification accuracy on feminine necks is ~19% versus
~69% on masculine ones, because the cartilage angle is flatter.

---

## 4. APPROVED PHRASING BY AXIS

### Resonance (mouth and throat shaping) — the highest-leverage axis
- "Tip of your tongue resting behind your lower front teeth."
- "Lift the middle of your tongue toward the roof of your mouth, about a
  finger-width behind the ridge."
- "Press the sides of your tongue out against your upper back teeth — a band of
  contact from the last molar forward."
- "Find the fastest, coolest air on the ridge just behind your top teeth."
- "Draw your lip corners straight back, lips flat against your teeth."
- "Keep the corners from pushing forward — that adds length."
- *Correction of a common error:* "Move the body of your tongue forward, not the
  root — don't push from the back of your throat."
- *Never:* opening/widening the throat, or squeezing it. Both are wrong
  directions here.

### Pitch
- "Slide the tone up in one unbroken line — don't let it get louder."
- "Let the voice box ride up with the tone instead of holding it down."
- "Hold the last word a touch longer on one note; next time let that note sit a
  hair higher."
- *Never:* "push higher", "reach for it", or any instruction that raises effort.

### Vocal weight
- "Palm flat on your breastbone. The buzz should arrive the moment voice starts
  and stop the moment it ends."
- "Make that buzz weaker without getting quieter."
- "If the buzz turns hard and rattly, you're pushing air — ease off."
- "Hold an 'mmm', then open into a vowel without changing effort."
- "Start the vowel so gently there's no click and no puff of air before it."
- *Never:* add breath to sound lighter.

### Nasality (detect and control; not a lever)
- "Fingertip on the side of your nose — you shouldn't feel a buzz on this vowel."
- "Pinch your nostrils shut mid-vowel. If the sound changes, air was going up
  your nose."
- "Start a yawn with your mouth closed — the back roof of your mouth lifts."

### Posture and placement
- "Nod your chin down about a centimetre at the joint just under your skull,
  keeping your neck long." *(Not a full chin tuck — that narrows the airway.)*
- "Teeth a fingertip apart; slide your lower jaw slowly left, then right."
- "Two fingers in the soft triangle under your chin — it should stay soft while
  you speak."
- "One palm on your lower side ribs: it should rotate outward as you breathe in,
  not lift straight up."

### Connected speech (carryover — the documented hard part)
- "Keep the tongue contact and the flat lip corners the same the whole way
  through; only the words change."
- "Notice the contact break on 'ah' and on 'l' — that's where it slips."
- "That 'r' pulls your tongue back and hollows out underneath. Get in and out of
  it quickly."

### Strain and stopping
- "Stop if your throat burns or aches."
- "If you need more air pressure than a minute ago for the same loudness, stop."
- "If it's getting worse the longer you go rather than better, stop."
- "Correct usually feels like almost nothing. Feeling a lot means doing too
  much."

---

## 5. FORBIDDEN PRACTICES (the coach may never suggest these)

Deterministic reject, same shape as the shipped no-homework and no-equipment
laws:

- **Falsetto-based pitch work** — thin, artificial, and significantly reduces
  range.
- **Whisper drills, whisper sirens, any audible whispering as technique** —
  requires false-fold constriction that learners carry into voiced speech.
- **Swallow-and-hold; "push the larynx as high as possible"** — recruits
  swallowing muscles irrelevant to speech; tension-dysphonia risk.
- **Deliberate breathiness to sound lighter** — masks weight instead of reducing
  it and trains a dead end.
- **Pitch-only strategy** — predictably insufficient, not merely suboptimal.
- **Yawn-sigh as a habitual speaking posture** — legal as a *release* tool only;
  it lowers the larynx and moves resonance the wrong way.
- Anything requiring equipment (already enforced) or assigned for later
  (already enforced).

---

## 6. NOTES FOR THE IMPLEMENTER

- The law applies to **rendered coach text**, not to internal axis names.
  `resonance`, `weight`, `brightness` as metric identifiers are fine; the words
  must not reach the learner.
- Metaphor ruling already pinned in the shipped law pass: a simile without an
  acquisition verb passes at runtime. Keep that carve-out consistent.
- Cue-shape checking should be structural (does the string contain a body
  referent from a known vocabulary?) rather than a second banned-word list —
  otherwise it will fail open on new phrasings.
- Existing violations to rewrite: 20 learner-facing strings, concentrated in
  `backend/voice-drills.js` and `backend/voice-cue-sheet.js`. Exact line
  references are in the project memory record `transvoice:mtf-research-artifacts`.

---

## 7. BEGINNER-LANGUAGE LAWS (2026-07-28)

The learner is a total beginner with zero vocal training; every spoken word
must be self-explanatory, concrete, and actionable. Trigger: the owner heard
"display line. let the jaw drop down slowly" and could not parse it.

- **Define before use.** A technical term is never spoken raw. If a term must
  be used at all, it is glossed immediately in one short plain clause. The
  canonical plain forms: pitch floor → "how low your voice dips"; intonation /
  prosody → "the melody of the sentence"; vocal weight → "how heavy or rumbly
  the sound is"; resonance → "how the shape of your mouth changes the sound".
- **No "the line" / "displayed line" / "the card".** The practice sentence is
  quoted verbatim or called "the practice sentence" / "the sentence you're
  practicing" — never a UI object. This must work in EyesFree, where the
  learner has no screen in reach.
- **Cue shape: ONE physical action + a self-check.** Every cue pairs one body
  action with how to tell it worked ("you'll know it's right when…"). One
  correction per reply, never two. Effort is the enemy: "if your neck feels
  tense you're trying too hard — do it lazier."
- **Axis-noun ruling (decided 2026-07-28).** Bare `resonance` / `vocal weight`
  are BANNED in spoken coach output, glossed or not — deterministic
  gloss-detection is too fragile to police "glossed in the same sentence", so
  the sentence law (`BEGINNER_JARGON_RULES`) drops the sentence (or substitutes
  the code-owned plain cue). The gloss lives in code-owned copy
  (`cueForDueReview`, the renderer prompt's plain-name rule) where it can be
  guaranteed. Scope is model output only: code-owned surfaces (drill titles,
  cue-sheet tokens, model-facing prompt notes) may still name an axis as a
  content word where surrounding UI gives it context. Jargon with a safe plain
  swap ("displayed line", "pitch floor", "intonation", "prosody") is instead
  rewritten word-level by `BANNED_VOCAB_RULES`, preserving the sentence.
- **Placement-hole closure.** `placement_fiction` no longer requires the word
  "forward" or an explicit sound noun: a modifier + placement ("balanced
  placement", "neutral placement", "same placement") or placement + a state
  verb ("the placement stays put") fires the same law.
- **APP_SURFACE_PATTERN** no longer lists `displayed`, so the cue-shape law's
  app-surface exemption cannot shield "displayed line".
- Known violations rewritten in this wave: every "displayed line" canned string
  in `coaching/sanitizer.js`; the cueForDueReview axis cues (now glossed);
  `SECTION_LOOP_CAP_EXIT` and two "fragment" SECTION_CUES in
  `coaching/section-loop.js`; the v1 coachMove successCriteria in
  `coaching/signal-builder.js` ("More forward resonance placement.", "Brighter
  spectral balance.", "The placement stays put…", "pitch floor"/"target band"
  phrasing); WEAK_SECTION_PHRASES sound-travel register in
  `coaching/renderer-client.js`; the graph/dot/lane/hot-pink visualization
  vocabulary, "Shadow" as a bare verb, unglossed "onset", "balanced/neutral
  placement", "Redo the capture", and "target zone/band" successCriteria in
  `backend/voice-drills.js`; "the same placement your voice will use" in
  `lessons/lesson-planner.js`.
