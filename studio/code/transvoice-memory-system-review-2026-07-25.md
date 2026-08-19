# TransVoice memory-system review

> **Historical pre-implementation audit — superseded.** The verdict and test
> counts below describe the system before the 2026-07-25 repair and must not be
> used as current status. Current contract and implementation evidence live in
> `docs/VOICE_COACH_MEMORY_CONTRACT.md` and
> `studio/code/transvoice-memory-repair-implementation-2026-07-25.md`.

Date: 2026-07-25
Scope: the application’s learner memory, spoken-Coach continuation memory,
runtime session memory, preset identity, recall/write paths, learner controls,
recovery, and memory evaluations.

## Verdict

The foundation is good, but the memory system does **not yet fully do what the
TransVoice Coach needs it to do**.

It reliably persists bounded learner signals on the ordinary path, protects raw
audio from learner memory, keeps invalid measurements out of mastery, isolates
acoustic history and baselines by exact target identity, and safely gives the
model a compact learner memo. The focused memory suite is healthy: 111/111 tests
passed. A live behavioural probe also kept hard moments private in 5/5 cases and
kept memory-operation markup out of speech in 5/5 cases.

The product-level contract is weaker:

1. the compact Coach checkpoint cannot recover the lesson if its referenced
   runtime session is missing;
2. “forget” leaves several kinds of learner data and all runtime transcripts
   behind;
3. internal user/coach messages are durably stored despite the voice-only,
   no-transcript Coach contract;
4. the active preset identity can disagree across the learner profile,
   checkpoint, and authoritative session;
5. a corrupt learner profile silently becomes a blank profile and can then be
   overwritten;
6. due reviews are not recomputed when the learner returns;
7. target-dependent mastery and coaching cues leak across different target
   voices;
8. stored coaching preferences are mostly prompt suggestions, not mechanically
   enforced behaviour;
9. the explicit End action does not update the session-history clock used for
   continuity;
10. the evaluator neither isolates itself from the live session store nor gates
    several immutable Coach laws.

Overall assessment: **2.5/5 — suitable core, incomplete trust contract**.

## Evidence notation

- **[V]** Executed or directly inspected at runtime.
- **[R]** Read and traced in source.
- **[A]** Reasoned consequence from verified source/runtime facts.
- **[Q]** Not proved in this review.

## What the memory system needs to guarantee

The current voice-only Coach contract gives memory eight jobs:

1. Resume the same spoken lesson at the same line with the exact selected
   uploaded voice preset.
2. Remember who the learner is, what helped, what was difficult, the current
   learning stage, and explicit coaching preferences.
3. Use those memories faithfully without inventing facts or reciting vulnerable
   moments.
4. Keep voice-dependent learning attached to the correct target voice.
5. Remain a spoken lesson, not a durable text-message history.
6. Give the learner real inspect/edit/forget controls outside the two-control
   Coach surface.
7. Survive restarts, bounded-store eviction, partial writes, and corruption
   without silently changing voice or erasing identity.
8. Prove those guarantees through isolated tests and live behavioural gates.

The implementation meets parts of 1–4 on the ordinary path. It does not yet
meet 5–8, and edge cases break 1 and 4.

## Current architecture

| Surface | Current role | Live observation | Assessment |
|---|---|---:|---|
| `learner-context/students/<id>.json` | Canonical longitudinal learner profile | 61,506 bytes; mode `0600`; schema `sloane.learner_context.v5` | Good local-first base |
| `learner-context/events/<id>.jsonl` | Append-only categorical audit history | 1,096 rows; mode `0600` | Useful, but unbounded |
| `sessions.json` | Authoritative rich runtime sessions | 250/250 records; 3,112,181 bytes; retention days `0` | Essential but over-retentive |
| `voice.coachCheckpoint` | Compact locator and continuation record | Present, stopped, points to an existing current session | Safe shape, weak recovery |
| `voiceState.coachThread` | Recent model context inside each session | 105 sessions, 414 messages, 40,976 text characters; max 12/session | Violates minimal voice-only memory |
| Structured-memory substrate | Optional mirror for metrics/mastery/events | Skipped for `default-voice-learner`; returned enrichment has no production consumer | Duplicate/dead complexity |
| `LearnerMemoData` | Bounded personalization injected into the model | Name/pronouns/topics/goals/wins/struggles/preferences/review/continuity | Correct read seam; obedience is probabilistic |

