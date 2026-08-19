# Feminization Foundations v1 — Runtime Audit

> **Post-audit wiring note (2026-08-17, checkpoint minor M5):** this audit
> is a frozen snapshot at HEAD `53cf6b9` (pre-P1/P2). Wiring landed AFTER
> this snapshot: the certified controller shadow witness inside `coachingTurn`
> (`femV1ControllerTurn`), the coaching barrel fem-v1 exports, the beginner
> card, cue-served lifecycle (this file's "does not exist" row is stale),
> and both vertical-loop proofs. For current wired-vs-unwired truth read
> `FEMINIZATION_V1_STATUS.md` (live ledger) — this file is kept as the
> P0-003 historical record.

**Task:** TV-FEM-P0-003 · **Date:** 2026-08-17 · **Branch:** `fem-v1/p0-audit-freeze` · **Head at audit:** `53cf6b96f00217ac4f7f60122e6a71e464adce4f`
**Method:** three independent read-only call-site traces (gateway runtime, learner persistence, UI/eval reachability), every load-bearing negative spot-verified by grep against primary sources. Reachability is never inferred from imports or file existence. Vocabulary: ACTIVE_RUNTIME / SHADOW_RUNTIME / IMPLEMENTED_UNWIRED / TEST_OR_SPEC_ONLY / LEGACY / EXPERIMENTAL / UNKNOWN.

## Executive summary

The production phone path (`POST /voice/coach/runtime` → `generateRealtimeCoachReply` → `coachingTurn`) computes target-metric work **every turn in shadow only**. Witness emission is the single target-metric output that reaches production storage/journal. The active application path, beginner mastery store, motor map, and pending-trial lifecycle are fully implemented and tested but **never invoked by any production caller**. The beginner feedback module and the FEM-v1 beginner card flow are not wired to any surface. No production path can currently activate learner-facing target-metric coaching — consistent with the plan's "off/shadow" posture.

## Audit table

| Module | Imported by | Executed in buffered | Executed in SSE | Writes state | User-facing | Tested | Verdict |
|---|---|---|---|---|---|---|---|
| target-metric runtime (buffered) | coaching/index.js:130 (via voice-standalone-runtime.js:5462) | ✔ every turn | — | no (shadow) | no | ✔ | **SHADOW_RUNTIME** |
| target-metric runtime (SSE) | voice-standalone-runtime.js:5708 | — | ✔ every turn (hardcoded `mode:'shadow'`) | no | no | ✔ | **SHADOW_RUNTIME** |
| mode resolution | default `'shadow'` (coaching/index.js:99); buffered call passes no mode; SSE hardcodes `'shadow'`; **no env/config/voiceState override exists; no caller anywhere passes `'active'`** | — | — | — | — | ✔ | **SHADOW_RUNTIME (only)** |
| active application (`applyTargetMetricDecision`) | target-metric-runtime.js:149 (behind `mode==='active'`) | never | never | would mutate signal | would be | ✔ | **IMPLEMENTED_UNWIRED** |
| witness emission (`coach_target_metric_shadow` + `targetMetricShadowWitness`) | voice-standalone-runtime.js:5538-5543 (buffered), :5714-5719 (SSE), :5405 (eval NDJSON when `evalPath` set) | ✔ | ✔ | journal + eval NDJSON | no | ✔ | **ACTIVE_RUNTIME** |
| shadow-witness eval/replay readers | GET /voice/eval/session/:id, /analytics, POST export-golden (voice-standalone-runtime.js:10953-10973); offline `eval/target-metric-shadow-report.js` | routes live | — | reads | operator-only | ✔ | **ACTIVE_RUNTIME** (live rows require `VOICE_STANDALONE_EVAL_ENABLED`; default off per .env.example:50-51) |
| beginner mastery persistence (`getBeginnerMastery`/`updateBeginnerMastery`) | learner-context-service.js:1777,1782 — callers are tests only (learner-beginner-mastery-persistence.test.js:45-127) | never | never | would (learner JSON, survives target change by design) | no | ✔ | **IMPLEMENTED_UNWIRED** |
| motor map store + `learnFromCuePair` | learner-context-service.js:1721,1735; learnFromCuePair (bridge:323) — callers tests only | never | never | would | no | ✔ | **IMPLEMENTED_UNWIRED** (engine's `cueEffectMultiplier` read-hook runs but always receives `motorMap=null`) |
| pendingTrial / session state (`createPendingMotorTrial`/`settlePendingMotorTrial`) | motor-trial.js:137,293 — test-only callers; production slot wired (voice-session-state.js:284,1531) but never populated/consulted | never | never | would | no | ✔ | **TEST_OR_SPEC_ONLY** |
| cue-served lifecycle (FEM-v1 semantics) | **does not exist** (grep negative; nearest analog: session-scoped `voiceState.lastCueGiven`, runtime :3664-3669) | — | — | — | — | — | **TEST_OR_SPEC_ONLY** |
| beginner feedback (`beginner-feedback.js`) | imported only by its own test (verified grep) | never | never | no | would be | ✔ | **IMPLEMENTED_UNWIRED** |
| learner-context memo integration | signal-builder.js:897; snapshot feeds both coach paths (:5444, :5672) | ✔ | ✔ | yes (memo fields) | via LLM turn | ✔ | **ACTIVE_RUNTIME** (mastery/motor internals excluded: learner-context-service.js:665-683 strips motorMap as "deterministic controller state") |
| curriculum phase resolution | target-metric-runtime.js:41-62 | ✔ | ✔ | no | no | ✔ | **SHADOW_RUNTIME, degenerate**: nothing populates `masteryState`/`beginnerMastery` in production → always `DEFAULT_CURRICULUM_PHASE` (`pitch_foundation`) |
| beginner practice-card flow (LISTEN/TRY/RECORD/RESULT/NEXT) | general card loop ACTIVE (frontend lesson/controller.ts; practice-cards.js); FEM-v1 staged flow absent — `docs/BEGINNER_SESSION_FLOW.md` does not exist | partial (general loop) | — | no | general cards only | ✔ | **TEST_OR_SPEC_ONLY** for FEM-v1 semantics |
| VoiceTrainer output → coaching | via observations path (legacy adapter) | ✔ | ✔ | no | no | ✔ (175 tests) | **ACTIVE_RUNTIME** (through legacy observation adapter) |

## Key findings

1. **Phone path is buffered `/voice/coach/runtime`** (frontend api.ts:844; corroborated by the 2026-07-25 phone-turn incident note). The built frontend never calls the SSE `/voice/coach/stream` route.
2. **Shadow-only is structurally guaranteed today**, not merely default: no override mechanism exists anywhere (no env var, no config key, no voiceState field — grep-verified). Entering active mode requires new wiring, which is exactly the controller's job (P1-001).
3. **`server.js` contains zero target-metric call sites**; it only loads the runtime (:585). All integration lives in `voice-standalone-runtime.js` and `coaching/index.js`.
4. **Shadow witnesses bypass the persistent telemetry sink**: `coach_target_metric_shadow` goes to the console logger (voice-standalone-runtime.js:5538), not the `/voice/debug` bus — durable capture requires the eval NDJSON path (`evalPath` config).
5. **Shadow-never-learns is protected structurally, not by an in-function guard**: the motor-map/mastery writers are unreachable in both coach paths (no production caller passes `motorMap`/persistence). A finding for P1 wiring: once the controller lands, explicit mode guards in the writer path become necessary.
6. **Curriculum phase is degenerate in production**: always `pitch_foundation` because nothing populates mastery state — the mastery store that would feed it exists but is unwired.
7. `dist/assets` bundle contains no target-metric references; absence holds for both src and built artifacts.

## Proxy boundary

This audit is a static call-site trace on the frozen branch. It establishes wiring, defaults, and (non)invocation — not runtime log volume or live learner data. No live service was observed.

## Source traces

Gateway lane (L1), persistence lane (L2), UI/eval lane (L3): three xna-analyst runs on this branch, spot-verified 2026-08-17 by the primary (buffered call-site context, active-mode caller grep, beginner-feedback importer grep, memo exclusion grep — all confirmed).
