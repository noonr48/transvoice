# TransVoice — Adaptive Tutor Directives & the Mirror Graph

**Written:** 2026-07-29 · **Status:** design brainstorm, nothing built yet · **For:** USER

---

## The short version

Three things, and only the third is new work.

1. **The tutor talks about pitch because of a sorting bug, not a design choice.** Its cue banks are almost perfectly balanced across pitch, mouth-shape and weight. But the code that picks *which one to talk about* gives pitch a score that grows with how far off you are, while mouth-shape and weight are frozen at a fixed score. For a beginner, pitch always wins. Every time. It is a five-line problem, not a philosophy problem.

2. **"Too fixed" has a name and a date.** Deterministic replies went live on 2026-07-29 — today — with only **two** instruction variants per topic. The engineer's own note predicted this exact complaint before you made it, and left a one-line rollback.

3. **The two-dot graph you described is already three-quarters built.** The second dot exists, moves frame-by-frame in sync with audio playback, and the drawing code already takes "which dot am I" as a parameter. The whole graph is switched off by one block of CSS. What's missing is feeding the tutor's own voice into it.

And one finding that matters more than all three:

4. **Your own research says pitch is the FOURTH most important lever of five.** The app measures the fourth-best lever superbly and the best lever barely at all.

---

## Part 1 — The metric system: what it covers, how healthy it is, where it should grow

### 1.1 How it's structured

All measurement happens in **one Python file**: `services/voice-trainer/src/services/audio_analysis.py` (4,069 lines, pure numpy — no external audio libraries). The browser measures only microphone level. Everything in `backend/*.js` is a *consumer* — it re-checks thresholds and picks words; it never measures.

Sound flows like this:

```
your microphone
  → 16 kHz audio, chopped into 64-millisecond frames
  → per-frame numbers (pitch, mouth-shape, weight, loudness, confidence)   ← this is what the live dot draws
  → whole-take summary (about 60 numbers)                                  ← this is what the tutor reads
  → saved to disk as JSON + an every-frame log
```

Two important structural facts:

- **The tutor never sees the frame-by-frame stream.** It reads the whole-take averages plus one "weakest fragment" line. So it can tell you *what your voice was on average*, but not *what your voice did during the sentence*. That is a large part of why its advice feels generic.
- **There is a complete frame-by-frame history saved for every session** (`session_frames/{id}.jsonl`). The nuance you're asking for is already recorded. Nothing reads it back.

### 1.2 The honest health scorecard

Reorganised by **the five levers your own research dossier ranks by real-world impact** — not by engineering category. This is the table that answers "what does it cover".

| Rank | Lever | Measured today? | Trust | The gap |
|---|---|---|---|---|
| **1** | **Melody / how sentences end** | Partly — end-of-phrase pitch drop, pitch spread, pitch wobble | Medium | **No melody-shape measure at all.** Nothing classifies a sentence ending as rising, level or falling. The single highest-impact lever has no dedicated number. |
| **2** | **Buzz moving forward (mouth shape)** | Yes — forwardness score, F2, spectral centre | Medium | The measurement is **wrong by −22% on "ee"-type vowels** — exactly the vowels this lever is taught with. A repair is already designed and measured (11 of 12 correct vs the current 2 of 12). |
| **3** | **Light voice (weight)** | Yes — weight score, F1, spectral slope | Low–Medium | The 0-to-1 mapping uses hard-coded anchor numbers nobody documented. Calibration against 650 test clips found "heavy" only detectable at a threshold of 0.25, while the app's profiles use 0.46. |
| **4** | **Higher voice (pitch)** | Yes — nine separate measures | **High** | None. This is the best-measured thing in the app **and the fourth-most-important of five.** |
| **5** | **Breathy edge** | Partly — harmonics-to-noise, cepstral peak | HNR high | Nothing measures *onset type* — whether a word starts hard, soft, or breathy. That's the actual coachable thing. |
| **A** | **Non-negotiable: throat stays soft** | `strainRisk` exists | **BROKEN — inverted** | The 650-clip calibration found clean voices score 0.40–0.51 and *severely strained* voices score 0.05–0.11. It reads backwards. It should be rebuilt from shimmer + harmonic strength, which separate cleanly. |
| **B** | **Non-negotiable: breath stays low** | **Not measured** | — | Cheap proxies exist in data already captured: how long a phrase runs before a refill, and how loudness decays across a phrase. |
| ★ | **/s/ brightness** — *the most gendered single consonant in English* | **Not measured at all** | — | **Physically blocked.** See 1.4. |
| ★ | **Speaking rate and pauses** | **Not measured** | — | There is a `speech_rate` coaching topic in the code with a written drill — and **nothing can ever trigger it.** It's a dead branch. |

**Also true, and wasteful:** thirteen metrics are computed, saved to disk, and **never read by anything** — including per-frame harmonics, loudness range, spectral flux, and two of the jitter/shimmer variants. The system measures more than it uses.

### 1.3 The three trust tiers (this matters for the tutor design)

