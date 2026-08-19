# TransVoice — Research-to-Product Improvements

**Source:** Research session 2026-07-27 (MtF voice-feminization biomechanics + sound-as-tool pedagogy)
**Audience:** Engineer/agent working on the TransVoice application
**Status:** Recommendations ready for productization; this document is the bridge from research → app content

---

## TL;DR — what changed in this research round

Three big things were added to the knowledge base that the app should reflect:

1. **A locked language rule** (already in memory as entry `a62f3cf7`): no Latin/Greek anatomy, no acoustic jargon, no branded technique names in any learner-facing surface. Plain English body parts + felt sensation only. The existing coaching model output likely violates this and needs a sanitizer pass.

2. **A new pedagogical framework: sound-as-tool** (memory entries `eade17e3`, `9810932e`, `37e05934`, `b25c56ab`): individual sounds (/s/, /i/, /m/, lip trill, siren, etc.) can be used as **backdoors** into the correct feminine mouth/throat posture. Instead of instructing "tongue forward, lips spread, jaw open," the app can instruct "make a bright /s/" — and the posture arrives for free. Each sound also works as a diagnostic.

3. **The carryover/bridging layer** (memory entry `b25c56ab`): the hardest part of voice training is carrying an isolated sound into real conversation. Ten specific techniques address this, with a 4-week daily protocol and a 10-item failure-mode field guide.

The full research dossier spans 12 memory entries (indexed in `d4f64e43-3d1b-4429-8d16-588221f0098c`). This document extracts the **product implications**.

---

## CRITICAL — the language rule (read first)

**Locked user preference, entry `a62f3cf7-26bc-44cb-bde3-e8e9d498266b`.** Cross-session, applies to every learner-facing string in the app.

### The rule
If a 14-year-old cannot point to it on her own body, the word is **banned** from primary content. Plain English body parts + felt sensation only.

### Banned in learner-facing content
- **Acoustic jargon:** "brighter", "darker", "weight" (as voice descriptor), "formant", "F1/F2/F3", "twang", "ring", "squillo", "mask" (as placement), "placement" (jargon use), "resonance" (jargon use)
- **Latin/Greek anatomy:** cricothyroid, thyroarytenoid, arytenoid, cricoid, thyroid cartilage, epiglottis, genioglossus, styloglossus, hyoglossus, palatoglossus, velum/velar, pharynx/pharyngeal, suprahyoid, infrahyoid, mylohyoid, digastric, sternocleidomastoid, orbicularis oris, zygomaticus, masseter, pterygoid, levator veli palatini, tensor veli palatini, aryepiglottic, lateral/posterior cricoarytenoid, transverse arytenoid, interarytenoid
- **SLP/clinic terms:** phonation, phonation threshold pressure, adduction, abduction, modal register, vocal fold, vocal cord, glottis, subglottal, H1-H2, spectral tilt, CPP, formant frequencies
- **Branded technique names:** Estill, Linklater, Lessac, Fitzmaurice, Alexander, Feldenkrais, twang (Estill trademark), bel canto, sob, tilt, chest-mix, head-mix

### Required plain-English alternatives
- "voice box" (not larynx, though larynx is borderline-OK if needed once)
- "the muscle at the front of your throat just below your Adam's apple" (not cricothyroid)
- "the strap muscles under your chin" (not suprahyoid group)
- "the back of the roof of your mouth" (not soft palate / velum)
- "throat" (not pharynx)
- "the two folds in your voice box" (not vocal folds/cords)
- "your lip line", "the corners of your mouth", "your smile muscles" (not orbicularis oris / zygomaticus)
- "your jaw hinge", "the muscles that close your jaw" (not masseter / TMJ)
- "the ridge just behind your upper front teeth" (not alveolar ridge)

### Sensation vocabulary (use freely)
Body locations: chest, sternum, throat, front teeth, lips, nose, cheekbones, behind eyes, crown of head, lower belly, side ribs, lower back, jaw hinge, the back of the roof of your mouth
Sensation qualities: buzz, hum, ring, tickle, warmth, coolness, pressure, stretch, openness, lift, settling, dropping, spreading, flutter, glide, float
Adjacent experiences: yawn, almost-swallow, almost-laugh, sigh, fogging a mirror, almost-sneeze, humming with mouth closed, the moment before a cough, blowing out a candle, talking to a cat, telling a secret

### Example translations (model → learner)
- **Bad:** "Engage your cricothyroid to raise f0"
- **Good:** "Feel a small forward-and-down stretch at the front of your throat, just below your Adam's apple — almost like the start of a yawn"

- **Bad:** "Shift resonance forward via tongue advancement to brighten F2"
- **Good:** "Move the buzz off your chest and into your front teeth, like the feeling right before you smile"

- **Bad:** "Reduce vocal weight by lowering TA activation and increasing CT"
- **Good:** "Let the heavy chest-rumble go; the sound floats up and forward, lighter, like a sigh turning into a hum"

- **Bad:** "Maintain appoggio with balanced transversus abdominis engagement"
- **Good:** "Feel your lower belly gently draw in and up while your lower ribs stay wide — like leaning gently against a wall"

- **Bad:** "Aryepiglottic narrowing adds ring around 3 kHz"
- **Good:** "Find a tiny ringing tickle high up in your throat, behind your nose — almost like a small laugh trying to escape"

### Where the technical layer is allowed
- Internal app engineering references (variable names, comments, API contracts)
- Documentation for engineers and SLPs working on the app
- A clearly-marked "for clinicians / advanced users" appendix the learner can ignore
- Training data labels and evaluation rubrics