The active live checkpoint and its runtime session currently agree on
`custom-reference` and on the bound reference clip. However, the longitudinal
profile still says `custom-handmade`. The current session works; the three
records do not represent one canonical truth.

## What is working well

### Local durability and bounded shape

**[R]** Learner directories and files are created with private modes; writes use
a temporary file followed by rename:

- `backend/learner-context-service.js:165-175`
- `backend/learner-context-service.js:190-205`

**[V]** The current profile, event ledger, and session store are all mode `0600`.

**[R]** Most learner collections have explicit caps and normalization:
24 recent attempts, 12 review items, 12 struggles, 12 targets, 60 session-ring
entries, 40 moments, 10 preferences, and 10 “what worked” entries
(`backend/learner-context-service.js:54-74`).

### Measurement honesty

**[V]** Focused tests prove measurement-invalid attempts remain audit records but
do not update mastery, review, struggles, wins, or the target baseline.

**[R]** Exact target keys are persisted on attempts and used to select history
and baselines. The custom-target test correctly proves that two uploaded targets
sharing one base label do not share acoustic history or baselines
(`backend/learner-context-v4.test.js:236-287`).

### Safe recall and memory writing

**[R]** `buildLearnerMemo` bounds and selects identity, goal, wins, struggles,
preferences, moments, review, and time/focus context. A hard moment is reduced to
a sensitivity flag, not copied into the memo
(`backend/coaching/signal-builder.js:655-765`).

**[R]** The renderer explicitly treats the memo as untrusted data, not prompt
authority (`backend/coaching/renderer-client.js:67-71`,
`backend/coaching/renderer-client.js:365-370`).

**[R]** Free-text topic/hobby/win/moment writes require overlap with what the
learner actually said, and trailing memory-operation blocks are stripped before
speech (`backend/coaching/memory-ops.js:39-54`,
`backend/voice-standalone-runtime.js:2218-2244`).

**[V]** The 2026-07-25 live behavioural evaluation scored:

| Metric | Result |
|---|---:|
| Name use | 4/5 |
| Preference obedience | 4/5 |
| Review surfacing | 2/5 |
| Hard-moment safety | 5/5 |
| Faithful/no-leak operations | 5/5 |

This is a real improvement over the two 2026-06-15 runs: name use rose from
0–20% to 80%, preference obedience from 60% to 80%, and review surfacing from
0–20% to 40%.

## Findings

### P0 — A checkpoint cannot recover its own lesson

**Location:** `backend/voice-standalone-runtime.js:5026-5044`

> `const checkpointSession = ... sessions.get(priorCheckpoint.sessionId) ...`
> `const session = requestedSession || checkpointSession || createSession({`
> `targetPreset: normalizeText(body.targetPreset, 80) || 'cute-feminine'`

**[R]** Start resumes only when the checkpoint’s session still exists in
`sessions`. Otherwise it creates a blank built-in session. None of the lesson,
practice, or exact preset fields already present in the checkpoint are used to
rehydrate it.

**[V]** An isolated falsification seeded a stopped checkpoint containing a
`custom-reference` preset, lesson, and practice line but omitted its runtime
session. Start returned:

- `targetSource: built-in`;
- no bound reference;
- no practice line;
- no lesson.

**Bad outcome:** a process/store failure or eviction can silently change the
tutor away from the selected uploaded voice and discard the learner’s place.
That violates both exact-preset and spoken-lesson continuity laws.

**Look-around:** the checkpoint itself already contains bounded lesson,
practice, and preset identity fields
(`backend/learner-context-service.js:508-559`). The missing piece is recovery
logic, not missing data.

**Recommendation:** make the checkpoint a self-sufficient recovery record.
When its session is absent, reconstruct a new rich session from the checkpoint,
resolve the exact uploaded reference, and preserve lesson/practice position. If
the exact reference cannot be resolved, fail closed and remain silent—never
fall back to a built-in voice.

### P0 — “Forget” is not complete

**Location:** `backend/learner-context-service.js:1399-1420`

