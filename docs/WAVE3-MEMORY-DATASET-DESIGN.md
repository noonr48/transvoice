# Wave 3 — Memory Dataset Generators: Comprehensive Design

Status: **DESIGN / pending sign-off** · Author: main loop (Opus 4.8) · 2026-06-15

> Runtime product-law supersession (2026-07-25): this historical dataset design
> does not own live Coach session pacing. The learner alone starts and ends the
> spoken lesson. The coach never inserts a warm-up, cooldown, break, rest, pause,
> or closing stage. Any generator scheduling/cooldown mechanism mentioned below
> is tooling-only and must not appear in learner-facing dialogue.

The 2nd finetune (over the merged coach LoRA) must **bake memory-USE into the
weights** so the coach reliably uses its per-learner memory — instead of today's
prompt-coerced *partial* use (the train↔runtime gap). This doc designs the
synthetic dataset **generators** that produce that finetune's data.

The generators live in `sloane-ui/backend/voice-tutor-v2/` (the dataset tooling
tree). The runtime contract they must mirror lives in
`transvoice-app/backend/coaching/` (the live app). This doc sits with
`V3-DATASET-SPEC.md`.

---

## 0. Root cause this finetune fixes (VERIFIED 2026-06-15)

The deployed coach was trained on a **different memo serialization than the live
runtime now emits**:

| | Serialization the model SAW in training (v3 corpus) | What the live runtime SENDS today |
|---|---|---|
| Memo | `LearnerMemo: name=Oksana; stage=Living; topics=…; whatWorked=…; lastReference=…` (one inline line, lowercase keys, `;`-joined) | `LearnerMemo\nName: …\nStage: …\nTopics: …\nWhat worked: …\nCoaching preferences: …\nRecent moments: …\nReview next: …` (multi-line, Title-case labels) |
| Memo-use instruction | "LearnerMemo is present, use the name and weave the topics/hobbies…" (1 line) | 3 lines incl. **`Coaching preferences` = HARD CONSTRAINT** and the `Recent moments` one-clause rule |
| Turn-tail directive | *(none)* | `(Personalize using the LearnerMemo above: address the learner by name, honor their Coaching preferences as hard rules, reflect continuity — naturally and briefly.)` |
| `Coaching preferences:` / `Recent moments:` / `Review next:` lines | **never present** (the v3 memo had only name/stage/topics/whatWorked/lastReference) | present (Waves 1/2A/2B added them) |

Evidence: `sloane-ui/backend/docs/voice-tutor/datasets/campaigns/v3-main/voice-tutor-sft.v3.jsonl`
(`LearnerMemo: name=Oksana; …`) vs live `signal-builder.js:415-433` +
`renderer-client.js:51-53,267-271`. So the new labels + directive + HARD-CONSTRAINT
framing are **out-of-distribution** for the deployed model — it greets by name on
conversational turns (the one thing both formats share) but ignores the new
preference/moment/review lines. That is exactly the partial-use symptom observed
live (tv-memtest).

> **Therefore the #1 design mandate is train/inference PARITY on the memo
> serialization, and a serialization-realignment of the existing memory modes.**

---

## 1. Design principle #1 — TRAIN/INFERENCE PARITY (load-bearing)

Every generated record's prompt MUST be structurally **byte-identical** to what the
live renderer produces *at the commit the finetune ships against*:

- **System prompt** = `buildRendererSystemPrompt()` output — including the 3 memo
  instructions, the card-ops addendum, and the `buildMemoryOpsPromptAddendum()`
  block.
- **User message** = `buildRendererUserMessage()` format — memo block near the end,
  followed by the turn-tail `(Personalize using the LearnerMemo above: …)` line.
- **Memo block** = `buildLearnerMemo()` multi-line output — Title-case labels,
  `memoStr` whitespace-collapse + per-field truncation, relevance-first
  `What worked` ordering, the caps (Topics 3 / What worked 3 / Coaching prefs 3 /
  Recent moments **2** / Review next 3).

**Mechanism (no drift):** the generator **imports the live `transvoice-app/backend/
coaching` modules** (`signal-builder.buildLearnerMemo`,
`renderer-client.buildRendererSystemPrompt` / `buildRendererUserMessage`,
`memory-ops.buildMemoryOpsPromptAddendum`) and *builds the prompt with them*, from a
synthesized `CoachingSignal`. The pipeline already resolves these to `SOURCE:'real'`
for validation (Agent recon); extend that from *validation* to *prompt
construction*. This makes the corpus self-updating: if the runtime memo format
changes, regen picks it up.

> Cross-tree note: this requires the dataset tooling (sloane-ui) to `require()` the
> app's coaching modules. The app stays isolated (it does not depend on sloane-ui);
> the dependency is one-way (tooling → app). Acceptable, and the cleanest parity
> guarantee. Alternative if the user wants zero cross-tree coupling: vendor a
> pinned copy of the 3 builders into the tooling + a parity test that diffs them
> against the live modules (fails CI on drift).