**Never in:** the coach model's user-facing output, exercise descriptions, UI copy, audio cues, video scripts, onboarding, tooltips, push notifications.

---

## NEW FRAMEWORK — sound-as-tool pedagogy

**Source:** memory entries `eade17e3` (consonants), `9810932e` (vowels), `37e05934` (non-speech sounds), `b25c56ab` (bridging).

### The core insight
A learner cannot directly position "tongue forward, lips spread, jaw slightly open, voice box stretched." Those are abstract instructions. But if she produces a **bright /s/** correctly, her tongue is already forward, her lips are already spread, her jaw is already slightly open — the entire feminine mouth posture is in place without her having to think about each piece.

Each individual sound functions as four things at once:

1. **Diagnostic** — failure reveals what's wrong (e.g. dark "sh"-y /s/ → tongue is back, lips are flat)
2. **Wedge** — success pulls the posture into correct position
3. **Anchor** — sustained sound strengthens muscle memory
4. **Bridge** — carries into connected speech

### The master sound-tools (priority-ordered)

| Sound | Type | Best for | Sensation when correct |
|---|---|---|---|
| **/s/ "sss"** | Consonant | Forward mouth posture (tongue + lips + jaw all at once) | Hiss zings through front teeth; lips gently smiling |
| **/i/ "ee"** | Vowel | Forward tongue + spread lips (master forward vowel) | Buzz in front teeth and lip line; tongue high and forward |
| **/m/ "mmm"** | Consonant (sustained) | Forward buzz; gentle voice box engagement | Strong buzz in lips, nose, face; can sustain on any note |
| **Lip trill** (motor-boat lips) | Non-speech | Breath support + released throat | Lips flutter freely with tickle; breath steady |
| **Siren** (pitch glide on "oo" or hum) | Non-speech | Voice box flexibility + smooth register transitions | Smooth glide up and down; no cracks or jumps |
| **/ng/ "ng"** (as in sing) | Consonant | Throat open / back-of-mouth dome | Dome feeling at back of roof of mouth; throat open |
| **/sh/ "shh"** | Consonant | The anti-pattern (contrast teacher) | Hiss wide and back; tongue pulled back, lips pursed — the masculine default to AVOID |
| **Sigh** (gentle falling "haa") | Non-speech | Voice release + chest-rumble reduction | Voice floats and falls; chest stays quiet |
| **Yawn-sigh** | Non-speech | Throat release | Open dome at back of mouth; voice box settles |
| **Almost-laugh** | Non-speech | Forward placement via amusement | Lips lift into pre-smile; buzz moves to face naturally |
| **/ae/ "a" (cat)** | Vowel | Open jaw + forward tongue test | Buzz forward despite jaw drop; tests whether tongue stays forward when mouth opens |
| **/u/ "oo" (boot)** | Vowel | Advanced: round lips but keep tongue forward | Lips round but tongue doesn't follow back |

### The combined diagnostic kit (a built-in self-assessment feature)

Each sound tells the learner something specific about her current state. This is **app-ready as a 30-second self-assessment**:

| Sound test | If correct | If wrong |
|---|---|---|
| /s/ bright and forward | Mouth posture is correct | Dark or "sh"-y → tongue back, lips flat |
| /i/ "ee" buzzing in teeth | Forward tongue correct | Muffled or throaty → tongue back, jaw tight |
| /m/ hum buzzing strongly in face | Forward placement correct | Buzzing in chest → voice not yet lightened |
| Lip trill steady and easy | Breath support correct | Choppy or straining → breath pushed, not supported |
| Siren smooth up and down | Voice box flexible | Cracking or jumping → voice box squeezing, not stretching |
| Sigh feels light and floating | Chest rumble reduced | Sigh feels heavy → chest still engaged |

**Feature opportunity:** a "posture check" mode where the learner makes these 6 sounds, self-rates the sensation, and the app surfaces what to work on next.

### Cross-reference: each voice quality's best entry-point sound

For each of the 5 voice qualities (from B7), the best sound to use as the entry-point wedge:

| Voice quality | Best wedge sound | Why |
|---|---|---|
| Higher voice (front-throat stretch) | Siren on "oo" or hum; hum on a rising note | Siren forces smooth voice-box stretch without squeezing |
| Buzz moving forward (mouth shape) | /i/ "ee"; /s/; /m/ hum | All three force tongue forward + lips alive |
| Light voice (less chest rumble) | Sigh; lip trill; almost-laugh | All three release chest engagement |
| Floaty/breathy edge | Fogging-mirror breath; whispered "ah"; /h/ before vowel | All train the soft breath onset |
| High-ending sentence melody | Almost-laugh; question-intonation practice; rising vowel glide | All train the lift at phrase ends |

---

## NEW — the carryover/bridging layer

**Source:** memory entry `b25c56ab-3d1b-4429-8d16-588221f0098c`.

### The problem
A learner can produce a beautiful isolated /s/ but the moment she uses it in a real sentence, her old masculine speech habits take over and the posture collapses. This is called the **transfer / carryover / generalization problem** in voice therapy. It's the documented #1 hardest part of voice training.