> `moments: [], coachPreferences: [], whatWorked: [], struggles: [], avoid: [],`
> `sessions: [], conceptStats: {}, reviewSchedule: {}, reviewQueue: [],`
> `realSentences: [], lastSessionAt: '', coachCheckpoint: null`

**[R]** The reset clears the listed fields but retains:

- `recentAttempts`;
- `targetHistory`;
- target baselines;
- `lastReference`;
- `notepadHandoff`;
- persisted standalone sessions and `coachThread`;
- the JSONL event ledger;
- any mirrored structured-memory records.

**[V]** An isolated reset probe confirmed one recent attempt, one target-history
entry, one baseline, the last reference, and notepad handoff all survived.

**Bad outcome:** the API presents a forget/reset action that does not forget the
learner’s voice history or internal conversation text.

**Look-around:** `forgetLearnerContext` invokes only the profile reset/removal
methods (`backend/learner-context-route-handlers.js:179-197`); it has no
cross-store transaction.

**Recommendation:** define two explicit operations:

1. **Reset coaching personalization** — preserve only clearly disclosed identity
   and chosen preset.
2. **Delete all learner data** — delete/quarantine profile, events, sessions,
   transcripts, attempt references governed by this store, and structured
   mirrors in one idempotent transaction with a deletion receipt.

### P1 — Internal conversation messages are durably archived

**Locations:**

- `backend/voice-standalone-runtime.js:571-582`
- `backend/voice-session-state.js:1290-1295`
- `backend/coaching/renderer-client.js:405-411`

> `return cloneJsonValue({ ...value, id })`

> `normalized.coachThread = ... .slice(-12)`

> `const recentHistory = (conversationHistory || []).slice(-4)`

**[R]** The session store clones and writes the complete session. The normalized
voice state retains the last 12 user/coach messages, and the renderer feeds the
last four back to the model.

**[V]** The live store contains 414 durable messages across 105 sessions,
totalling 40,976 text characters. Age retention is disabled
(`retentionDays: 0`); only the 250-session cap removes old records.

**Bad outcome:** the Coach remains visually voice-only, but its durable state is
still partly a text-message archive. It also makes complete deletion harder.

**Look-around:** the compact checkpoint correctly rejects transcript/thread/raw
model fields. The leak is in the separate “authoritative” session object.

**Recommendation:** keep only the current turn’s transcript and short working
context in memory. Persist a bounded semantic continuation summary—lesson point,
learner intent, unresolved coaching action, and current phrase—rather than
verbatim messages. Purge working text on End or after a short recovery TTL.

### P1 — Preset identity has three writable truths

**Location:** `backend/voice-standalone-runtime.js:3938-3987`

> `session.voiceState = ... { targetPreset, targetSource, targetVoiceProfile, ... }`
> `checkpointCoachSession(session, ..., 'preset-selected')`

**[R]** Preset selection updates the rich session and checkpoint. The learner
profile’s target identity is updated later, only when a voice attempt is
recorded (`backend/learner-context-service.js:1751-1769`).

**[V]** Current live state:

- learner profile: `custom-handmade`;
- checkpoint: `custom-reference`;
- checkpointed runtime session: `custom-reference`.

**Bad outcome:** recall, baseline selection, and restart code can consult
different active targets depending on which record they read.

**Recommendation:** introduce one canonical immutable `targetBinding`
(`presetId`, `referenceClipId`, `targetKey`, `targetSource`,
`targetProfileId`, `analysisVersion`, optional content hash). Write it at preset
selection, refer to it from session/checkpoint/profile, and enforce an invariant
that an active Coach cannot have mismatching bindings.

### P1 — Corruption silently becomes a blank learner

**Location:** `backend/learner-context-service.js:178-205`

> `} catch { return fallback; }`

**[R]** Any JSON read/parse failure returns the same fallback used for a missing
file. A subsequent mutation writes a normalized blank profile over the original
path. There is no quarantine or previous generation.

**[V]** An isolated malformed-profile probe returned a fresh default profile;
the next checkpoint mutation replaced the malformed file, with no backup or
quarantine artifact.

**[R]** The session store follows a similar fail-to-empty path on an unreadable
file (`backend/voice-standalone-runtime.js:663-680`).

**Bad outcome:** disk damage can look like “this learner is new” and become
irreversible on the next ordinary write.