---

## 2. The mode set — realign the 4 existing + add 2 explicit

The redesign named 5 intended modes. They map onto the pipeline as follows
(existing built modes in `sloane-ui/backend/voice-tutor-v2/modes/`):

| Intended (redesign) | Realize as | Existing basis | Block? | Teaches |
|---|---|---|---|---|
| `recall_use` | **realign `memo_grounded`** | `memo_grounded.js` | no | USE the multi-line memo: greet by name, weave topics/whatWorked, reflect Days-since, stage-appropriate difficulty |
| `pref_obey` | **NEW mode** | (none — closest is memo_grounded reads) | no | treat `Coaching preferences:` as a HARD CONSTRAINT — the reply changes to obey it |
| `goal_arc` | **realign `multi_day_arc`** | `multi_day_arc.js` | no | sense of time + goal continuity + `Review next:` surfacing |
| `memory_update` | **realign `memory_write`** | `memory_write.js` | yes | emit clean/faithful `remember-ops` (35/65 restraint) + **faithfulness gate** |
| `debrief_capture` | **realign `debrief_moment`** | `debrief_moment.js` | yes | moment debriefs that ALSO emit a faithful `moment` op (current mode narrates the write-back but emits NO block — fix) |

All realignments share one change: **swap the legacy inline memo for the live
multi-line builder (§1)** and add the turn-tail directive + the 3 system
instructions. That alone is most of the train-gap fix.

### New mode: `pref_obey` (the highest-value new generator)
- **Signal:** a memo carrying a `Coaching preferences:` line, rotating the **6
  canonical preference strings** from `memory-extract.js` (so the LLM-trained
  behavior and the deterministic emitter agree) **plus faithful paraphrases** (so it
  generalizes beyond the canonical wording):
  - `Prefers concrete physical cues over imagery or metaphor`
  - `Prefers a slower coaching pace`
  - `Prefers fewer corrections and more encouragement`
  - `Prefers a gentle, patient, encouraging tone`
  - `Prefers direct, blunt feedback`
  - `Prefers short, concise coaching`
- **Learner utterance:** chosen so the *default* coaching reply would TEMPT a
  violation (e.g. for `concrete-over-imagery`, a turn where an imagery cue is the
  easy move; for `brevity`, a turn that invites a long explanation).
- **Target reply (teacher):** obeys the preference.
- **CONTRAST pairs:** the SAME signal/utterance with vs without the preference line,
  so the model learns the preference *changes* behavior (not just correlates).
- **Gate:** a per-preference violation detector (see §4) — e.g. imagery-confuses →
  reject replies with imagery/metaphor cue words; brevity → length cap; gentle vs
  direct → tone-lexicon check. Records whose teacher reply violates the active
  preference are rejected.

---

## 3. Recall-heavy weighting + anti-forgetting

The gap is on **reading** memory, so the READ modes dominate. This is a **2nd
finetune over the coach**, so a slice of base coaching must be retained or the model
forgets how to coach (catastrophic forgetting).

Proposed mix of the memory-finetune corpus:

| Mode | Share | Note |
|---|---|---|
| `recall_use` | 22% | core read-use |
| `pref_obey` | 18% | the new hard-constraint behavior |
| `goal_arc` | 12% | time + review-next |
| `memory_update` | 12% | writes, 35/65 restraint |
| `debrief_capture` | 8% | faithful moment ops |
| **memory subtotal** | **~72%** | |
| retained base coaching (sampled from v3-main non-memory modes: card_author / real_sentence / replay_call / plateau_truth / conversation) | ~28% | anti-forgetting |

Two coverage rules:
1. **Every memory record carries a populated multi-line memo** — so the model sees
   the *new* serialization on every memory turn.