### Ten bridging techniques (full detail in `b25c56ab`)
1. **The isolation → word → phrase → sentence → reading → conversation ladder** — classic therapy progression; advance at ~80% accuracy
2. **Sound-first words** — practice words that START with the trained sound (/s/ → "see, so, soon")
3. **Anchor syllables** — pick a short syllable ("mee", "see", "nah") as a reset between phrases
4. **Drift and recover** — learn to notice drift (buzz moving back, throat tightening) and recover with a 2-second silent reset
5. **Slow then fast tempo** — earn each speed; slow reveals posture, fast reveals weak points
6. **Mirror then no-mirror** — wean off visual feedback so the body learns to feel, not see
7. **Controlled-context ladder** — alone → pet → trusted friend → stranger → phone → work
8. **Scripted then spontaneous** — pre-plan posture on written scripts before spontaneous speech
9. **Daily carryover session** — 15 min/day focused ONLY on carryover, not new sounds
10. **Real-time self-monitoring cues** — tiny <2-second check-ins ("where's the buzz? is throat soft?")

### The 4-week Master Bridge Protocol (15 min/day)
- **Week 1** — posture in words (anchor + 5 sound-first words slow + 2-word phrases + 1 real mission)
- **Week 2** — phrases and slow sentences (anchor + 5 phrases slow→medium + 3 scripted sentences)
- **Week 3** — reading and medium tempo (anchor + phrases + paragraph reading + 30-sec unscripted monologue)
- **Week 4** — conversation and tempo ladder (anchor + reading + scripted dialogue + 1-min unscripted recorded conversation + tempo ladder)

### Top 10 reasons learners stall at the bridge (with diagnostic sensations)
1. Jumping rungs ( posture "had it last week, gone now")
2. Mirror dependence (posture dies without mirror)
3. Too few words ("see" perfect, "morning" collapses)
4. No real missions (great in drills, lost in life)
5. All-day too soon (fatigue/strain by afternoon)
6. Internal-focus overload (posture gets WORSE the harder you try — shift to external focus on the buzz)
7. Ignoring drift (recordings reveal what self-perception missed)
8. Tempo too fast (fine slow, collapses at normal)
9. Emotional overload (holds at home, collapses at work)
10. No carryover session (/s/ great but never in speech)

---

## CONTENT AUDIT NEEDED (P0 — ship-blocker)

The existing coaching model output likely violates the language rule (entry `a62f3cf7`). The current production model is `aeon12b-combined-f0.2-Q5_K_M.gguf` trained on a corpus built around June 2026 — that corpus likely contains Latin/Greek anatomy and acoustic jargon that the model regenerates.

### What to do
1. **Audit the coaching corpus and system prompts** for banned words (see banned list above). Prior memory entries show the corpus was originally built with a "deterministic articulatory action map" (cue-families.js in the older sloane-ui voice-tutor-v2 codebase) that used biomechanical vocabulary directly.
2. **Build a deterministic sanitizer** that rewrites or strips jargon from model output before learner delivery. The existing infrastructure is at `~/Desktop/solane/transvoice-app/backend/coaching/sanitizer.js`. Prior entries (`785626dd`, `32abe3e2`) document the existing direction-safety sanitizer pattern — extend it to include the language-rule rewrite.
3. **Map technical terms → plain English equivalents** as a deterministic lookup table (the example translations section above is the seed).
4. **Re-evaluate the live model output register** after corpus/sanitizer changes — re-run the existing evaluation harness (register-aeon-f02 style).

