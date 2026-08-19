# TransVoice Practice Philosophy — the third way

> **Current Coach-law override.** See
> [VOICE_COACH_MEMORY_CONTRACT.md](./VOICE_COACH_MEMORY_CONTRACT.md). Coach is a
> flowing spoken lesson with learner-owned Start/End: no forced warm-up,
> cool-down, break, closing ritual, or coach-suggested stop. Older language
> below describing those structures is historical, not normative.

*2026-06-11. The standing law of the product. Every feature, every coach line,
every visual choice answers to this document. It refines (and where it
conflicts, overrides) the gamification-adjacent parts of LESSON-EXPERIENCE-DESIGN.md.*

## What this product is

An **apprenticeship**, not a game and not a textbook. The model is the good
human teacher — the speech-language pathologist, the singing teacher: real
work, honestly mirrored, never alone, aimed at the world.

The true goal-moment of this product is not on any screen. It is a stranger on
the phone saying *"ma'am"* — or *"sir"* — without hesitation, and the person
hearing, maybe for the first time, the gender they always knew themselves to
be. Everything in the app is in service of moments like that. That is not a
game. It must never be treated like one.

## The two failure modes we refuse

**Duolingo-ification:** streaks, XP, gems, confetti, levels, cheerful mascots,
"great job!!!" — engagement mechanics that *substitute* for progress, water
down the practice, infantilize an adult doing brave work, and manufacture a
false sense of progression. Voice transition takes months or years. A system
that pretends otherwise is lying.

**Textbook isolation:** dry drill lists, silent meters, "now go practice on
your own." Unsupervised practice is not neutral — it is where **bad habits and
strain entrench** (practicing wrong is worse than not practicing), and it is
where the loneliness of this work does its damage. "Go practice alone" is the
sentence this product exists to delete.

## The principles

### 1. Never alone with the work
Every practice moment happens *with* the coach: listening, reacting, stopping
what shouldn't continue. There is no unsupervised homework. If the user is
practicing, the system is hearing and guiding; if form degrades into strain,
the coach intervenes **immediately** — that is the bad-habit firewall. Presence
is the product's spine, not a feature.

### 2. Real-world aim, real-world units
Practice content is drawn from the person's actual life: the coffee order, the
phone call to the bank, introducing themselves, **saying their own name**.
Progress is reported in situation terms — *"your phone greeting now holds your
target through the whole sentence"* — never in points, percentages-as-praise,
or levels. The question the app keeps answering: **what can you now do out
there that you couldn't before?**

### 3. The honest mirror, kindly held
The DSP does not lie, and neither does the coach. No inflated praise, no
manufactured wins. Praise must have a basis the person can hear or see
("the ending held this time — listen"). Setbacks and plateaus are named as
part of the path, not papered over: *"plateaus are where the voice settles —
this is the boring part that works."* Warmth and truth are not in tension;
warmth without truth is condescension.

### 4. The long arc is the product
Months to years, in **phases, not levels**:
- **Foundation** — safety, breath, finding the sound at all.
- **Stabilization** — holding it through phrases and minutes.
- **Integration** — real situations, spontaneous speech, emotional load.
- **Living** — maintenance, identity, the voice just being *theirs*.
No completion theater. Time is honored the way a human teacher honors it —
*"six months in. Listen to day one, then today."* The most powerful honest
feature we own is the person's own recorded arc.

### 5. Adult, calm, unceremonious
Sessions start like sitting down with someone who knows you, and end *named*
("that's enough for today — the last three takes were the best ones"). No
fanfare, no badges. The visual language is ink and paper, not arcade: marks on
words are **the teacher's pencil** — a settled underline for what held, a
graphite dot for what slipped. Nothing glows, nothing celebrates, nothing is
red.

### 6. Supportive means protective
The coach ends sessions when the voice is tired (strain markers, session
length) even if the person wants to push: *"pushing now trains the wrong
thing. We stop while it's good."* A system willing to tell you to stop is the
proof it isn't farming your engagement. Vocal health is non-negotiable and the
DSP already measures the risk signals.

## The de-gamification rulings (specific and binding)

- **Word marking stays, the game framing goes.** Per-word marks are a
  teacher's pencil on a script — granular, honest, *after the take* (marking
  while speaking splits attention and is pedagogically wrong; review happens
  together, in replay). Never call it a game. Ink palette only.
