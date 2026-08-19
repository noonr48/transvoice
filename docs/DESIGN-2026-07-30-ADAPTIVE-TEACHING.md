# Teaching a beginner: what the tutor should change

**2026-07-30 · design, not implementation.** Written from four parallel recon
passes (what the tutor teaches now · whether it can tell what worked · what real
teachers do first · what the synthesis can actually demonstrate).

Owner's ask, verbatim: *"the tutor is actually dynamically learning what working
with the user. it doesn't need to be the user to say 'that works' it like after a
suggestion and the user hit closer to the goal. maybe use those [strong] points to
first get the user into a more accurate [point] then expand from there."*

---

## 1. The finding that reframes the request

The tutor cannot learn which cue worked — **and it cannot even tell her which cue
worked.** Both have one cause: nothing carries the cue forward past the turn that
issued it.

When she lands a good attempt, `composeAcknowledgeWin` picks from four fixed
lines — *"say it again with that same mouth shape"*, *"…with the same loose jaw"* —
via `pickTemplate(WIN_NEXT_STEPS, context.recentReplies)`. Selected **against
recent replies, for freshness**. Not keyed to the axis that improved. A resonance
win and a pitch win get the same sentence.

So she is told *that* it worked and nothing about *what* worked. There is no
sentence she can carry into tomorrow. That is the failure the owner is describing,
one level earlier than he framed it.

**Everything below assumes one enabling change: remember the cue id and its axis
for one more turn.** The id already exists — `recommendDrillForFocus` returns
`{id, instruction, successCriteria}` (`coaching/signal-builder.js:1648+`). It is
simply not carried. The only place that does carry it, `section-loop.js`, is
gated to `takeKind === 'phrase'` (`:488-506`) and therefore excludes every hum,
siren and sustained vowel — i.e. excludes beginners entirely.

---

## 2. Order of work, by payoff per unit of risk

### 2.1 Name what worked (no statistics, no thresholds)

With the cue carried forward, the win line becomes the thing she just did:

> *"That one landed. You were starting the word on a small 'mm' — do that again."*

**Phrase it as co-occurrence, never causation.** The tutor does not know the cue
caused it; she may simply have warmed up. *"That landed, and you were doing X"* is
true. *"X did it"* is a claim we cannot support at n=1.

This alone delivers *"use those strong points"*. No noise model needed.

### 2.2 Stop JUDGING every attempt — but never stop steering

**50% feedback beat 100% feedback for long-term retention** `[controlled]`. The
app currently responds to every take. That is not neutral — it is worse than
responding sometimes, and it also produces tutor-dependence, which the
2026-07-28 brief already lists as a gap ("Feedback is not faded").

**OWNER RULING (2026-07-30), and it sharpens this section.** Verbatim: *"go with
evidence based, but please make sure the tutor isn't just silent. maybe extends
the lesson then a feedback, but it needs to lead to the correct direction without
point obvious feedback in the face in every turn."*

Two different things get said between attempts, and **only one should become
rarer**:

| | What it sounds like | Fade it? |
|---|---|---|
| **JUDGING** (knowledge of results) | *"That was better — 168 Hz, up from 154."* | **YES.** This is what the evidence reduces, and what breeds dependence on the coach. |
| **STEERING** (instruction / attentional cue) | *"Again, same start."* · *"Now the same on the next word."* | **NO.** Keeps the lesson moving and points the right way without grading her. |

So **the tutor never goes quiet.** It keeps running the lesson and keeps steering;
it stops issuing a verdict every single turn and gives one consolidated
observation at the end of a short run.

This supersedes an earlier proposal in this document's history to announce
deliberate silence ("run that three times, then I'll tell you what I noticed").
Announced silence was an acceptable second-best; steer-without-judging is
strictly better, and better supported — the motor-learning literature reduces
knowledge of **results**, not instruction. A voice-only product has no screen to
carry continuity, so an actually-silent tutor reads as a malfunction.

### 2.3 Say categories, not numbers

Per-trial *continuous* scores had **poor** individual-level test-retest
reliability; **criterion-referenced categorical** judgements (typical/atypical)
reached **substantial** agreement `[controlled]`.

The current win line says *"168 Hz, up from 154."* Two attempts by the same
person differ by more than that from noise alone — untrained speakers land 5-7 dB
off their own best on a first phonation, with a 3-4 dB ongoing spread
`[controlled]`. Report **in-target / close / not yet**, never a per-attempt
number. This also extends the owner's existing ban on gender-percentage readouts,
which two independent practitioners call actively harmful.