### Existing related memory entries (for context)
- `899d0abb` — coach temperature trade-off (direction safety)
- `b399cbcd` — model identity settled (aeon12b-combined-f0.2 is correct)
- `32abe3e2` — direction-negation guard pattern (existing sanitizer architecture)
- `785626dd` — AEON-12B coach direction-safety fix shipped
- `107cd654` — design conviction: voice targets are culturally/personally relative (don't prescribe one ideal)

---

## P0 GAPS — ship-blockers for productization

These were identified by the audit as missing from the research dossier. They block translation of research into app content.

### Gap 1: Onboarding & first-session flow
**Missing:** what the learner experiences on day one. Expectation-setting (the carryover-is-the-hard-part truth). "What success looks like at 1 month / 3 months / 6 months." What to do if you've already done some training. Informed consent about the daily 15-30 min commitment over 8-12+ sessions.

**Source material available:** B6 (entry `2bd95ece`) covers the timeline; B7 (entry `52f3db90`) covers the qualities; B8d (entry `b25c56ab`) covers carryover. The content needs to be packaged into a first-session experience.

### Gap 2: Curriculum scaffold (week-by-week lesson plans)
**Missing:** the research has ingredients but no recipe. Need week-by-week exercise banks, daily session templates, assessment checkpoints ("can you do X before moving to Y"), graduated difficulty ladders.

**Source material available:** B6's 5-phase timeline + B7's progression order + B8's sound-tools + B8d's 4-week Master Bridge Protocol. Need to assemble these into a full 12-24 week curriculum.

### Gap 3: Audio target library
**Missing:** learners cannot self-calibrate to "buzz in the front of the face" from text alone. Need actual voice samples — one clean reference per B7 quality, plus a small bank of feminine-read voices at varied F0 (165, 180, 200, 220 Hz).

**Note:** this is a content-production gap (recording/editing audio), not a research gap.

---

## MID-PRIORITY IMPROVEMENTS (P1)

### Feature: Drift-detection prompts
During practice or in real-life use, surface rotating single-cue prompts:
- "Where's the buzz right now?" (chest? throat? teeth? face?)
- "Is my throat soft?"
- "Are my lips spread or flat?"
- "Did that sentence end up or down?"

**Critical:** never more than ONE cue at a time. Multiple cues overload attention and collapse posture faster (Wulf motor-learning research, cited in `b25c56ab`). Rotate them; don't stack them.

### Feature: Scripted-conversation library
Real high-frequency situations: coffee order, voicemail, greeting, "how was your weekend," work call, etc. Each script starts with cue marks (a dot before target words; reminder words like "spread" / "soft") that toggle off as the learner progresses. Then "unscripted on the same topic" as the final step.

### Feature: Anchor-sound quick-access button
A persistent button available during any practice mode that plays or cues the learner's chosen anchor sound (e.g. "mee") for a 2-second silent reset. From B8d technique #3.

### Feature: Rung tracker with 80% gating
The carryover ladder (isolation → word → phrase → sentence → reading → conversation) should be tracked. Don't unlock the next rung until the learner self-rates (and optionally the app analyzes) ~80% posture accuracy at the current rung. From B8d technique #1.

### Feature: Tempo drills with break-point flagging
Practice the same phrase at progressive speeds. Flag where the posture breaks first (lips collapse? throat tightens? buzz sinks?). Build the drill around fixing that specific break. From B8d technique #5.

### Feature: Mirror-wean setting
Early practice uses a mirror (via phone selfie or webcam). After posture is learned, require eyes-closed reps to force internal sensing. From B8d technique #6.

### Feature: Real-mission checklist
A daily log of one tiny real utterance practiced in a graded-stakes context (alone → pet → trusted friend → stranger). The ladder is the user's progression through real life, not just app drills. From B8d technique #7.

### Feature: Record-and-compare with self-rating BEFORE feedback
The learner records herself, rates her own posture (where was the buzz? was throat soft?), THEN sees app analysis. This builds the internal monitor. If feedback comes first, the learner outsources judgment and never develops self-monitoring. From B8d failure-mode #7 and Wulf external-focus research.

### Feature: Single-cue-of-the-day
To prevent attentional overload, surface ONE cue per session (rotating). The learner works on just that one thing today. Tomorrow a different one. From B8d failure-mode #6.

### Content: Context transfer paths
Voice in different contexts: phone calls, loud environments (bars, concerts), professional settings (work calls, meetings), public speaking, social events, family settings, singing. Each context stresses different parts of the posture. Document the specific sensations to expect and techniques for each.

**Note:** carryover from practice to spontaneous speech is only ~33% at end of therapy (vs ~50% for reading aloud) per TransVoice's own validated research. Context-transfer work IS the core app value vs static YouTube tutorials.

### Content: Clinical-access & surgery decision support
Cost/insurance, finding gender-affirming SLPs, telehealth options, surgery decision tree (when to consider surgery, what surgery cannot fix, post-op re-training plan, surgeon evaluation criteria, dehiscence warning signs).

### Content: Singing-specific guidance
Major learner goal; currently a one-line aside in B6. Singing has its own register, range, resonance, and expressive demands beyond speaking voice.

---

## LOWER-PRIORITY IMPROVEMENTS (P2)

### Long-term maintenance + relapse recovery
Year 2+ protocol, post-illness voice recovery, post-life-gap re-entry, post-surgery re-training.

### Dysphoria-in-practice toolkit
Pre-session grounding, post-session care, when to skip practice, body-dysmorphia-specific framings. Currently barriers are named in B6 Topic 8 but no dedicated techniques.

### Personal target selection
Role-model bank, regional/cultural/age-appropriate voice targets. The current app likely prescribes one Western/US-English-bright ideal; needs personalization paths. Per design conviction `107cd654`: voice targets are culturally AND personally relative.

### Full voice rest / recovery protocol
Return-to-practice protocol after a strain event, illness, or voice-loss episode. B6 has the warning-stop list but not the return path.

---

## KNOWN MODEL/SYSTEM CONTEXT (for the engineer)

From prior session memory:

- **Production model:** `aeon12b-combined-f0.2-Q5_K_M.gguf` served at `:8019` — see entry `b399cbcd-e3d6-4b42-aaf2-a2618e2218ad` for the model-identity audit
- **Existing sanitizer infrastructure:** `~/Desktop/solane/transvoice-app/backend/coaching/sanitizer.js` — currently implements direction-safety (don't tell MTF learners to lower larynx, etc.); needs extension for the language rule
- **Direction-safety gate:** `~/Desktop/solane/sloane-ui/backend/voice-tutor-v2/style-compliance-v2.js` (`_mascCueIn`/`_femCueIn`/`_negatedCue`) — eval/dataset-gen only, not live
- **Live filter needed:** a live direction filter at the sanitizer layer — see entry `899d0abb` (the original direction-safety problem)
- **Existing corpus:** ~70k records, built June 2026 around the "v2r" articulatory-action-map vocabulary — likely contains the technical jargon this research has now banned
- **Direction-safety has been validated:** 126/126 coaching suite tests green; 10/10 sanitizer-direction tests pass; live delivered wrong-direction rate ~0% across temps 0.2-0.4 (entry `32abe3e2`)
- **Coach temperature recommendation:** temp 0.20-0.25 (naturalness) + system-prompt direction constraint + live sanitizer filter (entry `899d0abb`)
- **Scope decision:** MtF + neutral/androgynous; FtM/masculinization explicitly removed — see entry `04570ae2`

---

## MEMORY ENTRY INDEX (for deep context)

All entries are in shared Sloane memory, project `sloane-os-general`. Recall any by entry ID via `memory_search`. The full master index is `d4f64e43-3d1b-4429-8d16-588221f0098c`.

| ID | Title (short) | Layer |
|---|---|---|
| `a62f3cf7` | **Design rule: plain English + sensation only** | Governance |
| `4fde4720` | B1 Laryngeal anatomy + f0 (technical) | Technical |
| `69414967` | B2 Vocal tract resonance (technical) | Technical |
| `3361cb61` | B3 Vocal weight (technical) | Technical |
| `ad63ae60` | B4 Breath, support, posture | Technical/Sensation |
| `0a121526` | B5 Articulation & prosody (plain English) | User-facing |
| `2bd95ece` | B6 Self-practice, safety, hygiene, evidence | User-facing |
| `52f3db90` | **B7 Plain-English sensation atlas** | User-facing |
| `eade17e3` | B8a Consonants as positioning tools | Sound-tools |
| `9810932e` | B8b Vowels as positioning tools | Sound-tools |
| `37e05934` | B8c Non-speech sounds as tools | Sound-tools |
| `b25c56ab` | B8d Bridging/carryover pedagogy | Sound-tools |
| `fce00216` | Synthesis index v1 (B1-B7) | Index |
| `d4f64e43` | **Synthesis index v2 (B1-B8, supersedes v1)** | Index |

Related prior engineering entries (not part of this research round but referenced above):
- `899d0abb` — coach temperature trade-off / direction safety
- `b399cbcd` — model identity audit (aeon12b-combined-f0.2 is correct)
- `32abe3e2` — direction-negation guard (sanitizer architecture)
- `785626dd` — AEON-12B coach direction-safety fix shipped
- `04570ae2` — scope decision: MtF only, FtM removed
- `107cd654` — design conviction: voice targets culturally/personally relative
- `16c9e3e9` — clinical targets (F0 brackets, plateau, carryover rates)

---

## RECOMMENDED IMPLEMENTATION ORDER

1. **Language-rule sanitizer** (P0, quick win) — extend existing `sanitizer.js` to strip/rewrite banned terms. This alone dramatically improves the learner experience without any new features.
2. **Audit + retrain coaching corpus** — once sanitizer is in place, evaluate what the model is still producing and decide whether a full corpus refresh is needed.
3. **Sound-tools content pack** — turn B8a-c into practice exercises in the app. The /s/, /m/, /i/, lip trill, and siren are the highest-value wedges and need only 5 new exercise types.
4. **Diagnostic kit feature** — the 6-sound self-assessment (posture check mode) is a small feature with high value.
5. **Carryover features** — anchor-sound button, drift-detection prompts (single rotating cue), scripted-conversation library, rung tracker with 80% gating.
6. **P0 gaps** — onboarding flow, curriculum scaffold, audio target library (these are content production more than engineering).
7. **P1/P2 features** as prioritized by product.

---

## QUESTIONS FOR PRODUCT

- Does the app currently have a way to capture learner self-rated sensations (where's the buzz, throat soft yes/no)? If not, this is the single highest-value feature to add — it's the progress metric the entire pedagogy is built around.
- Is the existing coaching corpus rebuildable, or does the language rule need to be enforced purely via sanitizer? (Sanitizer is faster to ship but corpus rebuild gives better long-term quality.)
- What's the audio capability? Can the app play reference audio? Record the learner? Analyze pitch/breathiness in real-time? The diagnostic kit + audio target library depend on these capabilities.
- What's the lesson-authoring workflow? Is content in code, in a CMS, in prompts? This determines how the curriculum scaffold (Gap 2) gets built.

---

## ADDENDUM 2026-07-28 — THREE NEW RESEARCH BRANCHES (B9, B10, B11)

After the initial handoff, three more branches were researched. They are saved as file backups at `docs/research-pending/` and will be committed to memory when the backend recovers (the memory service degraded mid-session; commits are queued).

### B9 — Singing Voice for MtF (`research-pending/B9-SINGING.md`)
Fills the major gap left by B1-B8 (speaking voice only). Key contributions:
- Four singing registers in plain English (chest/mix/head/falsetto) with sensation cues
- **Mix voice is the MtF singer's main target** — neither chest (heavy/masculine) nor pure falsetto (character-y)
- Mix-finding exercises: ng-glide, siren, "small cry," descending slides (10-min daily drill included)
- Range expansion: 2-4 semitones over 6-12 months is realistic; never push chest up
- Vibrato emerges from balance, never forced
- **Choir patterns:** trans women typically start in tenor/bass, move to Alto 2 over time; "sing Alto an octave lower than written" is a common accommodation; STAB formation separates section from gender
- **Solo repertoire:** folk/indie/jazz/alt-country friendly (Tracy Chapman, Annie Lennox, kd lang as lower-voiced women references); soprano pop/MT belt harder
- **Surgery warning:** usually DISCOURAGED for singers — permanent range/quality reduction (AAO-HNS)
- 8-week singer's progression assuming speaking foundations done

### B10 — Non-Speech Vocalizations (`research-pending/B10-NON-SPEECH-VOCALIZATIONS.md`)
Addresses the gap where a perfect speaking voice is betrayed by a single laugh or cough. Key contributions:
- **Laughter:** largely involuntary (brainstem-driven); hard to feminize; practice "heh heh" and "hi hi" patterns with forward buzz
- **Vocal fry:** culturally gendered (feminine-coded in young English speakers) but research shows MEN use it MORE than women (Brown 2026) — perception is social bias, not acoustic fact. Useful in moderation at phrase endings; overuse = stigmatized
- **Cough:** softer attack, doubled ("kh-kh"), smaller mouth = feminine-coded
- **Throat-clear:** REPLACE with swallow + sip of water (B6 rule reinforced); if must clear, soft "ahem" doubled
- **Sneeze:** culturally learned; CAN be reshaped with practice (shorter, higher, smaller, softer)
- **Cry/sob:** hardest to feminize; don't suppress; let posture hold; allow breathiness
- Consolidated diagnostic table: easy (sigh, throat-clear) / medium (cough, laugh, yawn) / hard (sneeze, groan, cry)

### B11 — Surgery Post-Op Rehabilitation (`research-pending/B11-SURGERY-REHAB.md`)
Fills the gap left by B6's brief surgery overview. Key contributions:
- **Pre-op requirements:** 6-12 months of voice therapy required first by most reputable surgeons; baseline recordings; informed consent
- **Strict voice rest 7-14 days** (sometimes 21): NO speaking, NO laughing, NO coughing, NO throat-clearing, NO sneezing, NO mouthing words, NO silent lip-sync, NO heavy lifting, NO smoking/alcohol
- **Therapy begins week 3** with gentle exercises
- **Structured rehab protocol:** week 3-4 gentle hums/ah; week 5-8 range/resonance; week 9-12 quality integration; months 4-12 carryover via the B8d Master Bridge Protocol
- **Pitch outcomes:** +30-60 Hz average (+20-81 range); younger patients better; surgery + therapy > therapy alone
- **Complications:** web dehiscence (sudden pitch drop in first 4 weeks = EMERGENCY — stop voice use, contact surgeon), granuloma, pitch instability, impaired projection, worsened quality
- **Red-flag list:** sudden pitch drop, severe pain, bleeding, breathing difficulty, swallowing difficulty that worsens, fever, voice loss, coughing blood
- **Post-op mind game:** voice grief, dysphoria spikes, isolation, comparison, patience needed (6-12 months to final outcome)
- Decision support: surgery is irreversible; trades pitch for power/flexibility; cheapest surgeon is rarely best; post-op therapy essential not optional

### Cross-branch synthesis points
- **B9 + B11:** surgery usually discouraged for singers because B11 shows permanent range/quality reduction; singers choosing surgery face an explicit values trade-off
- **B10 + B6:** B10 reinforces B6's throat-clear replacement rule and extends to cough/sneeze reshaping
- **B11 + B8d:** post-op rehab after month 4 RESUMES the B8d Master Bridge Protocol — surgery changes the source but not the speech habits
- **B9 + B8a-c:** singing uses the same sound-tools as speaking (siren, ng-glide, /m/ hum, lip trill) but in extended/sustained form

### App feature implications from B9-B11
- **Singer mode** (B9): separate progression for learners who want to sing, assumes speaking foundations done
- **Non-speech vocalization module** (B10): short lessons on laugh, cough, sneeze, cry, throat-clear reshaping — the "passing details" most apps ignore
- **Surgery decision & recovery tracker** (B11): decision-support content, pre-op checklist, voice-rest tracker (14-day countdown), rehab week-by-week protocol, complication red-flag reference

---

## ADDENDUM 2026-07-28 (later) — THREE MORE BRANCHES (B12, B13, B14)

### B12 — Onboarding & Curriculum Scaffold (`research-pending/B12-ONBOARDING-CURRICULUM.md`)
The bridge from research → actual lessons. Synthesizes B6's 5-phase timeline + B7's layer model + B8a-c's sound-tools + B8d's Master Bridge Protocol into:
- **First-session onboarding flow** (15-20 min): welcome, goal/context check, body-awareness baseline, first tiny win (the /m/ hum), lesson 1 assignment, journey expectations
- **24-week curriculum scaffold at standard pace:**
  - Phase 1 Body Awareness (weeks 1-2): posture, breath, throat release, buzz location
  - Phase 2 Single Quality Isolation (weeks 3-8): one quality per fortnight via sound-tool wedges
  - Phase 3 Quality Integration (weeks 9-14): combine 2-3 qualities, then add remaining 2
  - Phase 4 Conversational Bridge (weeks 15-20): the B8d Master Bridge Protocol extended
  - Phase 5 Consolidation & Habit (weeks 21-24+): maintenance + lived practice
- **Assessment checkpoints** with concrete rubric (self-rated + audio-analyzable)
- **Failure-mode recovery paths** (10 stalls + recovery per stall)
- **Personalization vectors** (goal/time/condition/previous-training adaptive)
- **5 daily-session templates** (10/15/20/25/15-min maintenance)
- **App design implications**: adaptive onboarding, phase-gated lesson library, daily session generator, assessment rubric engine, failure-mode detection, real-mission tracker, anchor-sound quick-access, recording cadence manager

### B13 — Context Transfer (`research-pending/B13-CONTEXT-TRANSFER.md`)
The documented #1 hardest part of voice training made worse by specific contexts. Covers phone, loud environments, work, social, and microphone situations. Key contributions:
- **Two universal context stressors:** the Lombard effect (involuntary reflex above ~43 dB noise — pushes voice louder, lower, heavier — destroys feminine posture) and cognitive/emotional load (any attention steal degrades technique)
- **Phone calls:** traditional phone audio is band-limited to ~300-3400 Hz, cutting off the /s/ brightness cue entirely; HD Voice extends to 7 kHz but still limited. Strategies: smile (formants survive the filter), over-emphasize /s/ forward, slow down, use video calls for high stakes, master the "phone hello" specifically
- **Loud environments:** Lombard reflex fights the training; strategies include moving closer, cupping hand near mouth, easy-lean projection, accept partial passing in extreme noise, musician's earplugs, micro-rest breaks
- **Work/professional:** cognitive load degrades technique; build gradually (one colleague → team → meetings → clients → presentations); warmup before hard meetings; "authority ≠ low pitch" reframe; use mics for presentations
- **Social contexts:** trusted friends (easy) → strangers (real missions) → family (often hardest) → dating (anxiety high) → conflict (accept imperfection)
- **Microphone contexts:** proximity effect on cardioid mics boosts BASS (works against MtF); stay 4-8 inches back; omnidirectional mics preferred; podcasting reveals everything (good for MtF); long sessions need breaks
- **Voice budget system:** daily voice has finite units; different contexts spend at different rates; plan ahead
- **Context-specific drills:** phone drill, loud-environment drill, work-meeting drill, presentation drill, conflict drill
- **Context-transfer timeline** (months 7-12+ after Phase 4) — graduated stakes

### B14 — Co-occurring Conditions & Accessibility (`research-pending/B14-CO-OCCURRING-CONDITIONS.md`)
Adapts the curriculum for learners with conditions that violate the pedagogy's assumptions. Covers autism, ADHD, LPR (reflux), asthma, hearing impairment, EDS/hypermobility, anxiety, depression, PTSD, pre-existing voice pathology. Key principle: **adapt the pedagogy to the learner, not the learner to the pedagogy.**
- **Autism:** atypical interoception/proprioception means sensation-based pedagogy may not work; use external feedback (mirrors, video, biofeedback), visual aids, rigid routines, slower Phase 1 (4-6 wk), explicit sensation language
- **ADHD:** external structure non-negotiable (notifications, body-doubling, gamification); short sessions × high frequency; vary drills; accept inconsistency
- **LPR (silent reflux):** stomach acid irritates folds; treat FIRST or concurrently; standard LPR management (no food 3h before bed, raise head of bed, avoid triggers, PPIs); practice mid-day not morning
- **Asthma:** breath support harder; inhaler accessible always; rinse mouth after steroid inhaler; mid-breath range practice; rest during flares; coordinate with pulmonologist
- **Hearing impairment:** visual/tactile feedback critical; pitch-tracking apps, spectrograms; record + review; slower pace (1.5-2x); Deaf signers may not need voice work at all
- **EDS/hypermobility:** gentle jaw work (no subluxation); posture mods for POTS; slower voice-box work; avoid extreme stretches; PT coordination
- **Anxiety disorders:** grounding before practice; tiny commitments; trauma-informed; reduce recording frequency; gender-affirming therapist alongside
- **Depression:** lower the bar (5 min > 0); mechanical practice OK; build into existing routines; treat depression first/concurrently
- **PTSD/trauma:** throat is often trauma site; trauma-informed pacing; consent-based; grounding; choice and control; trauma therapist essential
- **Pre-existing voice pathology:** treat pathology FIRST; nodules/MTD/polyps require specialist SLP + often ENT
- **Accessibility matrix** summarizing per-condition Phase adjustments and key adaptations
- **Universal design principles** for the app: multiple modalities, adjustable pacing, granular settings, trauma-aware defaults, mental health integration, built-in rest days, multiple goal options

### App feature implications from B12-B14
- **Adaptive onboarding flow** (B12) that captures goal/time/conditions/previous-training and places the learner in the right Phase
- **Phase-gated lesson library** (B12) with 80% gating rule
- **Daily session generator** (B12) that pulls the right template + drills for the learner's current week
- **Assessment rubric engine** (B12) — both self-rated and (optionally) audio-analyzed
- **Failure-mode detection** (B12) — surface recovery path when learner stalls 2+ weeks
- **Real-mission tracker** (B12) — daily check-in for one real-life utterance
- **Context-transfer modules** (B13) — phone, loud, work, social, mic, each with specific drills and strategies
- **Voice budget tracker** (B13) — daily/weekly voice-use load visualization
- **Lombard-effect trainer** (B13) — drill with background noise gradually increasing
- **Accessibility settings** (B14) — learner flags conditions; curriculum adapts (pace, drill selection, modality)
- **Multi-modal content** (B14) — text + visual + audio + tactile for every concept
- **Mental health integration** (B14) — grounding exercises before practice, links to crisis resources, therapy referrals
- **Trauma-aware defaults** (B14) — consent-based pacing, never pushy

---

## ADDENDUM 2026-07-28 (final) — THREE MORE BRANCHES (B15, B16, B17)

### B15 — Personal Target Selection & Cultural/Regional Variation (`research-pending/B15-TARGETS-CULTURAL.md`)
Addresses the implicit Western/US-English/middle-class/cis-normative default in the existing dossier. Key contributions:
- The universal vs personal reframe: B7's 5 qualities are universal FOUNDATION; the cultural/personal overlay is FLAVOR
- Cultural variation map: white middle-class American English (the implicit default), AAVE (lower pitch target, distinctive intonation), Southern US (drawl preservation), Latino/Hispanic English, East Asian Englishes, British RP and regional, Australian, South Asian Englishes
- Age cohort variation: Gen Z (vocal fry, uptalk), Millennial, Gen X, Boomer
- Subcultural variation: queer voice, professional voice, indie/alternative, working-class
- **The 7-step personal target selection process** (based on Renée Yoxon): self-inventory → collect 3-5 diverse reference voices → identify common threads → gap analysis → SMART target → mimic practice → periodic re-evaluation
- App support: target voice library (the P0 ship-blocker — needs cultural/age/style diversity), find-your-target wizard, cultural-aware defaults, anti-defaultism in content
- The ethics of target selection: don't push one ideal; don't erase culture; don't erase age; don't shame legitimate patterns like vocal fry/uptalk; consent to mimicry

### B16 — Long-Term Maintenance & Relapse Recovery (`research-pending/B16-MAINTENANCE-RELAPSE.md`)
Covers what happens after Phase 5 of B12 — the years 2, 5, 10+ that most apps ignore. Key contributions:
- The maintenance curve: daily practice months 0-12; 3-5x/week year 2; 1-3x/week year 3; weekly year 5+ for many
- **Drift** (slow degradation): pitch drops 5-15 Hz over 6 months of zero practice; buzz drifts back to chest; weight returns; terminal drop returns. Detected by monthly recording check + trusted friend feedback + self-monitoring cues
- **Illness recovery protocols**: cold (voice rest during, 1-2 weeks recovery), laryngitis (absolute voice rest, 1-2 weeks recovery), flu/COVID (3-6 weeks, may need ENT), intubation trauma from non-voice surgeries
- **Life-gap recovery**: 2-4 weeks for 6-month gap; 4-8 weeks for 1-year gap; 2-3 months for multi-year gaps. Re-acquisition is MUCH faster than initial acquisition (motor memory persists)
- **Aging considerations**: pitch drops with menopause, fold atrophy after 60, periodic re-evaluation every 5 years
- **HRT changes**: estrogen doesn't reverse T-puberty changes (B6 fact) but may affect hydration, mucous, muscle tone; dose changes destabilize temporarily
- **The Year 2+ maintenance protocol**: 5-min daily micro-practice + 15-min weekly tune-up + 30-min monthly assessment + annual re-evaluation
- App: maintenance mode (post-Phase 5), drift detection (monthly recording analysis), life-gap mode (gentle re-entry, no streak-shaming), illness mode (pauses curriculum, offers recovery protocol), long-term community (year-2+ peer mentorship)

### B17 — Non-English Languages & Multilingual Learners (`research-pending/B17-MULTILINGUAL.md`)
Addresses the English-centric bias of B1-B16. Key contributions:
- **What transfers across languages (universal):** higher pitch, forward buzz, lighter voice, breathiness, body foundations — all biomechanical, language-independent
- **What doesn't transfer:** the /s/ brightness cue (English-specific; varies by language), intonation patterns (each language has its own), formant norms (Hillenbrand is US English), rate/rhythm patterns
- **Spanish-speaking learners:** 5-vowel system, syllable-timed rhythm, /s/ may be aspirated in many dialects, different intonation patterns, less vocal fry
- **Japanese-speaking learners:** pitch-accent system constrains pitch training; joseigo/onnarashii women's language has specific sentence-final particles (wa, no, kashira); younger women using less joseigo; pitch REGISTER elevation not intonation change
- **Mandarin/Cantonese (tonal languages):** the critical complication — pitch changes word meaning, so you can't "raise your pitch" without breaking tones. Solution: register shift (everything higher while preserving relative tone relationships) + breathiness + forward buzz + softer articulation
- **Other major language groups:** Korean, Arabic (pharyngeal consonants), Hindi/Urdu, German (closest to English), French (syllable-timed, nasal vowels), Portuguese, Russian
- **Multilingual code-switching:** many trans women speak multiple languages; each may have its own voice pattern; train each language separately; the universal biomechanics transfer, language-specific features don't
- **The 4-layer curriculum model:** Layer 1 universal (body/breath/posture), Layer 2 mostly universal (pitch register), Layer 3 language-specific (intonation, /s/, particles, rhythm), Layer 4 cultural/regional (reference voices, accent preservation)
- App: multi-language support, tonal-language adaptation (preserve tone integrity), per-language reference voice libraries, code-switching support (separate profiles per language)

### App feature implications from B15-B17
- **Target voice library** (B15, P0 ship-blocker): diverse across cultures, regions, ages, styles — not just white cis women from California
- **Find-your-target wizard** (B15): listen-and-rate 10-sec clips → algorithm surfaces common threads → suggests 3-5 reference voices → sets curriculum weighting
- **Cultural-aware defaults** (B15): AAVE learner gets AAVE-feminine examples; Southern learner keeps her drawl; British learner gets RP/regional options
- **Anti-defaultism in content** (B15): every audio example varies; explicit "one option" framing; never "the feminine voice"
- **Maintenance mode** (B16): post-Phase 5 curriculum shifts to 5-min daily + weekly tune-up + monthly drift-check
- **Drift detection** (B16): monthly recording analyzed for pitch/formant changes; surfaces Refresh Week recommendation
- **Life-gap mode** (B16): detects 2+ week absence; offers gentle re-entry curriculum; no streak-shaming
- **Illness mode** (B16): learner flags illness → app pauses regular curriculum → offers recovery protocol → tracks time, recommends ENT if voice doesn't return
- **Multi-language support** (B17): onboarding asks which language(s) to feminize; each language has own drills, references, intonation patterns
- **Tonal-language adaptation** (B17): for Mandarin/Cantonese/Vietnamese/Thai learners, pitch drills preserve tone relationships; register shift not intonation change
- **Code-switching profiles** (B17): multilingual learners have separate voice profiles per language

---

*End of document. Research sources span ~250+ unique web pages + clinical knowledge + sociolinguistic research cross-verified across 18+ research branches (B1-B17 + design rule + synthesis indices + 9 file-pending backups). For any deep technical question, recall the relevant entry by ID or read the file backup at `docs/research-pending/`.*