- **Banned vocabulary** in any user-facing string or coach line: score, points,
  level, level-up, streak, combo, XP, badge, unlock, quest, "great job!!",
  "awesome!!", "you crushed it". (The v3 dataset enforces this as a hard gate.)
- **Banned mechanics:** daily-streak pressure, leaderboards, confetti/fireworks,
  progress bars that imply completion of a voice, artificial currencies,
  difficulty "stars".
- **Allowed and encouraged:** the person's own recordings over time, situation
  readiness statements, the coach's specific observations, anniversaries
  acknowledged in one human sentence.

## The practice modalities (what "always with you" looks like)

Each exists because of a real-world failure it prevents. Build order follows.

1. **Situation rooms** *(Integration phase; the core real-world engine)* —
   Rehearse actual situations with the coach playing the other side: the
   barista, the receptionist, the recruiter call, the pharmacy pickup. The
   coach speaks (TTS), the learner answers *spontaneously* — unscripted speech
   with the DSP tracking throughout, then a joint debrief with replay. Scenes
   come from the learner's actual life via memory ("you mentioned a phone
   interview Thursday — run it twice with me?"). Includes the **phone room**:
   the learner's audio is band-passed to phone bandwidth (300–3400 Hz) before
   analysis, because the phone is the most voice-gendered, hardest channel in
   real life — train for how you actually sound on it.

2. **One real sentence a day** *(bridges practice → life at minimum dose)* —
   Coach and learner pick ONE sentence the person will genuinely say today
   ("a flat white, please", their name + "nice to meet you", the work
   greeting). Rehearse it together to readiness. Tomorrow the coach asks how
   it went — and logs what the world said back. The honest progression is the
   growing list of sentences the person now *owns in the wild*.

3. **The time-lapse mirror** *(honest progress for a months-long arc)* —
   One pinned take per week (curated, not hoarded) builds the person's own
   arc. At real intervals — and *especially* during plateaus and doubt — the
   coach plays then-vs-now with both compass trails side by side. No XP could
   ever compete with hearing your own voice change. This is also the
   anti-false-progression device: it can't be inflated.

4. **The strain guardian** *(the bad-habit / vocal-health firewall)* —
   Continuous strain/fatigue watch (the DSP's breathy-strain risk bands +
   session length). Coach de-escalates, prescribes recovery (SOVT, rest), or
   ends the session. Warm-up and cool-down are guided *with* the coach, like
   physio — never a checklist.

5. **Real-moment debriefs** *(the life ↔ practice loop)* — First-class flow
   for "it happened": got ma'am'd on the phone, got clocked at the counter,
   chickened out of ordering. The coach debriefs honestly (joy without
   confetti; hurt without minimization), logs it to memory (identity moments,
   whatWorked), and adjusts the plan. The app holds the emotional arc, not
   just the acoustics — because the acoustics exist *for* the emotional arc.

6. **The spontaneity ladder** *(inside situation rooms)* — scripted → prompted
   ("tell me about your morning") → reactive (surprise questions) → emotional
   load (say it tired, annoyed, laughing — the voice falls back to old
   patterns under emotion, so that is exactly where we train). Real life is
   unscripted; most tools never leave the script.

7. **Ear before mouth (listening calibration)** — The coach plays two of the
   learner's own takes: "which one is closer to your target?" The learner
   judges; the DSP confirms. Perception precedes production (core SLP
   principle) — this builds the self-monitoring that makes eventual
   independence *safe*, without demanding it during speech.

8. **Quiet days** *(respect for real constraints)* — For people who can't
   practice aloud (unsafe housing, not out, shared walls): humming/SOVT work,
   ear training, planning, replay review — the coach explicitly supports
   low-voice and silent days. Presence doesn't require volume.

## Build order

- **Now (v1.5):** de-gamified marking (done — ink palette, post-take marks);
  one-real-sentence (card system + memory already support it; needs the
  daily pick + follow-up flow); time-lapse mirror v1 (pinned weekly takes on
  the existing attempt retention + then-vs-now replay).
- **Next (v2):** situation rooms (coach-as-scene-partner on the existing
  conversation loop + scenario cards + debrief), strain guardian (DSP flags →
  coach stop-rules → UI quiet close), real-moment debrief flow.
- **Then:** phone room (band-pass), spontaneity ladder stages, listening
  calibration, quiet days mode.
- **Throughout:** the v3 dataset (see V3-DATASET-SPEC.md) teaches the coach
  model every behavior above natively — including when to say *stop*.