### 2.4 Discard the first attempt of a run

First phonation is systematically off a speaker's own best. It should not seed a
judgement about a cue or a skill.

---

## 3. The teaching order

Efficacy does **not** favour an order: a randomised crossover (30 trans women,
pitch-first vs resonance-first) detected **no order effects** — what mattered was
getting both `[controlled]`. So order on **teachability**, i.e. what a beginner
can verify unaided.

**Step 1 — a contrast she already owns (weight).**
*"Say 'awww' like you're talking to a puppy. Now say 'aww' like you're annoyed.
Do the first one again."*
Both endpoints are ordinary social behaviour, not a skill, so she succeeds on
attempt one. Landed when she produces two audibly different sounds and can name
the difference **in her own words** — not in ours.

**Step 2 — a configuration forced mechanically (resonance).**
*"Say 'eeee', lips wide like a smile. Now 'pee-pah-poo', same wide smile."*
The "ee" vowel forces the tongue forward and high, which raises the resonance
that matters. She gets it right without knowing what she did.

**Step 3 — pitch, anchored to the floor.**
*"Count 'one two three' starting from the puppy sound."* Never *"speak higher."*
Volitionally shifting pitch by as little as **2 semitones** pushed healthy
speakers toward a vocal-hyperfunction signature `[controlled]`. Watch her
**lowest** pitch rising, not her average.

**Why this order and not pitch-first:** pitch explains **41.6%** of the variance
in perceived gender — real, but under half `[controlled, meta-analysis]`. In
connected speech with 379 speakers, resonance measures outweighed pitch
`[controlled]`. Pitch dominates only for isolated synthesised vowels at extreme
separations `[controlled]` — not the case this app serves.

---

## 4. Cue rubric — six mechanical tests

Applied to ~150 spoken strings. Current register measures roughly **45-50% doable,
20% abstract, 20% unverifiable, 10-15% jargon** — good by the standards of this
category, and *enforced* by the sanitizer rather than aspirational. **The gap is
not jargon. It is verifiability.**

| | Criterion | Fails when the cue… |
|---|---|---|
| C1 | **External, not internal** | names a body part or muscle to control |
| C2 | **Self-verifiable in one attempt** | asks for a state she cannot detect |
| C3 | **Anchored to something she already does** | asks for a novel configuration with no anchor |
| C4 | **No prop, no loudness, no hold** | requires equipment, volume, or a sustained note |
| C5 | **Contrast-shaped** | gives an absolute target with no reference |
| C6 | **Names its own failure mode** | offers no way to tell wrong from right |

C1 and C4 are keyword blocklists — cheap, and the app already has the machinery
(`CUE_VOCABULARY_RULES`, `BEGINNER_JARGON_RULES`). Treat **C1 and C2 as hard
gates**; score C3-C6.

### 4.1 Two exemptions the rubric MUST carry — measured, not theorised

Running C1 and C4 as naive keyword blocklists over the 72 unique drill cue
strings produced **five hits, four of which are false positives** — and stripping
them would make the product worse, not better:

```
C1 FAIL (names an inner body part):  4 / 72
  - "Stop if your throat starts to squeeze or ache."
  - "Stop if your throat burns or aches — the lift should feel like almost nothing."
  - "If it starts to cost anything, stop first, let the throat soften, …"
  - "Let the voice box ride up with the tone instead of holding it down."   <- the ONLY true failure
C4 FAIL (prop / loudness / hold):    1 / 72
  - "Keep the sides of your tongue touching your upper back teeth, not louder."  <- false positive
```

**Exemption 1 — safety instructions are not cues.** The external-focus rule
governs cues that direct *how to produce* a sound. A sentence that names the
throat in order to say **stop if it hurts** is doing the opposite job and is
required: strain is the main documented risk in this population. A blocklist
applied without this exemption would delete exactly the warnings that protect her.

**Exemption 2 — a constraint AGAINST loudness is not a loudness demand.**
"…not louder" is the rule working, not breaking.

So C1 and C4 gate **production cues only**, and a cue must be classified by its
JOB (produce / constrain / protect) before the blocklist runs. One true C1
violation survives that filter — *"let the voice box ride up with the tone"* names
the larynx as something to control, and should be rewritten.

**Measured register** over the same 72 strings: **51% name a doable action**,
7% are quality-words with no action verb. That is consistent with the ~45-50%
estimate this design was built on, so the estimate stands — but note it was
verified only for the drill-pack cues, not all ~150 spoken strings.

