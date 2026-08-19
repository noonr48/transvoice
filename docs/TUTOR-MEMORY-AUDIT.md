# Tutor Memory Audit — is the learner memory suitable?

> **Superseded audit.** This 2026-06-11 snapshot describes schema v3 and several
> gaps that are now implemented or redesigned. The current normative contract
> is [VOICE_COACH_MEMORY_CONTRACT.md](./VOICE_COACH_MEMORY_CONTRACT.md); the
> current evidence review is
> [transvoice-memory-system-review-2026-07-25.md](../studio/code/transvoice-memory-system-review-2026-07-25.md).

*2026-06-11. Audit of the voice tutor's own memory system against the
PRACTICE-PHILOSOPHY vision ("remember what worked, what the person did before,
who the person is, their hobbies, the learning stage they are at"), plus the
upgrade plan. Companion: V3-DATASET-SPEC.md v3.1 (the dataset teaches the model
to USE this memory).*

## What exists today (verified in learner-context-service.js)

File-backed per-student profile (`~/.local/state/sloane/voice-standalone/
learner-context/students/<id>.json`), schema v3, additive-normalized:

- **Who they are:** `profile { displayName, topics[], hobbies[] }` (write route
  exists; nothing populates it from conversation).
- **Practice state:** `voice { targetPreset, targetHistory, conceptStats,
  recentAttempts (ring), reviewQueue, struggles[], whatWorked[] (cap 10),
  realSentences[] (cap 60, day-boundary verified), lastReference {clipId,name,
  summary}, baseline, notepadHandoff }` + mastery inference.
- **Artifacts:** DSP milestone store (pinned takes, permanent), attempt WAV
  ring (20), durable reference clips.
- **Consent/eligibility/exclusions + export manifest route** — the dignity
  layer exists at the data level.
- **Day-boundary continuity:** VERIFIED live — a sentence picked yesterday
  surfaces as the greeting's debrief question today, exactly once, and closes
  cleanly on outcome.

**Verdict: the foundation is suitable** — durable, local-first, additive,
already personal. But it is a *record* more than a *memory*: nothing lets the
tutor REMEMBER from conversation, and nothing gives it a sense of TIME.

## The gaps (ranked)

1. **The coach cannot remember.** When the learner says "my sister's wedding
   is in June" or "imagery cues confuse me", the model can SAY "I'll note
   that" — and it would be a lie. There is no tutor-writable memory channel.
   → **memory_ops**: the coach's single reply may carry a validated
   `remember` block (same trailing-fence contract as card_ops):
   `{ remember: [{kind: topic|hobby|whatWorked|moment|preference, value}] }`,
   applied to learner-context with caps/dedupe/sanitization. Honest "I'll
   remember that" becomes mechanically true. (Trained with restraint — most
   turns write nothing.)
2. **No sense of time.** No `lastSessionAt`, no session log — the greeting
   can't say "it's been three weeks; no ground lost" and the tutor can't
   reason about gaps, frequency, or arcs.
   → **`voice.sessions[]` ring (cap 60)**: `{date, minutes, takes, focusAxis,
   oneLine}` + `lastSessionAt`, written at session end; greeting becomes
   gap-aware; `focusHistory` derives from it.
3. **No identity-moments log.** "Got ma'am'd on the phone" is the realest
   data the product has, and it currently evaporates (only whatWorked catches
   a shadow of it).
   → **`voice.moments[]` (cap 40)**: `{kind: gendered-right|hard-moment|
   milestone, text, date}` — fed by memory_ops + real-sentence outcomes;
   surfaced at anniversaries and plateaus.
4. **whatWorked has no relevance.** Cap-10 recency list; the memo block shows
   the 3 newest even when today's focus is resonance and the relevant win was
   about resonance three weeks ago.
   → tag entries `{text, axis?, date}`; the memo picks current-focus matches
   first (deterministic, no embeddings).
5. **Card store is per-process memory** (cards die on kernel restart). Low
   severity — the real-sentence card re-derives from learner-context. Noted,
   not built now.
6. **Export/delete is API-only.** The data-dignity affordance should one day
   be visible in the app. Noted for the settings surface, not now.

## What gets built now (upgrades 1–4)

Runtime (transvoice-app): memory-ops validator + applier wired into both coach
paths beside card-ops; sessions ring + lastSessionAt + gap-aware greeting;
moments log; whatWorked tagging + relevance pick; memo block gains
`daysSinceLastSession`, `focusHistory`, relevant-wins. The v3.1 dataset then
teaches the model to *use* all of it (memory_write + multi_day_arc modes).
