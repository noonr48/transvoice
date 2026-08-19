# TransVoice Coach memory contract

Status: canonical
Effective: 2026-07-25

This document is the normative contract for the Coach and its learner memory.
When an older design, review, dataset note, prompt, or implementation comment
conflicts with it, this document wins.

## Product laws

1. Coach is a live, flowing, spoken TransVoice lesson. It is never a text chat,
   messaging interface, message history, or typed exchange.
2. The Coach screen is one no-scroll surface with exactly two LESSON controls:
   the preset selector and Start/End. Nothing may be added to that pair.

   AMENDED 2026-07-29 (owner). A third kind of control is now permitted, and
   exactly one of it: a NAVIGATION affordance that leaves the lesson. It exists
   because the app has a second surface — self-practice, a pure-sound list the
   learner opens when they are not in the state to want to talk — and there was
   otherwise no way to reach it.

   THE DISTINCTION IS THE POINT, AND IT IS LOAD-BEARING. A lesson control acts
   ON the lesson; a navigation affordance leaves it. The count law still binds
   the lesson pair at exactly two, so a future settings, help, history or
   diagnostics button is still refused — it would have to argue it is navigation,
   and it is not. This is deliberately NOT "exactly three controls": a raised
   number can be raised again by the same argument that raised it, whereas a
   category has an edge.

   Enforcement: lesson controls carry `data-coach-persistent-control` and are
   asserted to be exactly two (frontend/src/voice/coach-surface.test.ts,
   frontend/src/voice/standalone-dom.test.ts). The navigation affordance carries
   `data-coach-navigation` and is asserted separately at exactly one. Both
   assertions must keep passing; neither may absorb the other.
3. A preset is a named uploaded voice sample. Selecting it binds that exact
   sample as the tutor voice. No built-in, browser, or other stand-in voice may
   silently replace it.
4. Start begins or resumes the core lesson immediately. End pauses the same
   continuing lesson. Only the learner decides when to Start or End.
5. The tutor never inserts a forced warm-up, closing ritual, padding, scheduled
   break, rest recommendation, or suggestion to stop or return later. It may
   reduce vocal effort while the lesson remains active.
6. The single text canvas displays the verbatim practice sentence whenever one
   exists; a pronunciation spelling may appear only when no verbatim line
   exists yet — it never replaces the sentence, and the two are never stacked
   as a conversation-like pair. It is not a transcript or conversation surface.
7. Browser and Android text enlargement is honored. The fixed surface may
   choose a bounded content density, but it must not counter-scale an
   accessibility font enlargement back down.

## Durable memory boundary

Durable memory is a compact semantic checkpoint, not a recording of the
conversation. It may retain:

- identity explicitly supplied by the learner;
- the exact active target binding;
- current lesson/exercise position and current practice phrase;
- categorical mastery, review schedule, struggles, what worked, and preferences;
- bounded attempt measurements that passed the learning-validity gate;
- session boundary timestamps and categorical storage-health witnesses.

It must not retain:

- raw audio or audio encodings;
- speech transcripts or transcript previews;
- user/coach message history or `coachThread`;
- raw model prompts/replies;
- free-form preferences not grounded in the learner's words.

Working turn text may exist in process memory only while needed for the live
turn. End purges it after writing the compact checkpoint.

## Exact target invariant

`voice.targetBinding` is the canonical target record. Profile, checkpoint,
runtime session, acoustic attempt, and TTS must agree on:

- `presetId`;
- `referenceClipId`;
- `targetKey`;
- `targetSource`;
- `targetProfileId`;
- `analysisVersion`;
- direction and target bands.

Target-dependent mastery, review, struggle, avoid, and what-worked state is
stored under `learningByTarget[targetKey]`. Switching presets must never leak
learning state from another target.

If restart recovery cannot resolve and verify the exact uploaded preset from
the checkpoint, Coach fails closed and stays silent. It never falls back to a
different voice.

## Continuity

- A successful Start restores the same session when present and durably writes
  its canonical target binding before reporting success or accepting a turn.
- If the rich session is missing, the compact checkpoint may reconstruct it
  only after exact preset verification.
- End always stops capture immediately. A successful End also durably writes
  `learner-stopped`, refreshes the return-gap clock, keeps the lesson resumable,
  and does not mark it completed. A persistence failure is surfaced as a
  failure; it is never reported as a successful pause.
- Due reviews are derived from the schedule and current clock on every read.

## Preferences

Only canonical, learner-grounded preference IDs are durable:

- `slower-pace`;
- `brevity`;
- `fewer-corrections`;
- `concrete-over-imagery`;
- `gentle-tone`;
- `direct-feedback`.

Each ID has deterministic effects on response length, correction density, cue
vocabulary, tone, or tutor speaking rate. Preferences are not merely prompt
suggestions.

## Learner control

Memory controls live outside the two-control Coach surface:

- edit disclosed identity/profile fields;
- remove an individual preference or moment;
- reset coaching personalization while preserving explicit identity and the
  selected preset;
- delete all learner data across profile, event, and runtime-session stores,
  including prior, corrupt, temporary, and evaluation-ledger generations,
  returning an idempotent verified per-store receipt.

## Storage and proof

- Profile and session stores keep one previous valid generation.
- Corrupt primary files are quarantined. A valid backup is restored; otherwise
  writes are blocked until explicit recovery/deletion. Delete All scrubs every
  owned generation before persistence; after it verifies zero target records,
  an unrecoverably corrupt JSON store may be rebuilt as clean primary and
  backup generations. An unsupported schema remains blocked rather than being
  silently overwritten.
- The categorical event ledger is size-bounded and rotates with a SHA-256
  summary chain.
- Live runtime evaluation is disabled by default and records only categorical
  data when explicitly enabled. Raw prompt/reply capture is allowed only in an
  explicitly isolated evaluator with temporary stores. The owned ledger path
  remains part of Delete All even after live evaluation is disabled, so a
  dormant historical ledger cannot escape deletion.
- Storage health is exposed without learner content.
- Behaviour evaluators use isolated temporary learner/session/eval stores and
  gate the product laws, target integrity, due-review use, preference obedience,
  hard-moment safety, and operation-markup leakage. A report counts only when
  its complete planned learner/turn roster ran successfully; model-down,
  partial, skipped, or errored runs are non-evidence even when their command
  exits successfully.