External focus is the strongest single lever available: it beats internal focus on
retention (*g* = 0.583), transfer (*g* = 0.584) and muscle efficiency (*g* =
0.833), and is **not moderated by skill level** `[controlled]`.

**On imagery.** Keep imagery that specifies **what to do** and has a known
acoustic consequence ("talking to a puppy", "smile while you say ee"). Cut imagery
that specifies **what to feel** ("place it forward", "let it float") — that is an
internal-focus cue in poetic clothing and fails C1 and C2. This operationalises
the owner's "no arty-sounding stuff" instinct.

**Two existing cues fail C2 outright and should be first to go:**
- *"Judge it by the contact and by where the air feels coolest, not by what it
  sounds like to you"* — switches off her ears and substitutes a discrimination
  that takes trained singers weeks.
- *"Lift the soft palate the way it lifts on an 'ng', then keep it lifted"* — she
  cannot feel a held palate.

**Also:** every cue already ships a `successCriteria`, but phrased as an invisible
measurement (*"how low the voice dips stays at or above the target"*) in an
eyes-free product. Rewriting ~11 strings into something audible is the single
cheapest verifiability win available.

---

## 5. Counting, when it comes — and a correction to the brief

The 2026-07-28 brief specifies *"two ineffective uses exhaust a cue variant for
the current block"*. **That rule is badly calibrated and will retire good cues.**

Modelling "she has it" as a 70% hit rate and "she got lucky" as 25% (exact
binomial):

| Rule | Passes a learner who has it | Passes a lucky learner |
|---|---|---|
| 3 in a row | **34%** | 1.6% |
| 3 of 5 | 84% | 10% |
| **5 of 8** | **81%** | **2.7%** |

A consecutive-run rule feels rigorous and fails a genuinely competent learner about
two-thirds of the time — in this app, that means telling a woman who *can* do it
that she can't. **Use "5 of 8" or "3 of 5". Never a consecutive run.**

Also raise the advance gate: skills taught to an **80%** criterion *deteriorated*
at follow-up; **90%** held for up to a month `[controlled]`.

The brief's other rulings stand and should be kept: promotion only after the skill
survives a real sentence; safety and capture outcomes never count against a cue;
and — importantly — *"do not begin with online reinforcement learning. First make
the policy auditable, deterministic, and replayable."* Nothing above requires a
learned model. Records accumulate from §2.1 for free; counting can start once
there is enough data to see whether the signal beats the noise.

---

## 6. Demonstration — what is actually possible

Owner's note: *"here's what this round [sounds] like… our tts probably has limits."*
Correct, and sharper than expected.

**As wired, the tutor can only say words in a cloned voice.** It cannot hum, hold
a vowel, glide, or trill — text is the only input; there is no duration or pitch-
contour parameter. It cannot render the same phrase brighter vs darker. So
*"listen, then copy this"* is not currently buildable.

Pointedly: **the app already measures glide smoothness and lip-trill rate for
sounds it cannot itself produce.**

Three routes, ascending cost:

