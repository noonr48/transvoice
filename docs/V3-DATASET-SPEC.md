# TransVoice v3 Dataset — Specification

> **v3.1 REVISION (2026-06-11, supersedes the mode table below):**
> User ruling, verbatim: *"safety_fatigue … strain de-escalation and declarative
> session closes — i don't want that"* and *"i ahd experiences with llm calling
> it a day after two prompts."* Training 10% of the corpus on session-ending
> teaches the deployed coach to quit — the opposite of "always with the person."
> **Changes:**
> - **safety_fatigue REMOVED** (226 generated records purged from the corpus).
>   Vocal-strain protection stays where it already lives: the deterministic
>   v1.5 guardian (rule-fired template lines) — never a trained model behavior.
> - **Global ANTI-QUIT gate:** any coach-initiated session-ending language
>   ("that's enough for today", "let's stop here", "pick it up tomorrow")
>   hard-rejects in EVERY mode. The only allowed closing language is in
>   `persistence` records plan-flagged learner-initiated-leave.
> - **New mode `persistence`** (~5%): the learner wavers (bored, frustrated,
>   self-doubting) with a healthy signal → the coach sustains the session
>   warmly without toxic positivity; OR the learner must leave → instant
>   respect, one warm line, zero guilt. The anti-quitter training.
> - **New mode `memory_write`** (~10%): the coach's reply carries a validated
>   `remember` block (same trailing-fence contract as card-ops) when the
>   learner reveals something durable (a topic, a hobby, a what-worked, an
>   identity moment, a preference) — with restraint (most turns write nothing)
>   and honest "I'll remember that" only when actually writing.
> - **New mode `multi_day_arc`** (~10%): signals carry `daysSinceLastSession`
>   (1 day / 3 days / 2 weeks / 6 weeks), pendingDebrief, focusHistory —
>   teaches gap-aware greetings, next-day follow-ups (runtime VERIFIED across
>   a real day boundary), regression-after-gap handling, week-over-week honest
>   framing.
> - **plateau_truth absorbs progress-recall** prompts (answers "am I getting
>   anywhere?" from baselines/milestones).
> - **Target: 70,000 accepted.** v3.1 allocation:
>   card_author .16 (11,200) · situation_room .14 (9,800) · real_sentence .10
>   (7,000) · replay_call .08 (5,600) · debrief_moment .10 (7,000) ·
>   plateau_truth .08 (5,600) · memo_grounded .09 (6,300) · memory_write .10
>   (7,000) · multi_day_arc .10 (7,000) · persistence .05 (3,500).
> - Memory contracts: see TUTOR-MEMORY-AUDIT.md (the runtime upgrades the
>   dataset mirrors: memory_ops, sessions ring + lastSessionAt, moments log,
>   whatWorked tagging).

*2026-06-11. The training corpus that teaches the coach model the practice
philosophy natively. Companion to PRACTICE-PHILOSOPHY.md (the values) and
LESSON-EXPERIENCE-DESIGN.md (the contracts). Generator: extend
sloane-ui/backend/voice-tutor-v2 (the accept-target orchestrator, gates, and
judge are reused; v3 adds modes and tone gates).*

## Why v3

v2 (69,970 records) taught signal-grounded, bidirectional, reference-as-goal
coaching — and the deployed model does that well. But the lesson layer added
runtime capabilities the model has never seen:

1. **card_ops authoring** — the live model talks *about* changing cards but
   never emits the fenced block (`cardOpsApplied: 0` in live testing). It was
   finetuned before the contract existed; prompt-only instruction isn't
   enough at 8B-quantized scale.
2. **Replay directives** — when to say "let's listen to that one together"
   and where to point (momentProgress).
3. **The practice-philosophy register** — honest support without
   gamification, strain stop-calls, months-scale framing, situation-room
   scene partnering, real-sentence coaching, debriefs of real-world moments.

## Teacher

**The freshly finetuned 12B** (merged `gemma4-12b-coach-merged-5e5`, final
train loss 0.52) served on the training box's fleet — it already speaks
signal-grounded coaching natively, so v3 generations start from competence
instead of prompt-wrangling a generic model. The old s070-E4B pool remains a
fallback teacher. (Serving for generation only — deployment stays
single-tutor-LLM per the design doc.)

> **Serving quant (2026-06-11):** the fleet serves an **imatrix-calibrated
> IQ4_NL** of the merged 12B with **explicit f16 KV cache** (never quantize
> KV for teacher generation) at uniform `-c 16384 -np 2` across all 10
> instances. Calibrator design, evidence, and the PPL gate:
> QUANT-CALIBRATION.md.

Judge/gates run as in v2 (alignment judge + style compliance), extended below.

## New modes (≈ proportions of the new material)

| Mode | Teaches | ~% |
|---|---|---|
| `card_author` | Emitting a correct trailing ```card-ops``` block at the RIGHT moments: create on focus change, emphasize after repeated word slips, swap_phrase for topic personalization, simplify after frustration; **and emitting nothing on most turns** (negative examples dominate 60/40) | 22% |
| `situation_room` | Scene-partner dialogue (barista/phone/reception/work), clean enter/exit of role, in-scene voice notes, post-scene debrief tied to signal | 18% |
| `real_sentence` | Picking today's one real sentence with the learner, rehearsing to readiness, judging readiness honestly, next-day follow-up using memory | 12% |
| `replay_call` | Choosing the listen-together moment: after contrastive takes, after a strain flag, when the learner doubts progress; correct momentProgress from the signal timeline | 10% |
| `safety_fatigue` | Strain/fatigue arcs: de-escalate, prescribe recovery, END the session kindly and firmly; refuse to push on request | 10% |
| `debrief_moment` | Real-world moment debriefs: gendered-correctly joy (no confetti), misgendered hurt (no minimization), avoidance (no judgment); memory write-backs (whatWorked, identity moments) | 10% |
| `plateau_truth` | Honest plateau/setback talk; time-lapse mirror framing ("listen to week one"); months-scale expectations | 8% |
| `memo_grounded` | Turns that naturally use the LearnerMemo (name, topics/hobbies in phrase choices, whatWorked in cue style, stage-appropriate difficulty) | 10% |

All modes inherit v2 invariants: bidirectional (60/40 MTF/FTM), reference-as-
goal where applicable, signal-grounded (never claim to hear what the signal
doesn't show), anti-hallucination rules.

## New gates (style-compliance additions, all hard-reject)

1. **Gamification-language ban**: score, points, level (as progression), level
   up, streak, combo, XP, badge, unlock, quest, achievement, "you crushed
   it", "great job!!"-style multi-bang praise, emoji confetti. (List in the
   gate, shared with the app's copy linter.)
2. **Praise-requires-basis**: any praising sentence must co-occur with a
   concrete basis from the signal or the take ("the ending held", "first time
   pitch stayed in band the whole phrase"). Bare cheerleading rejects.
3. **No-minimization**: in `debrief_moment` hurt contexts, ban "at least",
   "don't worry about it", "it's not a big deal".
4. **DIRECTION-CUE gate** (`directionCueViolation`, added 2026-06-13 — the
   keystone fix). Feminizing acoustic cues (brighter / forward / higher pitch /
   lighter weight / smaller vowels) hard-reject in **masculinizing** records and
   vice-versa. Runs on EVERY v3 mode (including the situation_room debrief turn).
   This closes the gap that caused the defect: the v2 alignment judge — the only
   prior direction check — is gated behind `strat.correcting`, and all v3 modes
   are `correcting:false`, so NOTHING checked direction on them. Context-aware
   lexical (cue word + acoustic-context noun), excludes contrastive take-
   references ("compare to the brighter take") and effort words ("lighter
   onset"). The SAME function is the purge predicate (see remediation below).
5. **Anti-quit gate** (global, all modes): coach-initiated session-ending hard-
   rejects everywhere except `persistence` learner-initiated-leave (`allowClose`).
   Curly apostrophes (’) are normalized to straight (') before matching — ~4.5%
   of teacher output used ’ and silently evaded every apostrophe-bearing gate.
6. **card_ops / remember-ops validity**: any emitted fenced block must parse +
   validate against the real schema (validator run in-loop); malformed or
   non-trailing blocks reject. Emission frequency gated per mode (card_author
   ~40%; others <5% — restraint). memory_write `remember-ops` adds honesty rules
   (no false "I'll remember" without a block; written fact must match the reveal).
7. Existing v2 gates unchanged (grounding/no-hallucinated-perception, forbidden
   phrases incl. masc-side, Hz-grounding, length budgets). (`safety_fatigue`
   stop-call gate REMOVED with the mode — strain protection is runtime-only.)

> **v3.1 REMEDIATION (2026-06-13).** A 10-agent review fan found, and a corpus
> lint confirmed, that **24% of masculinizing records carried feminizing cues**
> (root cause: no direction gate on v3 modes, gate #4 above). Fix shipped, then
> **9,192/64,988 records (14.1%) purged** (direction 7,811 · debrief
> direction-incoherent stimuli 793 · anti-quit 733) via the shared gate function
> (`tools/purge-direction-violations.js`), and regenerated direction-gated.
> Adjacent fixes: the anti-quit apostrophe gap (#5) and `debrief_moment`
> `momentCoherent()` — a joy/hurt moment's gendered read must match the learner's
> direction (an FTM learner "got called ma'am" is a misgendering, not a joy).

## Signal extensions

The CoachingSignal gains (generator-side, mirroring what the runtime now
sends): `activeCard` summary (phrase + token emphasis + revision),
`recentTokenMarks` (held/slipped per word), `strainFlags` + session-minutes,
`LearnerMemo` block (name/stage/topics/whatWorked/lastReference),
`situationContext` (scene id + role) for situation_room, and
`attemptTimeline` markers for replay_call momentProgress selection.

## Size & mix

- **~35,000 new v3 records** (accept-target-driven per mode as in v2 —
  counts are ACCEPTED records; the orchestrator's round-robin + stall-guard
  carry over).
- **Training mix:** v3 35k + **30k sampled from v2** (stratified across its 9
  modes, preferring reference-as-goal and FTM-balanced records) so the new
  behaviors layer onto the old competence instead of replacing it.
- Split: 90/5/5 train/val/test as in v2.

## Pipeline steps

1. **Merge + serve the 12B teacher** (in progress): merged model → GGUF
   (verify llama.cpp gemma4-unified conversion; fall back to serving
   bf16 via vLLM/transformers on the fleet if conversion blocks) → 6–10
   server instances for generation throughput.
2. **Extend the v2 generator** (sloane-ui/backend/voice-tutor-v2): new mode
   modules + prompt pools (agent-built, real⊆expanded tests like v2), new
   gates in style-compliance, card-ops validator import, signal extensions in
   signal-builder-v2.
3. **Pilot 500/mode** → manual + gate review (especially card_ops emission
   restraint and the tone gates) → fix → full run.
4. **Full accept-target run** (~35k accepted) with the 10-min early review
   ritual, streaming writes, manifest.
5. **Mix with v2 sample → finetune**: 12B LoRA (r64, **lr 5e-5, warmup 0.05**
   — the 2e-4 divergence lesson is law) on the fleet via the lora-training
   playbook; optionally a parallel E4B for low-VRAM deploys.
6. **Eval before deploy**: (a) v2 regression suite (coaching quality vs
   current model on held-out v2 test), (b) **card_ops emission**: % of
   card_author-style turns emitting valid blocks + % of ordinary turns
   correctly emitting nothing, (c) **tone audit**: gamification-ban scan +
   praise-basis check over 500 sampled replies, (d) live smoke in the app.
7. **Quantize + swap** on :8019 (single-tutor-LLM constraint holds — this is
   a drop-in model swap, no new services).

## Open questions (resolve before the full run)

- GGUF conversion support for gemma4-12B "Unified" in current llama.cpp — if
  blocked, generation serves bf16 on the fleet (fine) and DEPLOYMENT waits on
  conversion or uses the E4B v3 finetune meanwhile.
- Whether `situation_room` scenes need a second in-scene persona voice at
  generation time (text-only is sufficient for training data; TTS persona is
  a runtime concern).
- v2 sample stratification exact counts per mode (decide at mix time from the
  v2 manifest).