| Tier | Measures | Why |
|---|---|---|
| **Trustworthy** | pitch and all its percentiles, harmonics-to-noise, cepstral peak, jitter, shimmer, signal-to-noise, clipping | Validated against Praat (the academic reference tool). They return "unknown" rather than inventing a number. |
| **Real but approximate** | F1, F2, forwardness, spectral centre, spectral slope, mouth-shape score, weight score | The physics is real; the conversion into a 0-to-1 score is a judgement call with undocumented anchors. |
| **Guesses dressed as numbers** | strain risk, breathiness risk, stability, similarity, "target hit %" | Hand-weighted blends of the above. Strain risk is measurably backwards. |

**This tier list is the single most important input to the tutor redesign.** A coach that speaks with equal confidence from all three tiers is lying a third of the time.

### 1.4 The finding I'd flag hardest: the app cannot hear /s/

Your research says the brightness of the letter *s* is **the single most gendered consonant sound in English** — girls show the difference by age five. Female /s/ peaks around **6–9 kHz**; male around 4–7 kHz.

The app records and analyses at **16 kHz**. Basic physics (the Nyquist limit) means a 16 kHz recording can only represent sound up to **8 kHz**.

So the entire region that separates a female /s/ from a male /s/ sits **at or above the ceiling of what the app can hear.** Not "measured badly" — physically absent from the data.

Fixing this means raising the capture and analysis rate to 24 or 32 kHz. It is not a settings flip: the pitch tracker and formant maths are tuned for 16 kHz and would need re-validation. But it unlocks the most gendered cue in the language, and it also unlocks coaching the /s/ wedge — which your dossier calls the master tool for finding the whole forward mouth posture.

### 1.5 How I'd expand it, in order of value-for-effort