**Recommendation:** distinguish missing from corrupt. On corruption:

- stop writes to that record;
- move/copy the bad generation to a timestamped quarantine;
- restore a validated previous generation if available;
- emit a categorical health witness;
- expose a recovery status rather than silently resetting.

### P1 — Due reviews go stale between attempts

**Locations:**

- `backend/learner-context-service.js:619-647`
- `backend/learner-context-service.js:1650-1660`
- `backend/learner-context-service.js:1810-1815`

> `const reviewQueue = buildReviewQueue(evaluations, reviewSchedule, conceptStats, nowValue)`

> `const reviewQueue = mergeReviewQueue(profile.voice.reviewQueue)`

**[R]** Overdue concepts are calculated when an attempt is written. Reading a
snapshot only returns the previously stored queue; it does not compare
`reviewSchedule.dueAt` with the current clock.

**[V]** An isolated probe recorded a correct concept, advanced the clock past
its SM-2 due date, and read a snapshot. The review queue remained empty.

**Bad outcome:** a learner can return on the correct review day and the tutor
does not know the item is due.

**Recommendation:** derive the due queue from schedule + mastery + `now()` on
every snapshot, merging any immediate unresolved items. Store the schedule, not
the time-sensitive derived view.

### P1 — Pedagogical memory is only partly target-scoped

**Location:** `backend/learner-context-service.js:1650-1671`

> `updateConceptStats(profile.voice.conceptStats, evaluations)`
> `updateReviewSchedule(profile.voice.reviewSchedule, evaluations, nowValue)`
> `...profile.voice.struggles`
> `mergeWhatWorked(derivedWins, profile.voice.whatWorked, ...)`

**[R]** Attempts, target history, and baselines have exact target keys.
`conceptStats`, `reviewSchedule`, `reviewQueue`, `struggles`, `avoid`, and
`whatWorked` are global fields.

**[V]** An isolated target-switch probe:

1. recorded a `cute-feminine` attempt with a pitch win and pitch struggle;
2. switched to `teacher` and recorded an attempt with no evaluations;
3. observed both pitch concepts, the old struggle, and the old win in the
   `teacher` snapshot, while the attempts correctly had two distinct target
   keys.

**Bad outcome:** coaching cues and mastery can be inherited from a materially
different target voice even though acoustic comparisons are correctly isolated.

**Recommendation:** explicitly classify memory as either:

- `global` — transferable vocal-health or learning-style knowledge; or
- `target:<targetKey>` — target-dependent measurements, mastery, reviews,
  struggles, and wins.

Do not infer transfer merely because two presets share a base label.

### P1 — Learner identity/edit controls are disconnected

**Locations:**

- `backend/learner-context-service.js:1237-1275`
- `backend/learner-context-route-handlers.js:131-157`
- `frontend/src/voice/api.ts:890-989`

**[R]** The service supports `pronouns`, `direction`, `goal`, and `avoid`.
The HTTP handler forwards only `displayName`, `topics`, `hobbies`, and
`whatWorked`. The production frontend API exposes reads, dataset controls, and
notepad handoff, but no profile-update or forget method.

**[V]** A route-level probe sent all supported identity fields. Only
`displayName` changed; pronouns, direction, goal, and avoid were dropped.

**Bad outcome:** the learner cannot correct important identity memory through
the app, and the forget endpoint is not reachable from the production client.

**Recommendation:** add a small privacy/memory settings surface outside Coach.
It must not add buttons to the one-screen spoken Coach. Provide:

- “What the tutor remembers” summary;
- correction of name/pronouns/goal/coaching style;
- removal of individual preferences/moments;
- reset personalization;
- delete all learner data/export receipt.

### P1 — Remembered preferences are not hard runtime constraints

**Locations:**

- `backend/coaching/signal-builder.js:708-761`
- `backend/coaching/renderer-client.js:365-370`
- `frontend/src/voice/coach-speech.ts:591`

**[R]** Preferences are serialized into `LearnerMemoData` and left for the
language model to obey. For example, “Prefers a slower coaching pace” is not
mapped to TTS speaking rate or deterministic turn length.

**[V]** Live preference obedience was 4/5. The “direct feedback” learner failed
both name use and preference obedience. The evaluator marks slower pace as
unscorable rather than checking audible pacing.