1. **Un-suppress the engine's `(control)` prefix under cloning.** The engine
   permits a plain-language instruction alongside a reference clip; the *app*
   forbids the combination by policy ("a selected reference is the complete voice
   identity"). Buys brighter/darker on the same words. **Trap:** the audio cache
   key ignores the control string, so two contrasting instructions would collide
   and return **identical audio** — it would look like it worked and prove
   nothing. Fix the key first, then verify the output through the analyzer before
   trusting it as a target. This is a spike, not a feature.
2. **Pre-render the ladder rungs per preset** — a hum, an "ee", an "s". The only
   route to non-word sounds, because the text channel fundamentally cannot express
   duration or contour. Also gives instant playback.
3. **DSP transform of the tutor's own output.** Explicitly rejected once before
   (`docs/REVIEW-2026-07-18-TWO-MODE.md:206`); no such machinery exists.

**Route 2 is the honest match for the beginner ladder in §3**, since every rung
there is a non-word sound.

### 6.1 Is there a synthesiser that CAN make these sounds? — researched 2026-07-30

Owner's question: *"is there a tts out there that can do those sounds?"*

**Producing the sounds: yes. Producing them in HER voice: no.** That split is the
whole answer.

- **Singing-voice synthesis** (DiffSinger, OpenUtau) handles sustained vowels and
  pitch glides beautifully — it is what they are built for. But they sing in the
  *voicebank's* voice, and making a voicebank of her needs an hour-plus of
  labelled singing. No lip trill either.
- **Praat's formant synthesis hits a specification EXACTLY** `[tested]` — asked
  for 190 Hz it produced 190.00 Hz; asked for a 150→260→150 Hz siren it produced
  152–259; asked for F2 at 2700 Hz it put the peak at 2670. Zero VRAM, CPU,
  milliseconds. Machine-precise target sounds are free — they just sound
  synthetic and are nobody's voice.
- **Audio LMs / paralinguistic tags** (`(sigh)`, `[chuckle]`) are discrete events
  with no sustain or pitch parameter. Wrong shape.

**Voice conversion is the only family that could put a demo in her voice** —
record a hum once from a human, recolour it into her enrolment voice. The
architecture supports it: F0-explicit systems (RVC via RMVPE, DDSP-SVC, seed-vc
with `--f0-condition`) extract pitch with a *separate* tracker, so a hum's pitch
and a siren's glide pass through structurally intact rather than having to be
invented by a speech model. kNN-VC's own demo page applies it to *"non-speech
sounds"* including a barking dog `[documented]`. Avoid token-bottleneck systems
(Chatterbox S3, seed-vc v2's ASTRAL) — a hum has no valid speech token.

**But every candidate has a blocking problem, and none is technical:**

| Candidate | Blocker |
|---|---|
| **seed-vc** — the only zero-shot system whose contract fits a 10–20 s clip | GPL-3.0, and **archived 2025-11-21** |
| **Amphion Vevo 1.5** — architecturally ideal | weights are **CC-BY-NC-4.0**, non-commercial |
| **HQ-SVC** (AAAI 2026) | **no licence file at all** |
| **RVC / DDSP-SVC** — best maintained, MIT | need **minutes** of target audio, not 10–20 s |
| **kNN-VC** | needs ~5 min, and can only emit sounds *present in the reference* — a speech clip contains no hum |

**Two measured caveats if it is ever piloted:**

1. **Vowel identity may smear; pitch will not.** Encoding synthesised hum, /i/,
   /a/, /s/ and a siren through Whisper-small.en (seed-vc's content encoder):
   hum vs /i/ scored **0.908** and /i/ vs /a/ **0.895**, while genuinely different
   signals — real female vs real male speech — scored only **0.825** `[tested]`.
   The encoder can barely tell a hum from an "eeee". Pitch rides a separate
   channel and survives.
2. **The source must be a REAL human recording, never a synthetic one** — real
   jitter and breath sit inside the model's training distribution; a clean
   synthesised tone does not.

**Decision: record five sounds from one human, once.** Exact, zero latency, no new
dependency, ships immediately, and remains the source of truth whatever happens
later. This confirms the owner's own instinct (*"maybe it just ships with the one
voice?"*).

**Optional later pilot, one afternoon:** feed a real recorded hum plus a 15 s
enrolment clip through seed-vc's SVC checkpoint, rendered **once at enrolment and
cached** — there is no real-time requirement. If the converted hum and glide beat
a stranger's voice audibly, take the GPL-3.0-and-archived trade knowingly. If
not, ship the recordings and stop. **Do not convert the /s/** — it has no pitch
and fricatives sound near-identical across speakers; play the raw recording.

**Honest limit on all of the above:** no full record→convert→listen round trip was
ever run. Every claim about conversion *quality* is architectural reasoning plus
documented claims, not a certified result. That pilot is the only thing that would
settle it, and it needs a human recording that does not exist yet.

---

## 7. Two things already written and never used

- **Nine gentle beginner starters** exist (`listStarterDrillInstructions`) and are
  spent entirely on warming a TTS cache (`voice-standalone-runtime.js:6507`).
  They are never spoken to anyone. Meanwhile a first-timer's actual opening is
  *"a band for pitch, resonance, and vocal weight at once… hold all three inside
  their bands"* — from a tutor whose greeting is deliberately empty.
- **Every drill is labelled easy/medium/hard.** It is read only as a sort
  tiebreaker in practice-cards, never as a gate on what a beginner may be handed.

---

## 8. Calibration, to be honest in-app

In the randomised trial above, after **10 weeks of clinician-delivered training,
37% of participants were still rated masculine** `[controlled]`. Whatever the app
promises should be set against that number, not against testimonials.

---

## 9. Owner rulings — all three settled 2026-07-30

1. **"Round" was a typo for "SOUND".** Owner: *"let's first make this **sound** to
   get into the zone. then we expand from there."* This is exactly §3's shape —
   anchor on ONE sound, reach the zone, then widen. It confirms the `/i/` "eeee"
   anchor as step 2's mechanism.
   *(An earlier revision of this doc inferred "a practice round" from the fact
   that lip rounding lowers resonance. The design landed correctly, but the
   inference was not confirmed and should not have been recorded as resolved.)*

2. **Fade the JUDGING, keep the STEERING.** See §2.2 — the tutor never goes
   silent; it stops issuing a verdict every turn.

3. **Ship with a single demonstration voice.** Owner: *"maybe it just ships with
   the one voice?"* — plus an open research question, *"is there a TTS out there
   that can do those sounds?"*

   **Research returned 2026-07-30 — the one-voice decision STANDS.** See §6.1.
   Short version: plenty of systems can make the sounds; none can make them in
   *her* voice from a 10–20 s clip. Voice conversion is the only family that
   could, and every candidate is blocked on licence or maintenance rather than on
   capability — the one system whose contract actually fits a short clip is
   GPL-3.0 and was archived in November 2025. Record five sounds from one human;
   optionally pilot a conversion pass later, rendered once at enrolment.

---

## Appendix A — sample rewrites (PROPOSALS, nothing changed in the app)

Four samples so the owner can judge the register before approving a full pass.
Each is scored against the §4 rubric.

**A1. The "coolest air" cue** — currently the app's designated ground truth for
resonance, and its worst C2 failure.

> **Now:** *"Judge it by the contact and by where the air feels coolest, not by
> what it sounds like to you."*
>
> **Proposed:** *"Say 'eee', then 'ah'. The 'eee' should sound brighter to you.
> That brighter one is the tongue sitting forward — that's what you're keeping."*

Why: gives her a contrast she can hear **with her own ears** instead of switching
them off; both sounds are ones she can already make; checkable in one attempt.
Passes C1, C2, C3, C5. The current version fails C2 outright — locating "coolest
air" is a discrimination that takes trained singers weeks.

**A2. The larynx cue** — the one true C1 violation found by running the rubric.

> **Now:** *"Let the voice box ride up with the tone instead of holding it down."*
>
> **Proposed:** *"Say it like you're talking to someone right next to you, not
> calling across a room."*

Why: replaces a muscle she cannot feel with an imagined listener distance — an
external focus with a known acoustic consequence. Load-bearing imagery (names an
action), not decorative imagery (names a feeling).

**A3. A success check** — one of ~11 phrased as an invisible number.

> **Now:** *"How low the voice dips stays at or above the target."*
>
> **Proposed:** *"Listen to the last word — it shouldn't drop away below the
> rest of the sentence."*

Why: she is using this with her eyes shut. A check she cannot perform is not a
check. Note this also teaches her the failure mode (C6), which the original does
not.

**A4. The congratulation** — currently a stock line picked for freshness.

> **Now:** *"That landed better than the last one — 168 Hz, up from 154. Say it
> again with that same mouth shape."*
>
> **Proposed:** *"That one landed. You were starting the word on a small 'mm' —
> do that again."*

Why: names **what she actually did**, which requires only the carried cue id from
§1. Drops the per-attempt number, which is unreliable at the individual level
(§2.3). Phrased as co-occurrence, not causation — we do not know the cue caused
it, and at n=1 we cannot.

---

## Evidence strength

**Strong (controlled, applicable):** external focus beats internal, unmoderated by
skill · pitch ≈ 41.6% of gender-perception variance · formants outweigh pitch in
connected speech (N=379) · 80% mastery criteria decay, 90% holds · 50% feedback
beats 100% · categorical scoring reliable where per-trial continuous is not ·
vocal loading harms untrained speakers specifically · 2-semitone volitional pitch
shift produces a hyperfunction signature.

**Weak — do not over-build on:** the pitch-vs-resonance *order* (one trial, null
result) · resonance-raises-pitch (N=10 case series) · how trans learners react to
hearing themselves (genuinely unstudied) · all practitioner cue wording (the two
biggest teachers contradict each other on order).

**Corrected en route:** "errorless learning" does **not** support anchor-then-
expand — a 29-study meta-analysis found no advantage in healthy adults (*g* =
0.051, *p* = 0.223). The support comes from shaping, external focus, and
constraints. **Get the easy win first for motivation and measurement stability —
not because errors are harmful.**