**Tier 1 — connect what already exists. No new signal processing.**
- Wire up the thirteen dead metrics.
- Feed or delete the dead speaking-rate topic.
- Put mouth-shape and weight into the progress trend (today the trend is pitch-only, so the tutor's whole sense of "are we improving" is a pitch sense).

**Tier 2 — cheap new measures from frames you already capture.**
- **Melody shape** — classify the last 300 ms of each phrase as rising / level / falling, plus the size of the move in semitones. *This measures the #1 lever and the frames already exist.*
- **Rate and pauses** — speech recognition already runs on every turn. Word timings give syllables-per-second, pause count, and pause placement almost free.
- **Onset type** — hard, soft, or breathy word starts, from the first 50 ms of each voiced run. The code that finds run boundaries already exists.
- **Breath proxy** — phrase length before refill, and loudness decay across a phrase.

**Tier 3 — real signal-processing work.**
- Repair F2 on "ee"-type vowels (designed, measured, ~200 lines).
- Add F3 and a vocal-tract-length estimate — needed for the graph in Part 3. **Caution:** this number is vowel-relative, not absolute — the *same* throat reads 19.4 cm on a back vowel and 13.5 cm on a front vowel. It must never be shown as one number.
- Add H1–H2, the actual acoustic correlate of vocal weight.
- Rebuild strain risk from shimmer + harmonic strength (it currently reads backwards).

**Tier 4 — capture change.**
- Raise the analysis rate to 24–32 kHz to make /s/ brightness measurable.

---

## Part 2 — Why the tutor sounds pitch-obsessed and fixed, and what to do

### 2.1 Pitch dominance is a sorting bug — three mechanisms, all cited

The cue content is *fine*. The sentence-teardown cue table is **exactly four pitch cues, four mouth-shape cues, four weight cues**. The system prompt's list of preferred physical actions is four mouth-shape, one weight, **zero pitch**. The code even blocks the phrase "just raise your pitch" as a banned strategy.

And yet pitch wins. Here's why:

**Mechanism 1 — the sort can't pick anything else.**
`backend/coaching/signal-builder.js:591` sorts every detected issue by a confidence number and takes the top one.
- Mouth-shape confidence: **frozen at 0.7** (line 461)
- Weight confidence: **frozen at 0.7** (line 429)
- Pitch-too-low confidence: `dip ÷ 30`, capped at 1.0 (line 552)

Pitch beats 0.7 once you're 21 Hz below target. A beginner is typically 60–90 Hz below. So pitch scores a flat **1.0 on essentially every early take**, and mouth-shape and weight are *mathematically unable* to be chosen. Not deprioritised — unreachable.

**Mechanism 2 — every reply says a pitch number, whatever it's coaching.**
`backend/coaching/direct-reply.js:354-357` opens the composed reply with the take's median pitch in Hz. It does this for **all nine** coaching topics. A vocal-weight turn and a tone-clarity turn both open with *"…last take 158 Hz, this one 165."* Since today's commit, that's the served reply on every coached turn.

**Mechanism 3 — progress is measured in pitch only.**
`signal-builder.js:1698-1718`: the take history string carries Hz and hit-% only, and the improving/flat/fatiguing verdict is computed from hit-% and pitch change. Mouth-shape and weight cannot influence whether the tutor thinks you're getting better.

**And the detail that makes it vivid:** the session logs show you practising at **324–374 Hz**. Every published feminine range tops out around 250. Your pitch isn't just fine, it's well past the target — and the coach still leads with it.

### 2.2 "Too fixed" — the cause is dated today

Deterministic replies were armed live this morning (commit `9e0e8f2`). The engineer's own commit note says:

> *"drill body back-half repeated 3/4 turns … Phase 2 known issue; only TWO instruction variants per axis exist; watch for repetition complaints."*

You are the predicted complaint. Specifics:
- The variant pool covers **three topics × two variants = six sentences.**
- The component that was supposed to route to a wider drill library is **switched off in production** — so six of the nine topics emit **one byte-identical sentence, forever**.
- There is **no stickiness on topic choice** — the tutor can switch focus every single take.

There is a recorded instant rollback: set `VOICE_DIRECT_REPLY_MODE=shadow`. That restores the language model's variety at a cost of 2–3.7 seconds per turn. That is a real trade you can make today.

Worth knowing: **a rich adaptive system already exists and is disconnected.** Spaced repetition, a mastery score that decays, an easy/medium/hard ladder, a three-phase acquire→stabilise→transfer model, and a working sentence-teardown loop are all built and tested. None of it reaches the words the tutor speaks. This is not a missing-feature problem. It's a plumbing problem.

### 2.3 The design: make the choice multi-dimensional

Replace "sort by confidence, take the winner" with a scored selection. Each candidate topic gets:

```
score = normalised_gap × measurement_confidence × stage_weight × leverage_prior
```

- **normalised_gap** — every topic reports *how far off, relative to its own expected spread*. This alone kills the pitch lock: no more 0.7 constants competing with a saturating 1.0.
- **measurement_confidence** — the trust tier from §1.3, live. *An axis the app cannot measure on this take cannot be coached on this take.* This is the honest fix, and it's also what stops the tutor confidently coaching from the broken strain score.
- **stage_weight** — from your dossier's own layering order: body → front-throat stretch → buzz forward → light → breathy edge → melody. A week-one learner is never coached on melody.
- **leverage_prior** — a standing weight from the research ranking, so melody and buzz-forward sit *above* pitch by default.

Then add **stickiness**: a topic must beat the current one by a clear margin to take over. Today only the safety system has this; the coaching topic can flip every take, which is a large part of the feeling that the tutor has no plan.

Safety still pre-empts everything — but rebuilt on a strain measure that isn't inverted.

### 2.4 The design: make the *cue* multi-dimensional too

Right now a topic maps to one sentence. Instead, a spoken cue should be chosen along four axes:

```
topic → direction → rung → tool → variant
```

- **rung** — vowel → word → short sentence → 30-second stretch → conversation. Move up after two clean blocks; drop one the moment stability falls. An approach that fails twice is dead — change the exercise, not the effort.
- **tool** — this is the missing content layer, and you already own it. Your **B8 sound-tools research** catalogues ten consonants, eleven vowels and fourteen non-speech sounds, each documented as a *backdoor into the correct posture*. Its own summary puts it perfectly:

  > *"The learner doesn't have to think 'tongue forward, lips spread, jaw open' — she just has to make a bright /s/ correctly, and all three are in place."*

  So "buzz forward" stops being one sentence and becomes a ladder: **/m/ hum → /i/ "ee" → /s/ → "mee"/"see" → a word → a sentence.** Each rung has its own written cue, its own "what wrong feels like", and its own stop condition. That takes the variant pool from two per topic to roughly fifteen to twenty per topic — drawn from real pedagogy, not paraphrase.

- **variant** — the existing recency-exclusion rotation, now with enough material to actually rotate.

**The nuance you asked for, stated mechanically:** the next thing the tutor says becomes a function of *which lever has the biggest trustworthy gap at your current stage* × *which rung you're standing on* × *which tool hasn't been used lately* × *whether the last attempt improved, held, or slipped*. Four dimensions instead of one.

### 2.5 On your "imagine a thing / act a gasp" idea

**Your method is right and your dossier already validates it.** The plain-English atlas is built on exactly this — every quality is defined by *"what ordinary experience it's adjacent to."* The shipped pedagogy rule is: **size and experience metaphors are fine; location metaphors are banned** ("place it in the mask" is out, "like telling a gentle secret" is in). So imagery plus a body anchor plus a self-check is the house style, not a departure from it.

**Your specific example is backwards, and it matters.** A gasp — and its cousin the yawn-sigh — *lowers* the voice box. The dossier flags this explicitly:

> *"TRANS-FEMININE CAUTION: yawn-sigh LOWERS voice box = OPPOSITE of what feminine voice usually wants. Use to release a tight throat, then immediately move to a forward-buzz sound."*

Over-used, it trains a permanently low voice box. It's a **release tool, not a positioning tool.**

The imagery-actions that push the right way:
- **Almost-laugh** — hold the feeling just before laughing. Lifts the cheekbones, lifts the soft palate, brings the buzz into the face. The dossier calls it *"among the most effective single bridges in trans voice work."*
- **Almost-cry** — the moment just before crying. Lifts the voice box. *(Use gently — it can surface real grief.)*
- **Sniff-and-buzz** — a quick double-sniff, then straight into "mmm". Wakes the space behind the nose.
- **"Talk to a cat." / "Tell a gentle secret." / "The soft inside-of-a-hug feeling."** — three of the thirty ready-written micro-cues.

---

## Part 3 — The mirror graph

### 3.1 What you described, and why it's good

> *"one shows for when the user speaks and the other dot shows when the tutor speaks… it's meant to sub-conscious thinking… the movements of a dot through colours, and space can teach the brain to learn completely without words. no latin. no chemistry knowledge. pure pattern matching."*

This is **call-and-response**, made visual. Not a target to chase — a shape to imitate.

Two independent things in your own files back this up:

1. **Your B8 research reached the same conclusion from the other direction** — that a *sound* can carry a posture the learner could never assemble from instructions. A *shape on a screen* is the same trick in a different channel.
2. **A voice-domain study in your notes (n=48) found that grading every single attempt is worse for long-term retention than grading less often** (effect size ≈ 1.04–1.14 at retention). Continuous verbal verdicts hurt. **A silent, unscored, ambient display is exactly the form of feedback that doesn't.** Your instinct sidesteps a documented failure mode.

### 3.1b The community quadrant chart — what it adds

You then sent the trans-voice-community quadrant chart: androgyny at the crossing, a colour field running corner to corner, dashed circles for male and female averages, and two parallel diagonals marked *"outer boundaries of standard voices"*.

**The diagonal band is the best thing on that chart and this design had missed it entirely.**

Pitch and mouth-shape **co-vary in real voices** — that is why the band runs corner to corner rather than filling the square. Raise pitch *without* the mouth shape following and you do not travel toward the feminine corner; you leave the band **sideways**, into territory that reads as strained and odd rather than feminine.

That is precisely what the research states in words — *"pitch alone sounds forced"*, *"multi-parameter therapy beats single-parameter"* — rendered as a **shape**. It is the owner's own "teach without words" argument, already sitting in the picture he sent.

**It implies a metric the app does not have.** If leaving the band is the real fault, the app should compute **distance off the band** — one number, derived from two things already measured (pitch and frontness). Concretely: normalise both axes to the same 0–1 field, then report the perpendicular offset from the `y = x` diagonal, signed. That gives the tutor a direct, non-pitch way to say *"the pitch is there, the mouth shape hasn't come with it"* instead of reciting Hz. It is cheap — no new DSP — and it is the single most economical way to operationalise "pitch is not the lever". **Added to the plan at step 7.**

**Three things to change from that chart:**

1. **The population circles become the learner's own field, not an average.** "Female average" as a dashed target contradicts a standing decision already in the record — that voice targets are culturally *and personally* relative, and presets are diverse options, **never a prescribed ideal**. It also sets a goal anatomy may put out of reach. The learner's own reachable field, learned from their frozen baseline after three takes, does the same job honestly.
2. **The axis words are on the owner's own banned list.** "Bright resonance" / "dark resonance" are exactly the register he rejected — *"instead of the word 'brighter' voice as if anyone knows wtf that's is"*. The B7 sensation atlas already supplies the replacement: **buzz in your chest ←→ buzz in your face**. Same axis, pointable on your own body, passes the content rule.
3. **The blue-to-pink gradient is a decision, not a default.** It is the clearest way to make the field readable at a glance, and it is also the gender-reveal palette — which for some learners is the thing that makes an app feel like it is grading them against a binary. **Raised deliberately, not decided.** The demo uses the app's own palette so the mechanism can be judged separately from the gender coding.

Also worth recording: the quadrant chart is **not** in the app's origin thread (Part 4). It came from the community. So the diagonal is genuinely new information, not something the app once knew and lost.

### 3.2 What already exists

| Piece | Status |
|---|---|
| Second dot on the same graph | **Built** — `#voice-reference-dot` |
| Drawing code parameterised by which dot | **Built** — takes element + metrics + "is this the reference" |
| Frame-by-frame time-sync to audio playback | **Built** — 60 fps pump while the clip plays |
| Trails for both dots | **Built** — plus a third dashed "phrase map" trail |
| Target zone drawn from real data | **Built** |
| Session replay — dot re-travels a past take | **Built** (338 lines) |
| Before/after comparison of two takes | **Built** — but plays them *one after the other*, never overlaid |
| **The graph being visible at all** | **Off** — one CSS block collapses it to 1×1 pixel, invisible |
| **The tutor's own voice being measured** | **Not built** — the second dot currently shows an uploaded clip, not the tutor speaking |

So: the rendering is done. The work is switching it on and feeding it the right voice.

### 3.3 Design decisions

**Keep the space still.** For pattern learning, the frame must never move — the brain is building a map. One stable space, adopting the quadrant framing from §3.1b:

| Channel | Carries |
|---|---|
| **Origin** | androgyny — axes are *relative*, not absolute Hz |
| **Horizontal** | buzz in chest ← → buzz in face |
| **Vertical** | lower ← → higher, **in semitones** |
| **Diagonal band** | where natural voices sit — leaving it sideways is the lesson |
| **Ground colour** | a corner-to-corner gradient (palette undecided — see §3.1b item 3) |
| **Shaded field** | the learner's own reachable range |
| **Trail** | time |

Note this supersedes the earlier "colour = weight" idea. Weight is the third-ranked lever and its measurement is the least trustworthy of the three plotted; spending the ground colour on the *gendered reading* of the whole field carries more information per glance.

**Change pitch to a musical scale.** Today the vertical axis is linear in Hz (80–400). Pitch perception is logarithmic, so a linear axis squashes movement at the bottom and exaggerates it at the top — it *distorts the gesture* exactly where you want gestures to be readable. Semitones fix it, and the code already computes semitone values elsewhere.

**De-centre pitch visually, not verbally.** Draw the target pitch band as a soft horizontal zone. When you're inside it, that axis goes visually quiet — nothing to chase — and the eye is drawn to the horizontal axis, where the real gap is. For you specifically, at 324–374 Hz, you'd *see* immediately that pitch is not the problem. No sentence required.

**Solve the anatomy problem with shading, not words.** The honest issue: the tutor's voice sits where its throat length puts it. You may not be able to reach that spot. Two moves, both wordless:

- Shade **your own reachable field** softly on the graph, learned from your own takes. (The app already freezes a personal baseline after three takes.)
- Make the imitation target the tutor dot's **shape of travel** — where it starts, how it moves, where it lands — not its absolute position.

This is physically honest: throat length shifts your whole field sideways by roughly a constant, so *the same gesture inside your own field* is genuinely the right target. And it's exactly the "learn without words" you described.

**Alternate, never overlap.** Matching your description precisely: tutor speaks → its dot travels and leaves a trail, your dot dim and parked. You speak → the tutor's trail stays as a ghost, your dot travels over it. Call and response, hear-it-then-make-it. Same rhythm as the sound-wedge pedagogy.

**No numbers. No score. No verdict.** Consistent with the app's own "no scores or streaks" promise and with the reduced-feedback finding.

**Small polish already identified:** the second dot has no easing (it snaps while yours glides at 100 ms), and "is this the reference" is a yes/no flag that should become a proper series identity before a third dot ever lands.

### 3.4 The one thing I can't decide for you

**Your own locked product law forbids this graph on the Coach screen.** Verbatim, from the law you set:

> *"Exactly two persistent interactive controls are allowed on the Coach surface… There is one text space only: the current practice word/sentence… The Coach phone viewport is fixed and no-scroll."*

A graph is a third element. Three ways forward:

1. **Amend the law** — declare the graph part of the instructional canvas.
2. **Put it on the second screen** — the desktop "Explore" studio already exists in the code, fully built, and is switched off. A toggle reveals it.
3. **My recommendation: make the graph a *mode* of the canvas, not an addition.** During a call-and-response drill, the graph *is* what occupies the single instruction space; when the drill ends, the practice sentence returns. Nothing persistent is added, nothing scrolls, the two controls stay two. It respects the law's intent rather than working around it.

I've flagged this rather than deciding it, because the law says an amendment is yours to make.

**The crux, stated plainly:** is the law about *the number two*, or about *not letting the screen become cluttered and chatty?* If it is the count, only option 2 works. If it is the intent — which is what the law's own wording is worried about — option 3 honours it completely.

---

## Part 4 — The Gemini origin thread (19 June 2026)

Source: `~/Downloads/scroll_capture_20260619_001156 (1).pdf` — one page, a 1268×22,813 px image with **no text layer**, read as 21 overlapping vision slices, 100% covered. It opens as a singing-practice app, pivots at the owner's second message to trans voice training, and ends as a full blueprint titled **"Aura: The Vocal Canvas"**.

### 4.1 This is where the pitch bias was born

Verbatim from the blueprint:

> **"Real-Time Pitch Tracker:** With customizable or standard male/female/androgynous frequency ranges shown visually. **This is the single most important tool."**

That sentence is the fork. Pitch received the meter, the coloured bands, the contour overlay, the statistics, the progress graph and the success criterion. Sentence-ending melody — which the July B1–B9 dossier ranks **first** of five levers — received no instrument at all.

**The research postdates the architecture by roughly five weeks**, and the code never caught up. This is the missing *why* behind the confidence-sort artifact in §2.1: nobody chose pitch-dominance in `signal-builder.js`; it was inherited.

### 4.2 Its numbers are folklore — do not port them

Stated three times identically, with **no citation anywhere in the document**:

> Masculine **<150 Hz** · Androgynous **150–180 Hz** · Feminine **>180 Hz**

They are also internally inconsistent with the document's own worked targets — 190, 195 and 205 Hz all sit *above* its own ">180 = feminine" floor, so the learner is already "feminine" by the app's own meter before reaching any goal it sets. Use the July clinical brackets instead (masculine-read <130; the ambiguous zone where formants decide, 145–165; feminine-read >180; typical post-therapy plateau 145–155).

Three further defects in the same measurement layer: spectral **"center of mass"** used as the resonance metric (it moves with loudness, mic distance, sibilance and room); an invented **">2000 Hz energy shift"** as a gender proxy; and **pitch standard deviation rewarded as a scalar**, which optimises *how much* pitch moves rather than *what shape* it makes — the uptalk trap by a different route.

**Its vocabulary is entirely banned** under the later content rule: resonance, formant, F1/F2, brighter, placement, vocal weight, timbre, head voice, chest, vocal fold closure, harmonic-to-noise ratio. Worst structural case: the *Resonance Meter* is specified as a slider between a **"Chest" icon and a "Head/Face" icon** — putting a labelled picture of the masculinising end on screen as a destination.

### 4.3 What the owner said, and why it matters now

> *"My brain can handle a massive amount of infomation at once if they are non verbal, and i am good multi-tasker."*

> *"so far i like the core concepts but the structure can feel little rigid for my liking"*

> *"Kinda like a child smirking across a canvas kinda style. A template only helps me to start the practise so i can branch from there. Again, i like flexibility."*

The rigidity complaint is **six weeks older than this session** and was made about a different subsystem. That makes it a standing preference, not a reaction to today's deterministic-reply rollout. And the non-verbal-density statement is the app's founding principle — the blueprint's second design philosophy reads it back as *"a dense, multi-channel stream of visual, non-verbal data… without the need for distracting text or numbers."*

**Design consequence:** do not reduce non-verbal information density for clarity. That is the usual right instinct and it is the wrong one for this user. Verbal output is the opposite — keep it plain and short.

### 4.4 Three ideas worth reviving

1. **The A/B loop** — *"plays the first node, then immediately plays the second node, and loops back."* This is the alternating tutor-dot / learner-dot idea in audio form, invented by the owner in June. The alternation instinct is his and predates this design conversation.
2. **Opacity as a continuous channel** — *"70% Node A and 30% Node B, the pitch chart could show both contours, with Node B's being more transparent… you would be seeing the analysis of the exact mix you are hearing."* Directly usable on the mirror graph: fade whichever voice is not currently being attended to.
3. **The "golden take" is self-chosen, not scored** — *"whatever recording i choose for a specific exercise or line."* The thread left one question open: is the best take the one that sounds best, hits the number, or *felt* right? The later plain-English-and-sensation rule answers it decisively: **felt right.** That should govern how takes get pinned.

### 4.5 What is NOT in it

Verified by full read: no quadrant chart, no androgyny origin, no diagonal band, no male/female average regions. Also **no** "speak faster = more feminine" claim, **no** "always rise at the end" instruction, and **no** C3–C6 larynx folklore — on those three the origin document is clean.

---

## Part 4b — A commit landed mid-analysis and changes the speed/variety trade

Commit `b359ba9` (29 July, 19:09) — *"perf: TTS latency — pre-synthesis, slim payload, template pre-warm"* — landed while this was being written. It changes the arithmetic behind step 1, so the recommendation there is revised.

### What it does

- **L1** — the gateway fires speech synthesis the moment the reply text is final, draining into the VoxCPM segment cache. The phone's later request is a cache hit: **1.58 s → 0.04 s first byte.** It removes a 4–4.6 s round-trip from the critical path.
- **L3** — session start **pre-warms up to 48 invariant template sentences** through the same path. `PREWARM_TEMPLATE_CAP = 48` (`voice-standalone-runtime.js:6459`).

### Why that changes the trade

The pre-warm only works on sentences whose text is **fixed in advance**. `listPrewarmTemplateTexts()` (`voice-standalone-runtime.js:6461`) draws from `listInvariantTemplateTexts()` — currently **14 sentences** (4 reset + 4 breather + 6 instruction variants) — plus the starter drill bodies, the 12 section-loop cues and the cap-exit line. Roughly 36 of the 48 budget.

So the deterministic path is now fast **because** its sentences are few and unchanging. A language-model reply is novel text every turn: it cannot be pre-warmed, and it still has to be generated before synthesis can even start.

**Revised: flipping back to the model costs more than the 2.5–3.7 s stated in step 1.** The template path just got materially faster; the model path did not.

### Two consequences for the plan

1. **Widening the pools has a cache budget.** Step 8 proposes 15–20 variants per topic across 9 topics — roughly **135–180 sentences**, against a 48-sentence cap. That is 3–4× over. The cap truncates silently, so most new variants would *not* be pre-warmed and would arrive slower than today's. Options: raise the cap; pre-warm adaptively (the variants most likely to be needed next, given the learner's current focus axis and rung); or accept that novelty costs first-play latency. **This needs sizing before step 8, not after.**
2. **Steps 4 and 8 now reinforce each other.** The code's own comment on `listInvariantTemplateTexts()` says *"anything carrying take numbers is uncacheable"*. Every reply that recites a median in Hz is therefore un-pre-warmable. Removing the Hz recitation from non-pitch turns (step 4) does not just de-centre pitch — **it makes more replies cacheable**, which buys back some of the budget that step 8 spends.