**Riskiest write path:** model-authored preference operations are exempt from
the grounding gate:

> `Preferences are EXEMPT`
> `REVEAL_MATCH_KINDS = ... ['moment', 'whatWorked', 'topic', 'hobby']`

(`backend/coaching/memory-ops.js:39-45`, `backend/coaching/memory-ops.js:359-370`)

That exemption is safe for the deterministic closed-list extractor, but the same
apply path also accepts model-authored preference operations.

**Recommendation:** store canonical preference IDs, not arbitrary coaching
sentences. Map them mechanically:

- slower pace → TTS rate + shorter turns + longer response spacing;
- brief → response-length budget;
- fewer corrections → policy correction cap;
- concrete over imagery → cue-vocabulary gate;
- gentle/direct → deterministic tone and phrase constraints.

Accept a model-authored preference only when it matches the learner’s utterance
or a deterministic classifier/extractor independently confirms it.

### P1 — End does not update the continuity clock

**Location:** `backend/voice-standalone-runtime.js:5086-5100`

> `checkpointCoachSession(... state: 'stopped', stoppedAt: Date.now() ...)`
> `persistSessionsSafely()`

**[R]** The explicit Coach End action checkpoints and persists the session but
does not call `writeSessionRingEntry`. That write happens on the legacy full
session-end route, page hide, or stale-session sweep
(`backend/voice-standalone-runtime.js:897-956`,
`backend/voice-standalone-runtime.js:4905-4927`).

**[V]** Live clocks disagree:

- `lastSessionAt`: 2026-07-25T03:15:28.422Z;
- explicit checkpoint `stoppedAt`: 2026-07-25T06:18:24.452Z;
- checkpoint `lastActivityAt`: 2026-07-25T06:35:07.260Z.

**Bad outcome:** the next learner memo can calculate the return gap from an
older session, even though the learner explicitly ended a newer Coach segment.

**Recommendation:** make End authoritative for the continuity clock. Either
derive return-gap memory from checkpoint `stoppedAt`, or write an idempotent
resumable segment entry on End without pretending the continuing lesson was
completed.

### P2 — The structured-memory mirror is duplicate and effectively unused

**Location:** `backend/learner-context-service.js:674-815`

**[R]** The file profile remains the source of truth. The substrate is
best-effort, silently skips the actual default phone learner, and returns
`masterySkills`/`reviewDue` only as optional enrichment. A repository-wide
production-code search found no consumer of that enrichment outside this
service.

**[R]** Reset/forget has no deletion or reconciliation path for mirrored
structured records.

**Bad outcome:** the application pays complexity and data-governance cost for a
second memory system that cannot currently improve the default learner’s Coach.

**Recommendation:** choose one:

1. disable/remove the mirror for this single-learner product until a real
   consumer exists; or
2. make it an intentionally governed recovery/read model with health,
   reconciliation, target scoping, and deletion receipts.

The simpler first option fits the current app.

### P2 — The memory evaluator can pass while violating Coach laws

**Location:** `backend/eval/memory-use-eval.js:599-623`

> `hard_moment_safety is the ONLY hard gate today`

**[V]** The current evaluation passed its gate while one generated response
said:

> “We can start with a quick warm-up…”

This violates the immutable no-forced-warm-up/no-padding Coach law, but the
evaluator does not score it. Review surfacing was only 40% and is report-only.

**[R]** The evaluator seeds production learner-context storage, starts real
runtime sessions, removes only learner profile/event files in `finally`, and
does not delete those runtime sessions
(`backend/eval/memory-use-eval.js:395-451`,
`backend/eval/memory-use-eval.js:563-594`).

**[V]** This review removed five synthetic `eval-mem-*` sessions after the run
and verified zero remained. The store returned to 250 real sessions. No
persistent record loss occurred in this run, but an interrupted evaluator plus
runtime restart could persist synthetic sessions while old capped records are
absent from disk.

**Recommendation:** run the evaluator against isolated learner and session
stores. Delete runtime sessions in `finally`. Gate:

- no forced warm-up;
- no coach-suggested stop/break;
- no message/chat framing;
- selected preset identity retained;
- preference obedience;
- due-review surfacing;
- no invented learner memory;
- hard-moment safety;
- no operation markup in speech.

