# Adaptive Coach Program — PLAN (2026-06-18)

> **Historical design record — superseded for the Coach surface and session
> contract.** The canonical contract is
> [`VOICE_COACH_MEMORY_CONTRACT.md`](./VOICE_COACH_MEMORY_CONTRACT.md). Terms
> below such as `breather`, `converse`, and “just chatting” do not authorize a
> text/message interface, forced warm-up or padding, coach-owned rest/stop/end
> decisions, or a closing ritual. Coach is a continuous spoken lesson; the
> learner alone pauses or resumes it with End/Start. Where this record
> conflicts with the canonical contract, the canonical contract wins.

## Mission
Make the TransVoice coach **adaptive, not one-formula**: it must *know* the coaching moves (cue, resurface a due concept, drill) AND have the *judgment of when to hold them* — take a breather, just converse, or switch approach when a method isn't landing. The structured decision lives in the **app (deterministic)**; the model **renders** the chosen action naturally. The coaching dataset is real/good — keep it; the fix is the adaptive RANGE + an eval that measures it.

## Findings that drove this (verified)
- Corpus is NOT cue-collapsed (35,070 unique cue-tails / 71,791; top 0.1%). (event 1082/earlier)
- `review_surfacing 0.185` root cause = generator bug: reviewConcept never seeded into reviewQueue → `Review next:` never rendered → mismatched training. FIXED (reviewQueue-seed in parity-prompt.js + goal_arc.js; renders 3/3).
- `pref_obey 0.682` = thin coverage (4.6%), gold quality fine.
- **Eval gap+bias (event 1082):** judge is per-turn; `actionability` rewards always-one-cue + penalizes breathers; scorers all per-turn correctness; ~2/42 scenarios hint at method-failure; turns scripted-fixed (no adaptation loop). Optimizing it → MORE rigid.
- Conv test: 1.1× is NOT too rigid for chat (natural at 1.1/0.85/0.7). Strength is not the lever.
- Teacher = Q5 finetune (user override) + STRICT gates = rejection sampling (low yield OK).

## THE CONTRACT (shared by all prongs — implement against THIS exactly)
`coachingAction: 'coach' | 'adapt' | 'breather' | 'converse'` — a new field on the CoachingSignal.

**Decision (deterministic, in policy-gates.js / signal-builder.js), precedence top→bottom:**
1. `breather` — safetyState ∈ {stop_and_reset, fatigue_or_strain} OR a recent hard-moment OR shouldCorrect=false for a safety reason.
2. `converse` — intent === continue_conversation (just chatting/venting/sharing; not a practice take).
3. `adapt` — the focus axis shows ≥2 consecutive non-improvements (method not landing) OR the learner signals the cue isn't working. (NEW detector over session take-history.)
4. `coach` — default coaching turn (shouldCorrect=true): one clear cue toward the focus; if reviewQueue has a due concept, resurface it.

**Render directive (renderer-client.js, keyed on coachingAction):**
- coach → "Give one clear, concrete voice cue toward the focus." (+ if Review next: present → "name that concept + a cue for it".)
- adapt → "The current cue isn't landing — acknowledge that briefly and try a DIFFERENT angle/metaphor; do NOT repeat the same cue."
- breather → "Do NOT give a voice cue this turn. Be warm and supportive; let them breathe; no targets."
- converse → "They're chatting/sharing — respond to their meaning naturally, like a supportive friend; no voice cue unless they ask."

**Backward-compat:** default = `coach` preserves current behavior; the field is additive.

## Workstreams (disjoint file ownership → parallel-safe)
- **P2 / app (FOUNDATION, owner=lead):** `backend/coaching/{policy-gates.js,signal-builder.js,index.js,renderer-client.js}` — compute `coachingAction` (+ the ≥2-miss detector), carry it on the signal, render the directive. Unit tests.
- **P1 / eval (owner=agent):** `backend/eval/{lib/judge.js,lib/scorers.js,fixtures/ood-learners.js,quality-suitability-eval.js}` — add `approach_fit` judge dim (reward right action incl. NOT coaching when breather/converse fits); make `actionability` apply only when action=coach; add ≥3 multi-turn "method-failed→adapt" + "venting→breather/converse" scenarios; pass `coachingAction` context to the judge.
- **P3 / dataset (owner=agent):** `memory-dataset-gen/{generate.js,modes/*,parity-prompt.js}` — keep coaching pops + reviewQueue-seed fix; ADD `adapt` / `breather` / `converse` populations conditioned on `coachingAction`; action-specific gates (adapt must NOT re-push + must switch; breather/converse must NOT force a cue); balance the MIX.
- **Re-finetune:** gen with Q5 teacher (`--teacher http://INTERNAL_HOST:PORT` once Q5 is the served teacher) + strict gates (rejection sampling); merge into combined-mtf-only; re-finetune; re-eval with the FIXED eval.
- **Menu (#55, owner=agent):** add TransVoice to the Sloane menu (agent-mode-definitions.ts; relabel existing `voice` OR add a :3021 tile — pick the cleaner per the earlier recon).
- **Frontend (#56, owner=agent):** polish + test the frontend (disabled deeptutor dropdowns, .env drift, leaking pollers, no test runner); rebuild dist; run it.
- **Deploy (#54):** wire the FINAL (re-finetuned, adaptive) model into :8019 (systemd unit env override); held outward step.

## Sequencing
1. Lead writes contract (this doc) → done.
2. PARALLEL: P2 (lead) ‖ P1 (agent) ‖ P3 (agent) ‖ menu (agent) ‖ frontend (agent) — all against the contract above.
3. Lead integrates + RE-VERIFIES each (re-read/run; code-reviewer + runtime-tester gates).
4. Re-finetune → re-eval (fixed eval) → confirm approach_fit + no regression.
5. Deploy adaptive model (#54) + finalize menu/frontend.

## Verification gates (xna discipline)
Every prong: real evidence (tests/run/diff), then `code-reviewer` (reviewer≠author) before "done"; `runtime-tester` for the app + frontend. Re-eval is the program's acceptance gate (approach_fit up, review/pref up, name/direction/safety held, degen 0).