### A shared-tree note

That same commit swept two of this session's untracked files into itself — this design document and the working think-sheet at `.deepthink/adaptive-tutor-directives.md` — under a message about TTS latency. No harm done; both are additive. It is a live instance of the known hazard: an untracked file in a shared worktree can ride another session's commit under an unrelated message.

---

## Part 4c — THE TWO-MODE SPLIT (owner decision, 2026-07-29)

The owner's words: *"let's make that a separate self practice mode from the tutor. when the tutor is there, the user is there to speak and communicate with the tutor. There should not be any 'go and do on your own' sort of things or need or any equiptment."* Plus: a *"quick self practice"* for two free minutes before leaving the house or waiting for a bus — *"simply remind them of the exercises they can do… the user can just do their own quick practices when they aren't in the state to want to talk to the tutor."*

### 4c.1 The research demands the same split

B8d, verbatim: **"app should NOT collapse 'learning a sound' and 'using a sound in speech' into the same flow."** Its failure mode #10 is doing only sound-acquisition and never bridging. The owner arrived at the architecture the bridging research prescribes.

### 4c.2 It sidesteps BOTH measurement blockers — the significant part

Part 4d lists two blockers that stop a sound-first tutor. The split removes both *for the drill half*, by construction:

| Blocker | Why it disappears in self-practice |
|---|---|
| The app cannot tell **which sound** the learner is making — no aligner, no phoneme model, no parsed ASR timings | **The user picks the exercise.** They tap "ee"; the app knows it is an "ee" because it asked for one. Not solved — sidestepped, and no new DSP is needed. |
| `resonanceMean` moves more with the practice line's vowel inventory (0.0–0.8) than with the training goal (spread 0.18) | A held single vowel is a **controlled-vowel take.** The confound is gone by construction. |