### P2 — Retention, schema, and documentation need consolidation

**[R]** The event ledger is append-only with no rotation/compaction. The live
profile is rewritten synchronously at each update, including frequent
checkpoint transitions. This review did not measure a material latency problem;
the read-only live profile request completed in 4 ms, so optimization should
follow instrumentation rather than assumption.

**[R]** The profile constant is still `sloane.learner_context.v5` while several
implemented fields and comments call themselves v6.

**[R]** Older product documents still mention optional chat, warm-up stages, and
coach-led closing even though the current immutable Coach contract rejects all
three. The live evaluator’s warm-up output demonstrates that this drift reaches
behaviour, not just prose.

**Recommendation:**

- rotate/compact the JSONL ledger by count/size while retaining a signed or
  hashed summary;
- keep one previous validated profile/session generation;
- measure p50/p95 profile/checkpoint write latency and coalesce redundant
  lifecycle writes only if needed;
- publish one canonical `VOICE_COACH_MEMORY_CONTRACT.md`;
- advance the schema with an explicit migration when target scoping and
  deletion semantics change;
- add contract tests/lints for obsolete chat/warm-up/stop language.

## Separate finding: the developer/project memory also needs maintenance

This is distinct from the learner memory used by the Coach, but it affects how
reliably future development sessions resume TransVoice work.

**[V]** The current structured project pack contains rich, high-quality recent
incident events, including deployed fixes, exact test receipts, protected
product laws, and explicit “do not retry” notes.

**[V]** Its compiled front door is stale:

- project goal is blank;
- status is still `planned`;
- current focus, next actions, open questions, and last milestone are empty;
- the design/state reason is still `bootstrap`;
- the pack reports no dead branches even though recent events contain several
  detailed failed approaches and “do not retry” instructions.

**Bad outcome:** a fresh agent can retrieve the right facts only by reading and
reconciling many raw events. The fast orientation layer can incorrectly imply
that the deployed app is still merely planned.

**Recommendation:** after this audit, maintain one compiled TransVoice project
state containing:

- immutable Coach product laws;
- currently deployed bundle/service state;
- the active problem and next verification crossing;
- known failures with root cause and do-not-retry guidance;
- authoritative report paths;
- phone-required versus phone-independent work;
- explicit supersession links when a diagnosis or metric is corrected.

The event ledger should remain the detailed history; the compiled project state
should be the short, current truth.

## Capability scorecard

| Capability | Score | Reason |
|---|---:|---|
| Local persistence | 4/5 | Private modes, atomic profile writes, bounded main collections |
| Ordinary-path Coach restart | 4/5 | Existing checkpoint session resumes and exact reference currently agrees |
| Missing/corrupt-session recovery | 1/5 | Checkpoint is locator-only; fallback silently becomes built-in |
| Learner-fact capture | 4/5 | Deterministic preference extractor + bounded model memory operations |
| Safe/faithful recall | 4/5 | Hard moments protected; prompt injection defended; free-text grounding |
| Actual memory use | 3/5 | Name/pref 80%; review 40%; no deterministic preference enforcement |
| Target isolation | 2/5 | Acoustic history good; mastery/cues/review global |
| Voice-only/minimal retention | 2/5 | No transcript in learner profile, but durable session threads remain |
| Learner control and deletion | 1/5 | Partial backend endpoint, incomplete reset, no production client control |
| Corruption/recovery | 1/5 | Silent blank fallback and overwrite risk |
| Evaluation quality | 3/5 | Useful live behavioural harness, weak gates and no store isolation |
| Developer/project-memory orientation | 3/5 | Excellent raw events, stale compiled state |

## Recommended implementation order

### Slate 1 — Continuity and exact voice, first

1. Add failing tests for a missing checkpoint session.
2. Rehydrate from the closed checkpoint using the exact target binding.
3. Fail closed if the uploaded reference is unavailable.
4. Add a cross-store target-binding invariant and health witness.

Acceptance: deleting/evicting the rich session cannot produce a built-in tutor,
and the exact preset/line/lesson are either restored or the Coach stays silent
with one actionable recovery state.

### Slate 2 — Privacy and truthful learner control