2. **A fraction (~30%) of the retained base-coaching records ALSO carry a memo** (but
   the turn doesn't depend on it) — so "memo present" is not spuriously correlated
   with "do something memory-ish". Prevents the model learning "memo ⇒ always recite".

Direction balance (MTF/FTM) and the per-mode accept-target / deficit-first
generator scheduling are inherited from `orchestrator.js`. Its internal retry
cooldown is tooling-only; it must never generate a learner-facing cooldown,
warm-up, stop, break, rest, or closure suggestion.

---

## 4. The missing FAITHFULNESS gate (must add)

Recon found **no value-content reveal-match gate**: `memory_write` verifies the
emitted block is *schema-valid* + *acknowledged*, but NOT that the written
`kind`/`value` equals the planned reveal. For a memory finetune, an unfaithful write
("remembers" the wrong fact) is worse than no write. Add:

- **`memory_update` reveal-match:** emitted op `kind` == planned `kind`, AND `value`
  matches the reveal — lexical-overlap threshold (token Jaccard ≥ τ) for free-text
  (topic/hobby/moment/whatWorked), exact-canonical match for `preference`. Reject
  unfaithful records.
- **`pref_obey` ⇄ deterministic parity:** when a preference is *captured* in a
  record, the written `preference` value must map to one of the 6 canonical strings
  (or a faithful paraphrase that the deterministic `memory-extract` rules would also
  fire on). This keeps the LLM-trained capture and the always-on deterministic
  capture from disagreeing (no contradictory dual-write into `coachPreferences[]`).
- Keep the existing structural gates: trailing-fence-only, `FB_REMEMBER_KINDS`
  (incl. `whatworked`→`whatWorked` normalization), `FB_MAX_OPS=3`,
  `FB_MAX_VALUE_LEN=200` clamp, the false-claim gate (`makesMemoryClaim` without a
  block), and the direction-cue gate (runs on every mode).

---

## 5. Coverage, split, validation, eval

- **Generator scaffold:** new/realigned files in `voice-tutor-v2/modes/`, registered
  in `V3_REGISTRY` + `V3_MODE_ALLOC` (`orchestrator.js`). Each exports
  `buildSignal` / `assembleRecord` / `buildMessages` and sets
  `expected.memoryOpsPlan` to route the gate. Teacher = the **merged coach** served
  on `:8019-8022` (the 2nd-finetune base; see §6).
- **Record schema:** `voice-tutor-sft-v3` (unchanged) — `messages:[system,user,
  assistant]`, `signal_snapshot`, `expected`. The ONLY change is the prompt strings
  (now built from the live runtime builders).
- **Split:** deterministic per-mode index `i%10==8→val, ==9→test, else train`
  (≈80/10/10), inherited.
- **Validation:** extend `style-compliance-v2.js` with (a) the `pref_obey` violation
  detector and (b) the `memory_update` faithfulness gate; keep all existing v3 gates.
- **Held-out memory-use EVAL (new):** automate the live tv-memtest probe as a
  regression eval against the finetuned model — measure: name-use rate on
  conversational turns, preference-obey rate (per canonical pref), review-next
  surfacing, faithful-op rate, and *no* over-recitation / no forced moments. This is
  the ship gate for the finetune (not just train loss).

---

## 6. Training mix & the 2nd-finetune setup

- **Base:** the 2nd finetune runs **over the merged 1st-finetune coach** — so the
  1st finetune (the trained 12B / E4B LoRA, already complete per project memory)
  must be **merged → quantized → deployed to `:8019`** first. That deploy is a
  discrete prerequisite task (validate → merge → GGUF-quantize at the shipped
  Q5_K_M rung → swap `:8019`). The teacher endpoint for generation is that same
  merged model.
- **Corpus mix for the run:** the recall-heavy memory corpus (§3) is itself ~72%
  memory / 28% retained base coaching. If the 1st-finetune coaching behavior is
  strong, the retained slice can be smaller; if regression appears in eval, raise it.
- **LoRA hyperparams:** follow the 1st finetune — r64 / alpha128, lr 5e-5,
  **grad-skip-threshold 0 (clip-only)** — the flat-loss DO-NOT-RETRY lesson.
- **Order:** deploy-merged-coach → regen/realign corpus (parity) → train 2nd LoRA →
  eval gate (§5) → merge+quantize+deploy.

---

## 7. Open decisions (need sign-off before build)

1. **Regen scope:** (a) regenerate the WHOLE v3 corpus against the new serialization
   (cleanest parity, ~70k records, more teacher compute) vs (b) generate a
   memory-focused ADDITIVE corpus + a one-pass serialization-realignment of just the
   existing memory modes' memo strings (cheaper, but mixed serialization in the
   non-memory bulk). **Recommendation: (a)** — the serialization drift is the root
   cause and it affects *every* memo-bearing record, not just memory modes.
2. **Cross-tree coupling:** tooling `require()`s the live app builders (§1) vs
   vendored-pinned-copy + drift test. **Recommendation: direct require** (strongest
   parity), with the app staying dependency-free of the tooling.
3. **`pref_obey` coverage:** all 6 canonical prefs + paraphrases vs a subset.
   **Recommendation: all 6** (cheap, and the deterministic emitter already produces
   all 6).
4. **Faithfulness gate strictness:** lexical Jaccard τ vs an LLM-judge for semantic
   match. **Recommendation: lexical first** (deterministic, fast), add judge only if
   eval shows paraphrase misses.
5. **Recall-heavy ratio** (§3 table) — confirm or adjust.

---

## 8. Build order (once signed off)

1. Deploy the merged 1st-finetune coach to `:8019` (prerequisite; separate task).
2. Wire the parity prompt-builder (import live coaching modules into the tooling) +
   a parity test.
3. Realign the 4 existing memory modes to the new serialization.
4. Build `pref_obey` (new mode) + its violation gate.
5. Add the `memory_update` faithfulness gate + fix `debrief_capture` to emit the
   moment op.
6. Set the recall-heavy `V3_MODE_ALLOC` + the memo-coverage rules (§3).
7. Generate → validate → split.
8. Train the 2nd LoRA → run the memory-use eval gate (§5) → merge/quantize/deploy.