So every measurement that is unreliable mid-sentence becomes reliable mid-drill. The friction argument and the measurement argument point the same way.

### 4c.3 Where the seam falls

The ladder is **sound → syllable → word → phrase → sentence → conversation.** Self-practice owns the first end, the tutor owns the last. The middle is where voice work actually fails (B8d's most-cited plateau: *"sounds great alone, collapses in sentences"*), so it must be owned explicitly.

**Ruling: the tutor owns everything with a word in it. Self-practice is pure sound.**

Two reasons this is not a compromise:
1. **The code already draws the line there.** `backend/lessons/sentence-progression.js` runs `acquire` (non-lexical) → `stabilise` (3-content-word bridge) → `transfer` (full sentence). The tutor already walks the middle rungs.
2. **It satisfies the no-homework law exactly.** The product law forbids assigning practice for later; work happens *"NOW, in this session, together, step by step."* Word-and-phrase work with the tutor is in-session. Pure-sound work is somewhere the learner chooses to go.

**Continuity without homework:** the tutor may *notice* self-practice ("you found that buzz earlier — bring it into this line") but never *assign* it ("go do your hums"). The first is continuity; the second is the banned pattern.

### 4c.4 What this supersedes

**A queued task — "widen engine-prescribable take kinds from 1 to 5" — is CANCELLED, and the reasoning behind it was partly wrong.**

The original claim was that the engine can prescribe only a hum because `takeKindFromId` (`signal-builder.js:2218`) matches substring hints and only `starter-easy-hum` hits one. Reading the drills more carefully: **that is not an id-naming bug.** Of the 11 starter drills, only `starter-easy-hum` asks for a *pure* sound. `starter-light-lift` ("start on a small 'mm' hum, then open the jaw into the words") and `starter-stable-onenote` ("hold the first vowel for 2 seconds, then continue") are **phrase takes with a sound-based onset cue** — filing them as vocalise kinds would wrongly suppress the resonance issues that phrase takes should surface.

So the engine prescribes one pure sound because the tutor's drill set is, correctly, phrase-shaped. Under the two-mode split that is now the *right* behaviour, not a defect: pure-sound drills belong in self-practice, which the learner enters deliberately.

**A real latent hazard found while checking, left in place and documented:** `isVocaliseTakeKind` (`safety-thresholds.js:92`) is **overloaded**. It answers two unrelated questions — "may the engine prescribe this kind?" (`signal-builder.js:2302`) and "does this kind get the lifted strain warn bar?" (`safety-thresholds.js:116`). Widening it to let the engine prescribe more kinds would silently move a **safety threshold** for those kinds. If the prescribable set is ever widened, split the predicate first.

### 4c.5 What self-practice needs that does not exist

| Piece | Status |
|---|---|
| Drill engine with per-sound honest metrics and per-kind issue suppression | **built** (`takeKind`: sustained · hum_sovt · siren · trill · resonance_play) |
| The five zero-prop vocalises, `needsNothing: true` | **built** (`backend/voice-drills.js:434-611`) |
| Sound → words → sentence ladder | **built** (`sentence-progression.js`) |
| A surface to reach drills **without** the tutor | **missing** — the only route today is the tutor's own drill state |
| A numeric pass test for "the sound landed" | **missing** — `resolveSentenceProgressionTurn` advances on *"a measurable take happened"*, not *"the corrective sound landed"*. `buildKindMetrics` supplies the raw numbers for all five kinds; no thresholds exist. |

### 4c.6 Open, and it is a feel call

Should quick self-practice **measure**, or purely **remind**? It can measure well there (controlled vowel, known sound). But the owner said *"simply remind them of the exercises they can do"*, and a silent menu has less friction than anything that scores. Recommendation: **no verdict, optional meter** — consistent with the app's own "no scores or streaks" promise. Not decided.

---

## Part 5 — What I'd do, in order

| # | Move | Effort | Why first |
|---|---|---|---|
| 1 | Decide the repetition trade — **see Part 4b, the cost of flipping back rose today** | one line | It's live and annoying you today |
| 1b | Size the pre-warm cache against the intended pool size (raise `PREWARM_TEMPLATE_CAP`, or pre-warm adaptively) | small | Blocks step 8 from delivering its speed |
| 2 | ~~Stop `_estimate_timbre` returning a hard-coded `0.5, 0.5`~~ — **measured, closed as won't-change**; the two guards that contain it are now pinned by tests instead. Revisit when the graph ships | done | The claimed dependency on step 3 was wrong; see "Corrections" |
| 3 | Normalise the topic confidences | **done** | **Single highest-leverage change in the whole system.** Unlocks mouth-shape and weight coaching immediately |
| 4 | Make the reply's opening sentence topic-aware — stop reciting Hz on non-pitch turns | small | Removes pitch from 100% of turns |
| 5 | Put mouth-shape and weight into the progress trend | small | The tutor stops measuring progress in pitch alone |
| 6 | Add stickiness to topic choice | small | Ends the flip-flopping |
| 7 | Add the **distance-off-the-band** measure (§3.1b) | small | The number the quadrant chart implies. Lets the tutor say "the pitch is there, the mouth shape hasn't come with it" — no new DSP |
| 8 | Load the B8 sound-tools into the cue banks as rung ladders | medium | Turns 2 variants per topic into ~15, from real pedagogy |
| 9 | Add the melody-shape measure | medium | Gives the #1 lever its first number |
| 10 | Repair F2 on "ee" vowels; rebuild strain from shimmer | medium | Stops the tutor coaching from broken numbers |
| 11 | Un-hide the graph; feed the tutor's speech through the existing analyse route | medium | Turns on the mirror |
| 12 | Quadrant field, semitone axis, natural band, reachable-field shading, alternating dots | medium | The design in Part 3 |
| 13 | Add rate and pauses | medium | Fills a whole missing lever |
| 14 | Raise the sample rate to 24–32 kHz | large | Makes /s/ — the most gendered consonant — audible to the app at all |

---

## Things I could not close, and why

Three items, each needing you rather than more work from me:

- **The repetition trade** (step 1). Speed versus variety — **and the price changed today**, see Part 4b. Revised recommendation: **do not flip back to the model.** The template path is now much faster than it was this morning (0.04 s first byte on a cache hit) and the model path is not, so flipping back now costs more than it did when this was first written. Instead do step 4 (stop reciting Hz, which makes more replies cacheable) and step 8 (widen the pools) together, with the cache sized first. If the repetition is genuinely unbearable in the meantime, the flip is still one line and still reversible.
- **Where the graph is allowed to live** (§3.4). Your product law forbids it on the Coach screen; only you can amend it. The crux is whether the law means "two controls" or "don't let it get cluttered".
- **The ground-colour palette** (§3.1b item 3). Blue/pink is the most instantly readable and is also the gender-reveal palette. Recommendation: ship the app's own colours by default, offer blue/pink later only if asked. This is a judgement about how other people will experience the app, which is yours to make, not mine.

And one item that is work, not a decision:

- **The bridging/carryover research (B8d)** — the layer that carries all of this into real conversation — exists in memory (entry `b25c56ab-b8b6-499c-a105-491a585875cd`) but its body wasn't in the material pulled this session. It's the layer an adaptive tutor most needs for mid-conversation coaching, and it should be retrieved before step 8.

---

## Corrections to things in the record

Two claims in older notes are **no longer true of the live code**, and I don't want them driving decisions:

1. **"The graph fabricates coordinates when nothing was measured" — fixed.** The current code hides the dot rather than inventing a position, with two regression tests locking that in.
2. **"Breathiness risk phantoms +0.35 when data is missing" — fixed.** The live blending code now drops missing inputs from both sides of the average and returns "unknown". *(Breathiness risk still shouldn't drive coaching — but for the reason in §1.3, not that one.)*

The **strain-risk inversion in §1.3 is not corrected** and remains live.

3. **"The live loop produces nothing for formants" — stale.** I checked: the live streaming path passes the `'standard'` analysis profile (`streaming_analyzer.py:512, 538, 628, 675, 726`), so formants **are** computed on every live frame and the graph's horizontal axis is genuinely live. The formant-skipping profile exists but the live path does not use it.

### A smaller version of the same problem — measured, and deliberately NOT changed

`_estimate_timbre` (`audio_analysis.py:754`) returns a hard-coded **`0.5, 0.5`** on its early-exit path (line 773) — dead-centre on both 0-to-1 axes, the most believable wrong answer available. The empty-buffer branch does the same (`:2145-2146`).

I originally wrote that this "should land before step 2 of the plan". **Measurement contradicted that, twice, and the plan changed:**

1. **It never reaches an attempt's means.** A take that is half real voice and half digital silence produces resonance and weight means *identical to the voiced half alone* — measured delta **0.0000**. The aggregate already selects voiced frames only.
2. **An all-silent take is disowned.** It does carry the fabricated 0.5s, but with `measurementAvailable: false` and `no_voiced_frames` — and `detectIssues` (`signal-builder.js:398`) returns early on exactly that, so no issue is ever produced from it. My claimed dependency ("must precede the confidence normalisation") was simply wrong.

`VoiceFrame.resonanceScore` and `.weightScore` are **required floats** in `contracts.py`, mirrored as required numbers in `frontend/src/voice/contracts.ts`. Returning `None` is therefore a breaking wire change across a live path the owner is actively using — not justified for a defect two existing guards already neutralise.

**What was done instead: the guards are now pinned by tests**, so the judgement stays safe if someone later removes them.

- `services/voice-trainer/tests/test_timbre_fabrication_containment.py` — 3 tests: the fabrication still exists and is still 0.5/0.5; a mixed take's means match the voiced-only means exactly; an all-silent take is flagged unusable.
- `backend/coaching/signal-builder.severity.test.js` — the JS twin: a disowned take yields no issue at all.

**This does become load-bearing when the graph ships.** A live dot drawn at dead-centre when nothing was measured is invisible as a failure. The graph work must gate on the same flag the tutor already honours.