1. Replace persisted `coachThread` with a semantic continuation summary.
2. Keep raw current-turn text in memory only, with a short recovery TTL.
3. Implement cross-store reset/delete transactions.
4. Add memory settings outside the Coach screen.

Acceptance: after “delete all learner data,” no profile, event, session message,
structured mirror, or continuation transcript remains; the two-control Coach UI
is unchanged.

### Slate 3 — Correct learning memory

1. Compute due reviews on read.
2. Scope target-dependent mastery/review/struggle/win state by `targetKey`.
3. Distinguish transferable global learning preferences from target-specific
   acoustic learning.
4. Make End update the authoritative return-gap clock.

Acceptance: a due item surfaces after time advances without another attempt,
and switching presets cannot inherit target-specific mastery/cues.

### Slate 4 — Deterministic preference use

1. Replace free-text preference storage with canonical IDs + provenance.
2. Bind each ID to policy/TTS controls.
3. Require utterance grounding/corroboration for model-authored preferences.
4. Add audible slower-pace and correction-density tests.

Acceptance: every stored preference has a measurable runtime effect, not merely
a sentence in the model prompt.

### Slate 5 — Recovery and proof

1. Add corruption quarantine + previous-generation restore.
2. Isolate all evaluators from live learner/session stores.
3. Gate the immutable Coach laws.
4. Add retention/compaction health metrics.
5. Consolidate the canonical memory contract and schema migration.

## Verification receipts

### Focused automated suite

Command:

```bash
node --test \
  backend/learner-context-v4.test.js \
  backend/learner-context-coach-checkpoint.test.js \
  backend/learner-context-session-ring.test.js \
  backend/coaching/memory-ops.test.js \
  backend/coaching/memory-extract.test.js \
  backend/coaching/signal-builder-memo.test.js \
  backend/coaching/spaced-rep.test.js \
  backend/voice-coach-continuity.test.js \
  backend/voice-flow-session.test.js
```

Result: **111 passed, 0 failed, 0 skipped**, 232 ms.

### Read-only live smoke

Real HTTP entrypoints:

1. `GET /voice/standalone/readiness`
2. `GET /voice/learner-context/profile`
3. `GET /voice/standalone/sessions`
4. `GET /voice/standalone/sessions/:checkpointSessionId/export`

Result:

- readiness: 200, ready;
- learner snapshot: 200, checkpoint present;
- session list: 200;
- checkpoint session export: 200;
- checkpoint/session ID, target source, and reference clip all agreed.

### Isolated falsification coverage

| Case | Result |
|---|---|
| Missing rich session behind valid checkpoint | Failed continuity; blank built-in session |
| Reset learner memory | Retained attempts/history/baseline/reference/notepad |
| Time advances past SM-2 due date | Due review absent |
| Identity update through HTTP handler | Pronouns/direction/goal/avoid dropped |
| Malformed learner profile then mutation | Blank profile written; no quarantine |
| Switch between two target keys | Acoustic keys distinct; concepts/cues crossed targets |

### Live behavioural evaluation

Report:
`backend/eval/reports/memory-use-eval.2026-07-25T07-18-48-402Z.json`

Five synthetic learner profiles were removed automatically; five runtime
sessions required explicit cleanup and were removed. Zero synthetic learners or
sessions remain.

## Coverage and limits

Verified in this review:

- ordinary read/write normalization and caps;
- checkpoint shape and existing-session resume;
- missing-session resume failure;
- learner reset semantics;
- target identity drift;
- target-dependent memory leakage;
- due-review staleness;
- route field loss;
- corrupt-profile behaviour;
- persisted thread volume;
- live prompt-memory behaviour;
- live read entrypoints.

Not verified:

- recovery from a real power loss during rename;
- concurrent writes from multiple backend processes;
- multi-user structured-memory behaviour;
- Android-visible memory settings, because none exist;
- audible preference compliance such as slower TTS pacing;
- backup restoration, because no backup mechanism exists.

## Historical final review status

**VERIFIED review; implementation not performed.**

The system is safe enough to continue controlled development, but the five
highest-priority slates above should be treated as memory trust work, not polish.
The most urgent invariant is simple: **a missing record must never cause the
Coach to forget the learner’s exact chosen voice or silently substitute another
one.**
