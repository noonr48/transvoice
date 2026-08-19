# Feminization Foundations v1 — Status Ledger

**Purpose:** This is the operational status record for the plan. Local agents must update it with exact SHAs, test commands, evidence, known gaps, and the next dependency. Do not use the PR description as the sole source of truth.

## Planning handoff snapshot — 2026-08-17

- Repository: `USER/transvoice-handover`
- Integration branch: `sol/target-metric-coaching-foundation`
- Draft PR: #1
- PR state at planning review: open, draft, mergeable
- PR size before the new plan-doc commits: 132 commits, 58 changed files, ~8,957 additions / 10 deletions
- Branch SHA before the new plan-doc commits: `2c0ff901746deea286b0f3f67927391615119085`
- Base: `main` at `9776ca0c0b0adf9a657a1641c56420769cd72d5d`
- Production-active v1 coaching: **blocked**
- Default development posture: **off/shadow**

### CI availability at handoff

GitHub Actions checks triggered by the planning commits are currently red **without executing any workflow steps**. GitHub's check annotation states that the jobs were not started because recent account payments failed or the Actions spending limit needs to be increased. This is an account/runner availability blocker, not retained evidence of a code/test failure.

Until Actions billing/runner access is restored:

- local agents must run the full Node and VoiceTrainer suites locally;
- exact commands and complete outputs must be retained in the task evidence;
- do not write “CI is green”;
- do not interpret the current GitHub red checks as a test regression;
- once Actions is restored, rerun both permanent workflows before any merge decision.

The integration branch is now a reference/freeze target. New implementation work should move to scoped branches after P0 is complete.

## Authoritative documents

- `../AGENTS.md`
- `FEMINIZATION_V1_MASTER_PLAN.md`
- `FEMINIZATION_V1_AGENT_EXECUTION.md`
- `FEMINIZATION_V1_BACKLOG.yaml`
- `FEMINIZATION_V1_DECISION_LOG.md`

## Known useful foundations to verify, not re-invent

| Area | Known direction | Verification required |
|---|---|---|
| Canonical evidence | freshness, target identity, analyzer version, usability, take kind | trace current runtime and rerun tests |
| Metric observation | confidence/provenance/comparison identity | verify current schema and users |
| Protected metrics | missing evidence cannot become verified success | rerun causal tests |
| Exact-next trial | no cherry-picking later attempts | verify served-cue runtime wiring |
| Controlled probes | same-probe/context gating | verify authoritative formant evidence still missing |
| Reachable targets | no default engineering step | verify no production caller bypasses this |
| Beginner mastery | learner-level persistence has been developed | trace persistence/runtime and review-due semantics |
| Beginner feedback | beginner-safe abstraction exists | trace whether actually served to UI |
| Motor map | verified successes affect cue prior | target-scoped lifetime needs later refactor |
| Shadow runtime | buffered and SSE parity reportedly exists | rerun parity and durable-eval audit |
| Safety | pain/throat pain/discomfort/effort etc. | verify complete canonical path |

## Critical current gaps

1. No single authoritative `feminization_v1` controller is proven to own the learner journey end to end.
2. Generic target-metric ranking must be hard-gated by curriculum phase before active use.
3. Controlled resonance lacks a validated authoritative stable-vowel F1–F3 evidence path and golden-corpus proof.
4. Served-cue → exact-next-trial → mastery/motor update needs end-to-end runtime verification.
5. Feedback fading/no-feedback retention needs to be proven in the actual learner flow.
6. Learner-general motor response needs separation from target-specific cue utility.
7. Acoustic detector validity has not been demonstrated by human-corrected held-out audio.
8. New cues remain review-required; no public active cue set is approved.
9. Beginner one-card UX and actual beginner-facing feedback integration need end-to-end proof.
10. Canonical deployment repository/lineage must be confirmed before production merge.
11. GitHub Actions runner access is currently blocked by billing/spending settings, so local retained test evidence is mandatory.

## Work package state

| Task | Status | Branch/commit | Evidence | Next |
|---|---|---|---|---|
| TV-FEM-P0-001 Record integration state | DONE 2026-08-17 | fem-v1/p0-audit-freeze @ bf1757b2abe309bf28ca0a6dea2a9b261e1288db | execution log below; clean tree; 139 ahead of main (9776ca0c), equal to sol/target-metric-coaching-foundation head | — |
| TV-FEM-P0-002 Re-run canonical suites | DONE 2026-08-17 (local; Actions billing-blocked) | bf1757b2 + 4 stale-fixture test repairs | fem-v1-p0-evidence/ logs retained; Node 662/662 green after repair (658/662 before); VoiceTrainer 175 passed + 110 subtests (httpx test dep was undeclared) | P0-003 |
| TV-FEM-P0-003 Runtime connectivity audit | DONE 2026-08-17 | fem-v1/p0-audit-freeze | `docs/FEMINIZATION_V1_RUNTIME_AUDIT.md` — 3 independent read-only traces, load-bearing negatives spot-verified by primary | P0-004 |
| TV-FEM-P0-004 Freeze/split draft | DONE 2026-08-17 | tag `fem-v1-integration-freeze` @ bf1757b2 | workflows classified validate-only (no self-mutating CI exists to remove); .bak only inside sealed r4/r5 preimage evidence (kept as history); main already contained (0 behind); scoped branch plan below | P1-001 |
| TV-FEM-P1-001 Authoritative controller | DONE 2026-08-17 — CERTIFIED (4 review cycles, cycle-4 VERDICT: pass) | fem-v1/controller @ 534414b | `feminization-v1-controller.js` + 28 tests; authority ladder safety→capture→difficulty→trial→advancement→phase→eligibility→ranking→approved-cue→serve; shadow non-mutating; invalid mode fails to shadow | P2 wiring |
| TV-FEM-P1-002 Metric eligibility | DONE 2026-08-17 — CERTIFIED (cycle-4 pass) | fem-v1/controller @ 534414b | `metric-eligibility.js` + 6 tests; composes feminization-v1-policy; no per-call-site weakening possible | P2 wiring |
| TV-FEM-P1-003 Mastery integration | AUDIT DONE / GAP NAMED 2026-08-17 | runtime-audit L2 trace + learner-beginner-mastery-persistence.test.js | acceptance already verified: target-change preserves (learner-level bucket), memo exclusion, reset clears, shadow structurally cannot update. REMAINING GAP: `review_due` mastery state does not exist in beginner-mastery.js (steps end at retention) — needs named/versioned derivation policy + tests | implement review_due on next controller work |
| TV-FEM-P2-001 Pitch calibration evidence | DONE 2026-08-17 | fem-v1/pitch-vertical @ 299357f | `pitch-calibration-evidence.js` + 6 tests: versioned baseline p10/p50/p90, comfortable-movement record in semitones with effort verification (unknown never comfortable), tracker uncertainty (ceiling/frames/confidence/octave risk), NO target derivation; capture-validity gate (not coaching gate); min 5 takes | P2-002 |
| TV-FEM-P2-002 Pitch reachable-target policy | DONE 2026-08-17 | fem-v1/pitch-vertical @ afb603e | `pitch-reachable-policy.js` + 7 tests: fem-v1.pitch.step.comfort-first.v1 — step = min(demonstrated comfortable movement, config cap); fail-closed refusals calibration_evidence_required / demonstrated_comfort_required (0.5 ST salience floor: jitter is not a glide) / tracker_uncertainty_too_high; integration to reachable_step_ready proven | review |
| TV-FEM-P2-003 Served-cue trial lifecycle | DONE 2026-08-17 (evidence stream; trial binding at wiring) | fem-v1/pitch-vertical @ e13f315 | `cue-served-lifecycle.js` + 7 tests: recordCueServed refuses shadow/unknown mode and non-approved review status outright; acknowledged serve within 10-min window required for eligibility; unknown ack time never eligible | review |
| TV-FEM-P2-004 Feedback fading + retention | DONE 2026-08-17 (also closes P1-003 review_due) | fem-v1/pitch-vertical @ 02a7605 | `feedback-schedule.js` + 9 tests: full_guide→post_take_only→hidden_guide→new_prompt; later-session retention_check before guide returns; unknown attempt count fails to full guide; masteryReviewState review_due after 30-day window (missing timestamp never fresh) | review |
| TV-FEM-P2-005 Beginner card | DONE 2026-08-17 (deterministic card builder; UI integration on fem-v1/beginner-ui) | fem-v1/pitch-vertical @ (this commit) | `beginner-session-card.js` + 7 tests: five-part card (focus/listen/try/result/next); safety-stop dominates whole card; capture failure neutral; jargon-audited on build (containsInternalJargon); technical detail opt-in; unknown state fails closed to neutral | UI branch + review |
| TV-FEM-P1-003 Mastery integration | CLOSED 2026-08-17 | fem-v1/pitch-vertical @ 02a7605 | review_due implemented in feedback-schedule.js (masteryReviewState) + persistence acceptance verified in runtime-audit L2 | — |
| TV-FEM-P3-001 Language pack | DONE 2026-08-17 | fem-v1/controlled-resonance @ 6df86fa | `language-packs/en-AU-v1.js` + 8 tests (flat glob placement): versioned en-AU-feminization-foundations-v1; IPA/lexical-set/prompt-byte-identical-to-registry; ALL entries phonetic_review_required with named pendingQuestions (TRAP/BATH, DRESS, THOUGHT); demo assets honest not_recorded slots; validateLanguagePack catches registry drift; prosody out of scope | P3-002 → review |
| TV-FEM-P3-002 Controlled-vowel evidence | DONE 2026-08-17 | fem-v1/controlled-resonance @ 1f419a9 | `controlled-vowel-evidence.js` + 17 tests (12 + 5 review-kill tests): stable segment (>=150ms), F0+F1-F3+optional F4 with per-formant confidence, estimator agreement (relative 5% tolerance; <2 estimates = unavailable, never passing), high-F0 risk (>=300Hz fails closed; derived from max pitch witness; null F0 invalid), track continuity required, identity gates, prompt/context/reliability gates, external registry release gate (default registry = research-only), explicit invalidityReasons, malformed input fails closed | cycle-3 docs confirm |
| TV-FEM-P3-003 Golden corpus | OWNER-INPUT GATE | — | requires real human/expert-corrected audio (pitch + formant + capture-invalid corpora); cannot be fabricated — owner decision on source/recording path | awaiting owner input |
| TV-FEM-P4 Integration | BLOCKED | — | — | pitch/resonance protection + phrase transfer |
| TV-FEM-P5 Motor split | BLOCKED | target-scoped map exists | migration design required | learner-general base + goal overlay |
| TV-FEM-P6 Validation/review | PARTIALLY AVAILABLE | shadow/replay foundations may exist | audit required | golden corpus + specialist review + pilot |
| TV-FEM-P7 Limited active | BLOCKED | — | release gates unmet | do not activate |

## Execution log

### 2026-08-17 — TV-FEM-P0-001 + TV-FEM-P0-002 (local agent, SSUSER3)

- Status: P0-001 complete; P0-002 complete (with 4 stale test fixtures repaired)
- Branch: `fem-v1/p0-audit-freeze` (clean tree; created from integration head)
- Head SHA at audit: `bf1757b2abe309bf28ca0a6dea2a9b261e1288db` (== `sol/target-metric-coaching-foundation`; 139 ahead of `main` @ 9776ca0c)
- Workflows on branch: `coaching-regression.yml`, `target-metric-coaching.yml` (P0-004 will classify self-mutating status); `.bak` debris only inside frozen r4/r5 preimage evidence dirs
- Tests run:
  - command: `node --test transvoice-app/backend/coaching/*.test.js` (deps via `npm install --prefix transvoice-app/backend --ignore-scripts --no-package-lock --no-audit --no-fund`)
  - result before repair: 662 tests / 658 pass / 4 fail (log: `fem-v1-p0-evidence/p0-002-node-coaching.log`)
  - result after repair: 662/662 pass (log: `fem-v1-p0-evidence/p0-002-node-coaching-repaired.log`)
  - command: `python -m pytest` in `transvoice-app/services/voice-trainer` (venv from requirements.txt + pytest + httpx — httpx was an undeclared test dependency of starlette TestClient)
  - result: 175 passed, 110 subtests passed (log: `fem-v1-p0-evidence/p0-002-voicetrainer-pytest.log`)
- Failure triage (all 4 Node failures): stale fixtures predating the 2026-08-17 detector-validation-registry externalization (commits 0e90b9e/cfc926b/82aca68). Laws intact; production gates fail closed as designed. Repairs (test-only, intent preserved/strengthened):
  1. `target-metric-runtime.test.js` — pitch observation fixture now carries `metricDefinitionVersion: 'voice-metrics-v4-formants'` so the default registry validates YIN (`decisionEligible: true`); previously the lookup missed and `decisionObservationCount` was 0.
  2. `detector-authority-integration.test.js` — expected reason updated to the current stronger gate `formant_detector_not_validated_for_shadow_decision` (registry witness present, `decisionEligible: false` — research-only), plus asserts the validation id and `activeReleaseEligible: false`.
  3.+4. `reachable-target-activation.test.js` — positive-path fixtures now inject a `selectedDetectorAuthority` with `activeReleaseEligible: true` (shape per `compactDetectorAuthority`), so the two reachable-step tests exercise the full release-validated path instead of implicitly bypassing the gate that did not exist when written; provenance test also asserts detector validation identity is recorded.
- Safety/privacy impact: none — no production code changed; all repairs strengthen or preserve the original law assertions (breathiness never outranks pitch foundation; reachable step + release validation required for active; provenance recorded; formants stay exploratory without validation witness).
- Known gaps: default registry has NO `activeReleaseEligible: true` entry (correct: human benchmark pending) → active coaching correctly impossible in default config; canonical deployment repo still unconfirmed; Actions billing block stands.
- Next dependency: TV-FEM-P0-003 runtime connectivity audit.

### 2026-08-17 — TV-FEM-P0-003 (runtime connectivity audit)

- Status: complete
- Method: three independent read-only call-site traces (gateway runtime, learner persistence, UI/eval reachability); every load-bearing negative re-verified by primary grep. Result: `docs/FEMINIZATION_V1_RUNTIME_AUDIT.md`.
- Headline verdicts: buffered + SSE target-metric runtimes = SHADOW_RUNTIME (mode not overridable anywhere; no caller ever passes 'active'); `applyTargetMetricDecision`, beginner-mastery store, motor map = IMPLEMENTED_UNWIRED; pendingTrial/cue-served FEM-v1 lifecycle = TEST_OR_SPEC_ONLY; witness emission + eval readers + memo integration = ACTIVE_RUNTIME; curriculum phase degenerate (always `pitch_foundation`) because nothing populates mastery state.
- Key structural facts: phone path is buffered `POST /voice/coach/runtime`; `server.js` has zero target-metric call sites; shadow witnesses go to console logger not the persistent telemetry sink (durable capture requires `evalPath`); shadow-never-learns is protected structurally (writers unreachable), so explicit mode guards become mandatory once the controller wires writers (P1).
- Safety/privacy impact: none (read-only audit). Eval routes sit behind `sensitiveRouteGuard` only.
- Known gaps: static trace only (no live service observed); L2 trace of the SSE tail beyond :5830 not exhaustive.
- Next dependency: TV-FEM-P0-004 freeze/split.

### 2026-08-17 — TV-FEM-P0-004 (freeze/split)

- Status: complete — P0 finished.
- Freeze: tag `fem-v1-integration-freeze` → `bf1757b2abe309bf28ca0a6dea2a9b261e1288db` (= `sol/target-metric-coaching-foundation` head; reference estate, never to merge wholesale).
- Workflows: both `.github/workflows/coaching-regression.yml` and `target-metric-coaching.yml` are validate-only (checkout → npm install → node --check/--test; `permissions: contents: read`; no source mutation, no push). No self-mutating workflow exists on this branch — nothing to remove. Actions runners remain billing-blocked; local retained logs stay the source of truth.
- Debris: `.bak` files exist only inside sealed preimage evidence dirs (`local-ssUSER3/work/transvoice-review-final-20260809-r4/r5/preimage-repo/**`) — historical evidence, deliberately kept. `transvoice-app/UNCOMMITTED-WORK-20260805.patch` is the preserved dirty-overlay capture — keep. No debris in source tree.
- Update from main: branch contains main fully (139 ahead / 0 behind @ 9776ca0c) — no-op.
- Canonical-repo decision (P0-004 item): **development canonical for FEM v1 = this repo (`USER/transvoice-handover`, fem-v1 lineage from the freeze tag)**. Production deployment lineage remains the DEVBOX tree (mirrored at SSUSER3 `~/projects/transvoice-app`, HEAD b359ba9 + 08-05 overlay); reconciliation of the two lineages is deferred to the P7 release gates — do not merge the estate wholesale (DECISION_LOG).
- Scoped branch plan (from the freeze tag, per master plan §18):
  1. `fem-v1/controller` — TV-FEM-P1-001/P1-002 (authoritative controller + metric eligibility) then P1-003 mastery wiring;
  2. `fem-v1/pitch-vertical` — P2 slice;
  3. `fem-v1/controlled-resonance` — P3 language pack + vowel evidence + golden corpus;
  4. `fem-v1/motor-persistence` — P5 motor split;
  5. `fem-v1/beginner-ui` — P2-005/P4 card.
- Safety/privacy impact: none (tag + docs only).
- Known gaps: none for P0.
- Next dependency: TV-FEM-P1-001 (authoritative feminization controller) on `fem-v1/controller`.

### 2026-08-17 — TV-FEM-P1-001 + TV-FEM-P1-002 (controller + hard metric eligibility)

- Status: implemented, full suite green; independent review pending.
- Branch: `fem-v1/controller` (cut from `bee0e11`, contains freeze-tag ancestry + repaired suite).
- Implementation:
  - `backend/coaching/feminization-v1-controller.js` — `resolveFeminizationV1Turn({safetyState, captureState, curriculumState, masteryState, goalProfile, capabilityProfile, observations, motorResponseMap, goalCueOverlay, pendingTrial, sessionContext, mode, cueResolver})` returning exactly one action in fixed precedence: stop_for_safety → repair_capture → reduce_difficulty (self-report cost ≥ 6, named policy constant) → verify_attempt (pending trial resolved before new cue) → collect_calibration/teach_awareness (early phases never correct) → advance_phase (only with external authorization + sequential) → end_block/serve_exercise after hard eligibility + deterministic ranking (importance, controllability, stable order). Cue serve requires `approved_internal|approved_limited_active` review status (default `clinical-review-required` cues are structurally unservable); `served`/`trialRequested` only in active mode — shadow computes the same decision but can never earn causal credit.
  - `backend/coaching/metric-eligibility.js` — hard gate composing `feminization-v1-policy`; research-only dimensions never enter any phase's ranking; controlled-resonance requires verified context; unknown phase normalizes (fail-safe).
- Tests run:
  - `node --test backend/coaching/metric-eligibility.test.js` → 6/6 pass
  - `node --test backend/coaching/feminization-v1-controller.test.js` → 15/15 pass (TDD: written first, red on missing module)
  - `node --test backend/coaching/*.test.js` → 683/683 pass, 0 skipped
- Runtime reachable: NOT yet wired into voice-standalone-runtime (deliberate — wiring lands with the P2 pitch slice behind mode wiring; see runtime audit: no production path passes active today, so the controller is safe-by-default while unwired).
- Safety/privacy impact: strengthens all product laws (breathiness can never outrank pitch in pitch phases; unreviewed cues structurally unservable; shadow non-mutating; pain first).
- Known gaps: cueResolver injection is the wiring seam; no learner-facing surface yet (P2-005); advancement evidence policy not yet versioned (P2 slice).
- Next dependency: independent review, then TV-FEM-P1-003 (mastery integration) / P2 pitch vertical slice.

### 2026-08-17 — TV-FEM-P1-001/P1-002 independent review cycles (X-G5/X-G6)

- Status: 3 reviewer cycles completed; cycle-2 and cycle-3 repairs applied.
- Cycle 1 (f6b9cbb): VERDICT blocked — F1 advancement unreachable from calibration/awareness; F2 unknown phase fail-opened to pitch_foundation; F3 partial stop set; F4 shadow carried servable cue payload; F5 malformed pendingTrial reopened serving; F6 null-context throws + prototype-dimension crash; F7 test gaps. All repaired in ef5ee73 (see commit).
- Cycle 2 (ef5ee73): F1/F2/F4/F5/F6 CLOSED; F3-PARTIAL (plan 7.2 intake fields), F7-PARTIAL, NEW-3 docstring drift, NEW-4 dead params. Repaired in 98bc14b: REDUCE_DIFFICULTY_FLAG_FIELDS tiering (hoarseness/cough/loss-of-range/illness → reduce_difficulty naming the field), recentLaryngealSurgery → immediate stop; rankEligibleObservations exported + order tests; docstring precedence corrected; reserved params annotated.
- Cycle 3 (98bc14b): F3 CLOSED, NEW-3 CLOSED, NEW-4 CLOSED; F7 narrowed to a missing equal-importance/different-controllability rank assertion; NEW-6 stale counts in this ledger. Both closed in the current commit.
- Current suite: controller 28/28; full coaching 696/696 (witnessed by primary; reviewer roles are execution-gated).
- P2 wiring note from review: controller safety booleans are strict `=== true`; the P2 API boundary must normalize truthy input (e.g. 1, 'yes') so safety intake cannot fail open on malformed data.
- Safety/privacy impact: none beyond prior entries (test + docs only in this cycle).
- Next dependency: cycle-4 confirmation, then TV-FEM-P1-003 (mastery integration) / P2 pitch vertical slice wiring.

### 2026-08-17 — TV-FEM-P2 deterministic slice (P2-001..P2-004) on fem-v1/pitch-vertical

- Status: four deterministic modules implemented TDD and suite-green (725/725 total; calibration 6/6, feedback 9/9, cue-served 7/7, pitch-policy 7/7); independent review cycle-1 pending this turn.
- Branch lineage: cut from certified controller head 8b8361f → 299357f (P2-001) → 02a7605 (P2-004+review_due) → e13f315 (P2-003) → afb603e (P2-002).
- Design decisions recorded for review: (1) calibration validity is CAPTURE validity — the coaching isUsableObservation gate requires target distance, but calibration takes are target-free by law, so a separate gate is used and short-frame takes surface as tracker risk instead of being silently dropped; (2) 0.5 ST salience floor in the step policy — baseline jitter between takes is not a demonstrated glide (found red, module strengthened not test weakened); (3) effort evidence read from RAW observations because normalizeObservation drops selfReport; (4) cue-served event stream is separate from motor-trial objects — the trial binds the event at wiring time; (5) shadow mode cannot produce a served event at all.
- Known gaps: runtime wiring (controller + these modules behind explicit mode in voice-standalone-runtime) and the P2-005 beginner card remain; P2 wiring must normalize truthy safety input (strict === true in controller).
- Safety/privacy impact: strengthens exact-next causality and no-unreviewed-cue laws; no new data collection.
- Next dependency: review cycle-1 for the four modules, then runtime wiring.

### 2026-08-17 — P2 review cycle 1 (X-G5) + repairs

- Status: cycle-1 verdict blocked (F1-F5); all repairs applied and suite-green (736/736; calibration 9/9, policy 10/10, cue-served 10/10, feedback 10/10, motor-trial 10/10); cycle-2 pending.
- F1 (capture gate + artifact robustness) FIXED: plausibility bounds 60-500 Hz on calibration takes; baseline records quantileMethod + spreadSemitones; policy refuses baseline_spread_too_wide beyond 12 ST; demonstrated-comfort basis = median of SALIENT (>=0.5 ST) VERIFIED upward movements only, requiring >=2 of them (salience filtering is policy, not record-keeping); single 5-ST artifact can no longer set the step.
- F2 (exact-next/idempotence untested/unwired) FIXED: motor-trial createPendingMotorTrial now accepts cueServeEvent + requireCueServeEvent; rejects cue_serve_event_required / _not_eligible; binds served+acknowledged evidence onto the trial; idempotence test proves identical deterministic trialId with/without serve; docstring no longer describes nonexistent wiring (the binding exists and is tested).
- F3 (causality inversion) FIXED: cueServeEligibility requires take time >= acknowledgedAt (serve_not_yet_acknowledged_at_take) and re-checks carried cueReviewStatus (forged clinical-review-required events fail eligibility); double-acknowledgement refused.
- F4 (test integrity) FIXED: tautological assert deleted; sub-floor, single-movement, spread, boundary and forged-shape tests added.
- F5 (stabilityAchieved contradiction) FIXED: schedule stabilityAchieved now requires retentionVerified AND >=1 no-feedback verification, consistent with masteryReviewState not_established; contradictory-shape test added.
- Reviewer positions accepted: nearest-rank quantiles acceptable-with-caveat (n + quantileMethod now surfaced); retentionVerified+1-verification → current defensible (policy versioned).
- Safety/privacy impact: strengthens exact-next causality (take-before-ack can never earn credit) and no-unreviewed-cue (re-checked at eligibility, not just serve).
- Next dependency: cycle-2 re-review, then runtime wiring.

### 2026-08-17 — P2 review cycle 2 (X-G6) + NEW-1..4 repairs

- Status: cycle-2 verdict — all five frozen findings CLOSED (F1 bounds/spread/salient-median verified; F2 binding + idempotence verified, provided-event path always eligibility-checked; F3 ordering boundary pinned; F4 tautology gone; F5 stabilityAchieved consistent); four NEW findings (moderate NEW-1 binding identity, minor NEW-2 forged time-inversion, minor NEW-3 misleading summary name, trivial NEW-4 dead exports). All four repaired same turn; suite re-verified 739/739 (calibration 9/9, policy 10/10, cue-served 11/11, feedback 10/10, motor-trial 12/12).
- NEW-1 FIXED: resolveCueServeBinding now verifies cueServeEvent.cueId === decision cueId AND sessionId === trial session (cue_serve_event_cue_mismatch / _session_mismatch); two mismatch tests added. Session id is resolved before binding so identity is checked against THIS trial.
- NEW-2 FIXED: cueServeEligibility re-verifies acknowledgedAt >= servedAt (acknowledgement_time_invalid); forged time-inverted event test added.
- NEW-3 FIXED: summary field renamed medianAllVerifiedUpwardSemitones with a consumer warning pointing policy consumers to resolvePitchStepPolicy (salience-filtered basis).
- NEW-4 FIXED: dead exports now consumed by tests (PLAUSIBLE_MIN/MAX_PITCH_HZ in the plausibility assertion; PITCH_REACHABLE_POLICY_ID/VERSION in the policy-id assertions).
- Reviewer positions accepted: wide-range refusal (spread > 12 ST) is correct fail-closed capture-garbage rejection for v1 beginner scope; requireCueServeEvent=false default is the documented wiring-pending state — runtime wiring MUST pass true (recorded as a wiring gate for cycle-3).
- Next dependency: cycle-3 confirmation; wiring gate recorded (requireCueServeEvent: true at the runtime seam).

### 2026-08-17 — P2 review cycle 3: CERTIFICATION PASS

- Status: TV-FEM-P2-001..P2-004 deterministic slice CERTIFIED (VERDICT: pass, independent xna-reviewer on f8e24d8).
- All four cycle-2 NEW findings verified CLOSED: binding identity (cue+session mismatch unreachable), forged time-inversion guard, renamed summary field (zero stale references), dead exports consumed.
- Regression sweep clean: session-resolution reorder behavior-confined; wiring gate present in ledger; no law leak or dead code across all five modules.
- Reviewer-noted trust boundaries for the WIRING gate (not slice defects): hand-crafted trial objects bypass binding by construction; cueId string normalization belongs at the runtime boundary.
- Suite: 739/739 (calibration 9, policy 10, cue-served 11, feedback 10, motor-trial 12).
- Next dependency: runtime wiring package — barrel exports, explicit-mode seam (default remains shadow/off), requireCueServeEvent: true at the trial-creation call site, then P2-005 beginner card.

### 2026-08-17 — P2-005 beginner card (deterministic builder) + wiring surface

- Status: `beginner-session-card.js` implemented TDD (7/7) — full coaching suite 753/753. Barrel exports landed earlier @ff0b83e; coachingTurn shadow wiring of the certified controller landed @1d32b0d (femV1ControllerTurn witness; pain -> stop_for_safety through the barrel; unknown mastery -> calibration entrance; off-mode skips computation; no signal contamination).
- Card laws: five-part shape; ONE focus (otherFocusMentioned always empty); safety stop collapses the whole card to stop language (no focus, no steps); capture failure is neutral (recording failed, never the learner); every build passes containsInternalJargon audit — caller-supplied jargon copy is replaced, never shipped; technical detail (phase, feedback state) is OPT-IN; unknown feedback states fail closed to the neutral no-change card.
- Remaining wiring gate for ACTIVE serving: runtime must pass requireCueServeEvent:true at trial creation AND an approved cue must exist — cue-library-v3 currently has every cue at clinical-review-required, so active serving correctly fails closed to end_block until a cue review grants approved_internal (P6-002 CUE_REVIEW_MATRIX workstream; owner/specialist review decision, not an engineering one).
- Next: UI integration on fem-v1/beginner-ui; cue-review decision for the dev cue set.

### 2026-08-17 — §8A comfortable-pitch loop: END-TO-END PROVEN (deterministic)

- Status: `pitch-vertical-loop.test.js` composes all certified modules in the master-plan §23 order — calibration → step policy → reachable target → engine decision → controller ACTIVE serve (approved cue) → cue served + acknowledged → exact-next trial bound → settled worked_verified (motor map updated) → mastery evidence → beginner feedback → fading → second no-feedback verification → later-session retention gate → stability + review current → beginner card. Loop 1/1; full suite 754/754.
- Negative invariants pinned in-composition: unreviewed cue fails closed to end_block; shadow cannot serve; trial without eligible serve refused; take before acknowledgement ineligible.
- Scope note (honest): this is the DETERMINISTIC loop proof — module composition under contract fixtures. It is NOT a live-audio or device proof; acoustic validity remains the P3 golden-corpus gate (ACOUSTIC_VALIDATION_PLAN) and active serving still requires the cue-review decision (every library cue is clinical-review-required).
- Next dependency: review cycle for the loop + card + wiring cluster, then §8B (controlled /i/ resonance, P3) or UI branch.

### 2026-08-17 — Wiring/card/loop review cycle 1 (X-G5) + repairs

- Status: verdict blocked (F1-F7); F1-F4 repaired same turn, suite re-verified 759/759 (wiring 9/9, card 10/10, feedback 6/6, loop 1/1); F5-F7 notes (requireCueServeEvent default documented as wiring gate; devApprovedCue override accepted as documented simulation with paired negative; shared observation aliases read-only).
- F1 FIXED: coachingTurn safety mapping is now a whitelist over the controller's OWN exported IMMEDIATE_STOP_FIELDS + REDUCE_DIFFICULTY_FLAG_FIELDS lists — a new safety field added in the controller is wired by construction; wiring test walks all 7 non-pain stop fields -> stop_for_safety and the reduce-tier flag -> reduce_difficulty through coachingTurn.
- F2 FIXED: INTERNAL_TERMS extended to the plan 14.4 hide-list (formant, confidence, gender/femininity/passing vocabulary, transvoice.* schema ids, pitch.register/resonance.global_scale/prosody.*, internal action names, phase names, target-distance language). Full-card audit: focusLabel dropped if jargon; try-steps filtered step-by-step; whole-default-view backstop neutralizes anything left. The prose audit excludes the object's own schema self-descriptor (metadata the UI never renders). Three adversarial smuggle tests added (focusLabel pitch.register + Femininity score; F1/confidence step; end_block message).
- F3 FIXED: loop reachableLow bound now tied to the resolved stepPolicy.max (demonstrated comfort), not the config cap.
- F4 DOCUMENTED: conversational no-take turns read usable=true from signal-builder convention (nothing failed because nothing was attempted); controller still lands collect_calibration — comment + wiring tests pin this.
- Next dependency: cycle-2 re-review of the frozen set.

### 2026-08-17 — Wiring/card/loop review cycle 3: CERTIFICATION PASS

- Status: VERDICT: pass (independent xna-reviewer on e6f2347). NEW-1 closed (f1/f2/f3 tokens; raw-token step and F2-resonance focusLabel both drop; zero false-positive surface on shipped copy — case-insensitive grep clean). NEW-2 closed (string input audited directly; string-argument assertions regain teeth). Object branch unchanged; single-commit scope confirmed; suite count structurally unchanged at 759.
- The wiring/card/loop delta (barrel exports + coachingTurn femV1ControllerTurn shadow wiring + beginner session card + §8A pitch-loop deterministic proof) is CERTIFIED as the foundation for fem-v1/beginner-ui.
- Certified stack now: P0 audit · P1-001/002 controller+eligibility · P2-001..005 deterministic slice · barrel + shadow wiring · §8A loop proof. Full suite 759/759.
- Next: fem-v1/controlled-resonance branch — P3-001 en-AU-v1 language pack, P3-002 controlled-vowel-evidence contract (deterministic, buildable now); P3-003 golden corpus needs real human/expert-corrected audio (owner input path, not fabricable); active serving still gated on the cue-review decision.

### 2026-08-17 — P3-001 + P3-002 on fem-v1/controlled-resonance

- Status: language pack + controlled-vowel-evidence contract implemented TDD; canonical suite 779/779 (pack 8/8, evidence 12/12). Branch cut from certified 90c8e53.
- P3-001: en-AU-feminization-foundations-v1 — provisional phonetic content explicitly phonetic_review_required with named phonetician questions (en-AU TRAP/BATH lack of split; DRESS /e/ vs /ɛ/; THOUGHT /oː/ vs /ɔː/); prompts validated byte-identical to the controlled-probe registry; demo assets are honest not_recorded slots (no TTS authority); validation catches drift. Test moved flat into backend/coaching so the canonical glob includes it (glob does not recurse).
- P3-002: the authoritative controlled-vowel evidence record per master plan 10.3 — every gate fails closed with an explicit reason: stable segment >=150ms; F1-F3 values + per-formant confidence (F4 optional); estimator agreement with relative 5% tolerance (fewer than two estimates = unavailable, never silently passing); high-F0 risk at >=300Hz (transfeminine-relevant failure mode); controlled-context + prompt-match + reliability-evidence completeness; external versioned registry release gate — under the DEFAULT registry the formant detector is research-only (human benchmark pending), so nothing here can drive learner-facing coaching yet by construction.
- Honest scope: this is the deterministic CONTRACT. Analyzer emission (VoiceTrainer side), the golden corpus (P3-003, real expert-corrected audio — owner input gate), and the /i/ trial (P3-004, depends on P3-003) remain.
- Next dependency: review cycle for the P3 delta, then P3-004 design or owner gate on corpus.

### 2026-08-17 — P3 review cycles 1-2 + repairs

- Status: cycle-1 blocked (F1 BLOCKER null-F0 passes gates; F2 track continuity absent; F3 vacuous prompt test; F4 identity ungated). F1/F2/F4 repaired in 1f419a9: f0_median_missing + max-pitch-witness risk derivation + 15% take-vs-window consistency; trackContinuity witness required (missing/degraded fail closed); five-field identity gate. Five kill tests added (null-F0, masked-context, inconsistent-witnesses, null-identity, continuity-degraded/missing). Canonical suite 784/784 (evidence 17/17).
- F3 disposition (honest deferral): the prompt-drift test reads the same source both sides by construction; frozen-literal prompt expectations are deferred to the phonetician pack review (pendingQuestions already name TRAP/BATH, DRESS, THOUGHT). Not silently claimed as done.
- Parent-run diff verification (cycle-2 follow-up): 5ce7840..1f419a9 touches exactly controlled-vowel-evidence.js + .test.js (132 insertions, 6 deletions). The single diff hunk naming evaluateEstimatorAgreement is the module.exports context line (adding PITCH_CONTEXT_RELATIVE_TOLERANCE); the function body itself is byte-identical between commits (extract-compare sha256 d576847f3d0e206f on both sides) — estimator math untouched (reviewer inference converted to parent observation).
- Cycle-2 verdict: F1/F2/F4 CLOSED; sole finding this docs ledger staleness (this entry repairs it). Analyzer-dishonesty boundary noted by reviewer: a self-consistent all-200Hz lie passes F0 gates but remains traceable via analyzerVersion/detectorFamily/attemptArtifactId/recordingContextId/registry-anchored detectorValidation — provenance is the control, out of contract scope.
- Next dependency: cycle-3 docs-only confirmation, then P3-004 design or owner gates.

### 2026-08-17 — §8B controlled-/i/ resonance loop: END-TO-END PROVEN (deterministic)

- Status: `controlled-resonance-loop.test.js` composes the certified P2/P3 modules in the master-plan §23/§8B order — authoritative controlled-/i/ baseline evidence (release-validated registry) -> engine decision (resonance.global_scale below, controlled context) -> controller ACTIVE serve in resonance_foundation (approved cue) -> cue served + acknowledged -> exact-next trial bound -> exact-next take (authoritative after-evidence) -> settled worked_verified with pitch+effort+pressedness protected -> motor map updated -> mastery evidence (elicitation verified; phase NEVER auto-advanced) -> beginner feedback + card -> two no-feedback verifications -> later-session retention gate -> review current -> mastery summary proves one /i/ success is not whole-voice mastery (retention step not_observed).
- In-composition negatives: high-F0 take invalid regardless of formants; default registry keeps the same take research-only; unverified controlled context fails controller eligibility (no_eligible_observation_for_phase); pitch phase refuses the resonance observation; unacknowledged serve earns no trial.
- PRODUCTION BUG FOUND AND FIXED by this proof: `safeObservationSnapshot` (motor-trial.js) dropped the top-level comparisonContextKey from before-evidence, so verifyCueEffect re-derived the before identity WITHOUT the context component and every controlled-vowel settle would have invalidated as context_changed (the pitch loop could never surface this — its identity needs no context key). Fix: snapshot retains comparisonContextKey (a context id string, not learner content); focused regression test added (settles worked_verified with full protected bundle).
- Honest scope (mirroring §8A): the DETERMINISTIC loop composition under contract fixtures — not live-audio/device proof (P3-003 golden corpus remains the owner-input gate) and not active serving (cue-review gate stands).
- Suite: §8B 1/1, motor-trial 13/13; canonical 786/786.
- Next dependency: review cycle for the §8B delta + identity fix, then owner gates or P4.

### 2026-08-17 — §8B review cycle 1 + repairs

- Status: verdict blocked (F1 major, F2/F3 minor, F4 note). The identity fix itself verified SOUND end-to-end by the reviewer (all 11 identity components now retained in before-evidence; privacy-clean; persisted-trial reload repaired as a side effect). F2/F3 repaired same turn; §8B 1/1, canonical 786/786 re-verified.
- F2 FIXED: the unverified-context negative now strips ONLY contextKind (metadata comparability intact) and asserts the exact exclusion reason `controlled_resonance_context_not_verified` on `eligibility.rejected[0]` — the law isolated, not a conjunction of causes.
- F3 FIXED: provenance threading — the authoritative after-evidence and the coaching observation are asserted to describe the same physical take (same attemptArtifactId, same comparisonContextKey) and the F2 rise (1780→2050 Hz) is asserted as the acoustic movement behind the 0.24→0.31 observation.
- F1 DEFERRAL (honest, reviewer's own option): §23's `word transfer` step is NOT exercised by this loop — "see me" appears only in cue copy. Word-stage resonance validity is P3-004 scope by the backlog's own acceptance list (`word_transfer` lives there); exercising it now would require a formant→word evidence semantic that does not exist yet. Not silently claimed as done. F4 note: the 1.0-ST protected rule's kill side is pinned in protected-cue-verification.test.js, not in-composition (accepted).
- Parent-run scope verification (reviewer follow-up): `git show --stat c89bba9` confirms exactly the four subjects (loop test +368, motor-trial +6, motor-trial test +61, ledger +9).
- Next dependency: cycle-2 confirmation; on PASS the master-plan §23 first milestone (both vertical slices proven deterministically) is complete, pending owner gates (P3-003 golden corpus = real expert-corrected audio; cue-review decision for active serving).

### 2026-08-17 — TV-FEM-P4-001 integration phase (fem-v1/integration)

- Status: implemented TDD; canonical 792/792 (integration 6/6); review pending.
- Implementation: `transfer.retention` added to METRIC_RULES (role coaching, phase transfer ONLY — rejected as metric_not_unlocked_for_phase everywhere else); `integration-phase.test.js` pins all five backlog acceptance criteria: one_primary_focus (both gaps → exactly ONE focus by importance ranking; no secondaryFocus key exists), established_skill_protected (in-band dimension never the focus; rides in cue protections; CONFOUND SIDE: protected pitch escaping the ee-anchor's 1.0-ST rule → settled confounded with successes === 0 — the map honestly records the attempt+failure per plan 6.5, and the credit law is zero successes, not map-untouched), effort_can_simplify (escalation outranks correction with both gaps present), short_phrase_transfer (transfer.retention transfer-phase-only), cross_session_retrieval (later session opens retention_check before any guide).
- Fixture-law lessons found by the red tests (recorded for future test authors): (1) protected-metric observations of the same physical take must share its takeKind — protectedBeforeSnapshots matches by the focus takeKind, so mixed takeKinds degrade settles to movement_observed_partial (correct fail-closed, confusing fixture); (2) motor-map credit law: confounds are recorded as attempts+failures (motor-map.js failure list) — assert successes === 0, not motorMapUpdated === false.
- Branch: fem-v1/integration cut at b483c3c. Next dependency: P4-001 review cycle.

### 2026-08-17 — P4-001 review cycle 1 + repairs

- Status: verdict blocked (3 minors); all repaired same turn; canonical re-verified 794/794 (integration 8/8).
- (1) FIXED: comment arithmetic erratum 200→240 Hz is ~3.16 ST, not ~2.0 (comment text only; assertions unaffected; the immutable commit message carries the erratum — corrected here).
- (2) FIXED: the 1.0-ST protected rule is now pinned UNIQUELY — the new in-band kill test (200→218 Hz ≈ 1.49 ST: above the rule, inside the 180-220 band) can only confound via max_semitone_delta, so a skipped-or-raised rule fails this test alone (previously overdetermined: 240 Hz also escaped the band, so the generic regression path masked the rule).
- (3) FIXED: transfer-phase serving is now exercised — transfer.retention focus served through the approved transfer.same-sentence.v1 at the phrase stage (its stages exclude 'sound'; that fail-closed is the documented gate).
- (4) Determinism assert added: identical evidence → identical decision (the secondaryFocus absence assert kept as a future-key pin; reviewer's vacuity note acknowledged).
- Parent-run scope check: git show --stat 0397801 confirms exactly the three review subjects (policy +4, test +207, ledger +7).
- Next dependency: cycle-2 confirmation.

### 2026-08-17 — P4-001 review cycle 2: CERTIFICATION PASS

- Status: VERDICT: pass (independent xna-reviewer on 5e3c0a3). All three cycle-1 findings verified CLOSED by counterfactual trace: the in-band 200→218 Hz kill test (~1.49 ST, both endpoints in-band) is the only suite-wide fixture where max_semitone_delta alone can confound — deleting/raising the rule turns this test RED with worked_verified; transfer-phase serving traced green through every controller rung (PHASE_ORDER + METRIC_RULES + stage/direction gates); comment/determinism/erratum all confirmed. Regression clean: single commit, 8 = 6 + 2 test blocks, 794 = 792 + 2 arithmetic.
- P4-001 COMPLETE per its five backlog acceptance criteria (one_primary_focus, established_skill_protected incl. confound side, effort_can_simplify, short_phrase_transfer, cross_session_retrieval).
- Certified fem-v1 stack is now: P0 audit · P1 controller/eligibility · P2 slice + wiring/card + §8A loop · P3 pack/evidence + §8B loop · P4-001 integration. Canonical 794/794.
- Remaining unblocked: P5-001 motor split (learner-general vs goal overlay), P6-001 replay evaluator, fem-v1/beginner-ui. Owner gates unchanged: P3-003 golden corpus (real expert-corrected audio), cue-review decision for active serving, and — per runbook §10 — a fresh architectural/scientific/safety/beginner-UX review at this §23 checkpoint before any widening beyond the validated scope.

### 2026-08-17 — TV-FEM-P6-001 replay evaluator (fem-v1/integration)

- Status: implemented TDD on fem-v1/integration; canonical 804/804 (evaluator 10/10); review pending.
- Implementation: `fem-v1-replay-evaluator.js` — pure, deterministic aggregate over RETAINED replay rows (row shape documented in-module; adapter is wiring-time). Reports all six backlog criteria — legacy_vs_v1_focus (conceptual mapping via the legacy focus table; unmapped names count as disagreement, never guessed), phase_policy_violations (BOTH directions: legacy-coached dimensions the v1 policy rejects for the phase, AND defense-in-depth: any retained v1 serve whose focus is phase-ineligible — impossible from the controller by construction, flagged anyway for forged rows/wiring bugs), rejection_reasons (counts), confound_rate, retention_rate, effort_change (mean delta over settlements with both efforts; missing-effort settlements counted separately, never treated as zero) — plus plan 17.4's no_evidence_rate and focus_distribution.
- Laws: unknown-is-not-zero throughout (rates over zero qualifying rows are null); malformed rows are skipped-and-counted with reasons, never crash; empty input yields a valid empty report with nulls.
- Next dependency: P6-001 review cycle.

### 2026-08-17 — P6-001 review cycle 1 + repairs

- Status: verdict blocked (F1/F2 majors, 2 minors, 2 notes); all repaired same turn; canonical re-verified 806/806 (evaluator 12/12 = 10 + 2 kill tests, malformed/empty edited in place).
- F1 FIXED (effort coercion): strictFiniteNumber replaces the coercing finiteOrNull for effort evidence — strings/booleans/arrays/NaN/Infinity are MISSING evidence, never fabricated measurements ([] ≠ 0 effort, true ≠ effort 1). Kill test pins six junk shapes into the missing bucket with null rates while real numbers still measure.
- F2 FIXED (phase defaulting): unknown/garbled row.phase is counted in rowsPhaseUnknown and EXCLUDED from phase-policy violation judging — never defaulted to the normalize default (which would fabricate or mask violations). Phase-independent aggregates (focus distribution, settlement, retention, effort) still count such rows. Adapter rule documented in-module (legacy 'none' → null legacyFocus; note-5 accepted).
- (3) skippedReasons contents now pinned (three 'row_not_object'); (6) noEvidenceRate null pinned on empty input.
- (4) HONEST COVERAGE NAMING: the plan 17.4 fuller aggregate list (expert focus agreement, missing-protected-evidence rate, cue repetition, capture-repair performance) is NOT implemented in P6-001 — the backlog's six criteria are; the fuller list is the growing target for later P6 work (named here rather than silently absent).
- Parent-run scope check: git show --stat 13ece32 confirms exactly the three review subjects (evaluator +225, test +144, ledger +7).

### 2026-08-17 — P6-001 review cycle 2: CERTIFICATION PASS

- Status: VERDICT: pass (independent xna-reviewer on cbf06c0). F1 CLOSED (strictFiniteNumber at exactly the two effort sites; zero coercion paths remain module-wide; six junk shapes pinned missing with null rates). F2 CLOSED (phaseKnown wraps both violation directions; defaulted phase consumed only inside guarded branches; focusDistribution/noEvidenceRate confirmed phase-independent). Minors/notes closed; §17.4 fuller aggregates named as later-P6 target. Regression clean: single commit, 12 blocks, 806 = 794 + 12.
- P6-001 COMPLETE per all six backlog acceptance criteria.
- Certified stack: P0 audit · P1 controller/eligibility · P2 slice + wiring/card + §8A loop · P3 pack/evidence + §8B loop · P4-001 integration · P6-001 replay evaluator. Canonical 806/806.
- Next: runbook §10 checkpoint review (architectural/scientific/safety/beginner-UX of the whole fem-v1 stack) — the plan's own gate before widening; then P5-001 motor split / fem-v1/beginner-ui per its verdict, plus the standing owner gates.

### 2026-08-17 — Runbook §10 CHECKPOINT COMPLETE: all four lenses PASS

- LENS-ARCHITECTURE: pass — single authoritative boundary (no learner-facing bypass exists; runtime has zero femV1 references; shadow seam fail-closed at three independent layers); no import cycles; mastery/motor stores verified still unwired. Minors M1-M5 recorded below.
- LENS-SCIENCE: pass — after F1 repair (strictEffortNumber at calibration effort intake; forged true/[]/'  ' are missing evidence, never measurements feeding the step-policy basis). ΔST math, no-universal-targets, small-sample caveats, high-F0 line, estimator tolerance, named-constant provenance all verified.
- LENS-SAFETY: pass — after F1/F2 majors repaired at the settle seam (pain_reported terminal invalidation; cue-serve window binds the after-take via settledAt with take_time_unknown fail-closed; kill tests 16/16) plus F3 (non-severe breathlessness/dizziness reduce tier) and F4 (plan-verbatim stop copy). Shadow-never-learns structurally proven; no prohibited wording anywhere; authority order faithful.
- LENS-UX: pass — after F1 (fading WHY copy in the card contract for hidden_guide/new_prompt/retention_check), F2 (explicit RECORD affordance; null on safety stop), F3 (gender-vocab stems audited), register polish, and two residual lines fixed (approved-cue/evidence register out of learner copy; pins added).
- Pre-widening minors backlog (all recorded, none blocking): M1 requireCueServeEvent default at the barrel seam (wire requireCueServeEvent:true or barrel wrapper); M2 feminization-v1-policy rename/split as shared kernel (schedule with P5); M3 reserved-param inertness test; M4 replay-evaluator composition smoke + wire-or-delete-mark feminization-v1-curriculum; M5 RUNTIME_AUDIT.md forward pointer to STATUS.md; N1 capture-rung-before-reduce ordering note; 'women' plural stem polish.
- Suite: canonical 814/814. HEAD 086200a.
- Checkpoint verdict: the §23 deterministic milestone (both loops certified) plus P4-001 + P6-001 now carry a full 4-lens checkpoint pass. Widening beyond the validated scope (intonation, spontaneous speech, P5 motor split, beginner UI) may proceed per the plan's sequence; active serving remains behind the two owner gates.

### 2026-08-17 — Pre-widening minors M1/M3/M4/M5 closed (M2 scheduled with P5)

- M1 CLOSED: `createLearnerFacingTrial` barrel seam — ALWAYS requires cue-serve evidence (explicitly overrides a caller-passed requireCueServeEvent:false); raw createPendingMotorTrial remains the documented research/wiring-pending path. Bypass test pins both omitted and explicitly-false cases.
- M3 CLOSED: reserved-param inertness test (deep-equal pin: goalProfile/capabilityProfile/motorResponseMap/goalCueOverlay change nothing until P5 wires them).
- M4 CLOSED: replay-evaluator composition smoke through the barrel (controller shadow decision → adapter row → evaluator report: legacy breathiness violation counted, rejection reason aggregated, no-evidence rate) + `evaluateFemV1Replay` barrel export; M4b: feminization-v1-curriculum.js carries an UNWIRED status header (wire-or-remove decision scheduled with P5 — controller reads phase from masteryState, not LESSONS).
- M5 CLOSED: RUNTIME_AUDIT.md carries a post-audit wiring note pointing to the live STATUS ledger (its cue-served "does not exist" row and pre-wiring snapshot now dated explicitly).
- M2 (policy rename/split as shared kernel) remains scheduled with P5 per the architecture-lens verdict; N1 (capture-before-reduce ordering) and the 'women' plural stem stand as recorded notes.
- Suite: canonical 817/817.

### 2026-08-17 — TV-FEM-P5-001 motor split (fem-v1/integration)

- Status: implemented TDD; canonical 828/828 (learner-motor-response 7/7, goal-cue-overlay 4/4); review cycle pending.
- learner-motor-response.js — the LEARNER-GENERAL store (plan 6.5): cue × skill × dimension, migrated from target-scoped motor maps with provenance (source schema recorded on every entry); reference/target changes cannot erase it by construction (entries from multiple targets coexist; preservation pinned by test). Weighted arithmetic only — no invented confidence (zero-verified cues stay zero; empty/invalid maps contribute nothing); means rounded 1e-9 (float residue killed); merge order-insensitive; direction/context stay null until supplied (unknown never invented); llmMemoMotorProjection() makes the plan-16 LLM exclusion an explicit, testable null.
- goal-cue-overlay.js — the GOAL-SPECIFIC store: bounded [0,2] relevance per goalProfileId × cueId, neutral default 1, immutable operations, clearGoalOverlay removes only that goal (others preserved; separation from learner-general pinned by test); malformed ids/non-number relevance land nothing (fail closed).
- M2 (policy shared-kernel rename) intentionally NOT ridden here — it touches 6+ dependent modules and deserves its own scoped change with the P5 wiring review, per the architecture lens verdict.
- Remaining P5-001 acceptance: migration wiring at persistence (learner-context-service getTargetMotorMap consumers) — same unwired-by-design seam as the rest of the certified stack; runtime wiring is its own work package.
- Next dependency: P5-001 review cycle.

### 2026-08-17 — P5-001 review cycle 1 + repairs

- Status: verdict blocked (4 minors + 3 notes + 2 shell-unverifiable scope items); all repaired same turn; canonical re-verified 830/830 (learner-motor-response 9/9 = 7 + 2 kill tests, overlay 4/4).
- Parent-run verifications requested by the reviewer: `git show --stat 7cddefe` = exactly the five subject files (learner-motor-response committed as a Bin blob — a non-ASCII byte in the original write; repaired by full ASCII rewrite this cycle, so the flag is an old-side diff artifact only); canonical 828/828 at 7cddefe was parent-witnessed earlier.
- Minor 1 FIXED: getGoalCueRelevance clamps on READ too — forged/foreign overlays can never read back out-of-band relevance.
- Minor 2 FIXED: skillForDimension fails closed to null for unregistered heads (e.g. 'phonation') — vocabulary never silently widened; kill test added.
- Minor 3 FIXED: accumulator key is JSON.stringify([cue, dimension]) — space-containing pairs can never silently merge; kill test added (adjacent pairs 'a b'×'c' vs 'a'×'b c' stay separate).
- Note 1 FIXED: preservation test now FULL-entry deepEqual (direction/provenance mutations on a preserved entry fail).
- Note 2 FIXED: per-source provenance carries the attempts each source contributed — distinct sources yield distinct sortable entries; the order-insensitivity test now exercises the provenance sort with genuinely different inputs.
- Minor 4 + Note 3 (wiring-time backlog, recorded): schema widening (effort/confound/retention/transfer stats) required before retiring target-scoped maps; barrel-export decision and memo-seam routing (llmMemoMotorProjection) at wiring review. Cycle-2 addition: absorbResponse trusts any schema-matching response — numeric fields coerce safe (nonNegativeInt/finiteOrNull) but provenance entries are pushed UNVALIDATED; the persistence seam must validate provenance shape before merge is wired.

### 2026-08-17 — P5-001 review cycle 3: FOLD-IN CONFIRMATION PASS

- Status: VERDICT: pass (independent xna-reviewer on 3892b09, per cycle-2's own exit rule: both prescribed items witnessed with file:line). Read-clamp kill verified non-vacuous (forged 99/-9 → 2/0; deleting the read clamp turns it red); trust-boundary ledger line verified at the deferral point; regression clean (single commit, 831 = 830 + 1, overlay 5/5 = 4 + 1).
- P5-001 COMPLETE per all five backlog acceptance criteria (reference_change_preserves_motor_response, goal_overlay_separate, migration_provenance, no_invented_confidence, llm_context_exclusion).
- Certified fem-v1 deterministic stack is now: P0 audit · P1 controller/eligibility · P2 slice + wiring/card + §8A loop · P3 pack/evidence + §8B loop · P4-001 integration · P5-001 motor split · P6-001 replay evaluator · 4-lens checkpoint · minors M1/M3/M4/M5. Canonical 831/831.
- Remaining unblocked: fem-v1/beginner-ui (card contract consumption in the frontend). Owner gates unchanged (cue-review; P3-003 corpus). Wiring-time backlog recorded (schema widening, provenance validation at persistence, barrel exports, memo-seam routing, M2 rename).

### 2026-08-17 — fem-v1/beginner-ui: frontend card consumer (P2-005 frontend increment)

- Status: implemented TDD on fem-v1/beginner-ui (cut from certified ecfb519); vitest 10/10 + tsc clean; backend canonical unaffected (831/831).
- `frontend/src/voice/lesson/beginner-session-card.ts` — pure consumption module following the repo's own card.ts pattern (lesson-owned, defensive normalizer, no DOM/state coupling): schema-gated (transvoice.beginner_session_card.v1 or null — unknown payloads never guess a shape); full backend result-state vocabulary (11 states; unknown states fail closed to null); client-side safety-stop collapse as DEFENSE IN DEPTH (even a buggy payload cannot model a record affordance, focus, steps, or demo on a stop card); record affordance honored (label defaults 'Record', absent record → no affordance, stop → never); fading contract enforced mode+why TOGETHER (a mode without its why-message fails closed to no fading block — never a bare label that reads as the app going cold); steps trimmed/capped (8) with non-strings dropped.
- Found by red test during development: the initial normalizer accepted a bare `hidden_guide` mode with no whyMessage — fixed to require the pair (the exact UX-lens law).
- Scope note: this is the CONSUMER contract. Mounting into the lesson controller (rendering seam) is the next increment; the backend card itself remains shadow-only (no active serving — owner gates stand).
- Next dependency: review cycle for the consumer, then lesson-controller mounting.

### 2026-08-17 — beginner-ui consumer review cycle 2: CERTIFICATION PASS

- Status: VERDICT: pass (independent xna-reviewer on 94b9646). All cycle-1 findings closed with individually-traced counterfactual teeth: schema gate red-pinned (complete card under wrong schema nulls — deleting the gate fails red, unshadowed); vocabulary sync enumerates all 11 literals in backend order (mirror-pin; cross-package import recorded as wiring-time backlog); inverse fading shape and stop-collapse fading both pinned (reverting to raw fadingMode/fadingWhy fails red); F1 ledger duplicate deleted (the two remaining cycle-2 strings are resolved historical entries, each followed by its own CERTIFICATION PASS record). F4 (record.affordance value) stands as the mounting-seam deferral. Regression clean: single commit, 11 = 10 + 1 tests, vitest 11/11 + tsc clean parent-witnessed, module referenced only by its own test (consumer-only, as contracted).
- The consumer increment is CERTIFIED as the foundation for lesson-controller mounting.
- Honest boundary for arc-2 closure: mounting is wiring-time by the review's own deferral — the backend card builder is not yet attached to any runtime payload (runtime audit: shadow-only stack), so a mounted consumer would normalize a field production never emits. The runtime wiring work package (controller/card emission + persistence stores + reachable-target application at the seam) is the next engineering arc and lands behind the owner gates.
- ARC-2 COMPLETE: the entire deterministic, un-blocked backlog surface is implemented and certified — P0 audit · P1 controller/eligibility · P2 slice/wiring/card + §8A loop · P3 pack/evidence + §8B loop · P4-001 integration · P5-001 motor split · P6-001 replay evaluator · 4-lens checkpoint · minors M1/M3/M4/M5 · beginner-ui consumer. Backend canonical 831/831; frontend vitest 11/11 + tsc clean.
- Remaining (all owner-gated, none forceable by the agent): cue-review decision for the dev cue set (plan law: named specialist review — no agent approval); P3-003 golden corpus (real expert-corrected audio); P6-002 specialist review; P6-003 usability pilot (real beginners); P7 release gates. Wiring-time backlog recorded: schema widening, provenance validation at persistence, barrel exports for the new modules, memo-seam routing, M2 policy-kernel rename, lesson-controller mounting.

### 2026-08-17 — Shadow-card emission increments + review cycles

- Increment 1 (0b49af8): femV1BeginnerCard emitted on the coachingTurn RESULT (never the signal; null in off mode) — buildFemV1ShadowCard maps controller actions to card states, FOCUS_LABELS beginner-language table, honest no-TRY-steps until cue review. 4 new tests + 1 strengthened. Cycle-1 verdict: blocked on one MAJOR (non-ready states shipped the "sounded very similar" fallback — misrepresentation on capture-failure turns) + FOCUS_LABELS minor + comment fix.
- Increment 2 (466777f): MAJOR closed — feedbackForAction composes the CERTIFIED beginnerFeedback() copy for all six non-ready actions (repair_capture fed controllerTurn.captureReasons; ready states keep builder defaults with the calibration/ready phase split). All-states test pins certified copy with zero fallback leakage (counterfactual teeth verified by reviewer trace). FOCUS_LABELS extended to all 7 dimensions. Cycle-2 verdict: VERDICT: pass (MAJOR closed with red-on-revert trace; regression clean).
- Fixture lesson recorded: capture-unusable reaches the signal via three voiceState shapes (lastSummary.metrics.advanced, lastAttemptArtifact.summary, voiceInputRuntime.lastCaptureReliability) through assessCaptureReliability→buildTakeQuality — an invented takeQuality field never reaches capture state.
- Wiring suite 16/16; canonical 836/836. Frontend consumer unchanged (mounting stays behind the owner cue-review gate: a learner-facing card with no TRY steps is not meaningful until cues exist).
- Remaining engineering surface is owner-gated (cue review, P3-003 corpus, P6-002/003 human reviews) or recorded wiring-time backlog.
- Suite of record (2026-08-18, closes the external-review handoff): canonical 837/837 at the tip (brief-correction run, executed-as-written in GPT_PRO_FEM_V1_REVIEW.md: coaching 837/837, frontend vitest 11/11 + tsc exit 0, VoiceTrainer 175+110 per the P0 retained log). The GPT Pro review brief + the main README pointer land after this entry; docs-only, no behavior change.

### 2026-08-17 — §8B review cycle 2: CERTIFICATION PASS — §23 FIRST MILESTONE COMPLETE

- Status: VERDICT: pass (independent xna-reviewer on 6b1a8e2). F2 FIXED (single missing predicate → single named law: only contextKind stripped; byte-exact reason asserted on eligibility.rejected[0]); F3 FIXED (provenance linkage assertion-breaking: afterEvidence/afterObs same attempt artifact + same comparison context; F2 rise 2050>1780 asserted against the validated baseline; settle guards make evidence/observation/settle one physical take transitively); F1 deferral verified honest (word transfer NOT exercised; grounded in BACKLOG word_transfer; "see me" grep-verified copy-only). Regression clean: single commit, production files unchanged from cycle-1 certified state, 786 arithmetic stable.
- MASTER-PLAN §23 FIRST MILESTONE: both loops proven deterministically — §8A comfortable pitch (certified @534414b lineage) and §8B controlled /i/ resonance (certified @6b1a8e2). The complete beginner flow (hear approved example → perform concrete experiment → accurate explanation → repeat → reproduce without constant feedback → causally-verified comfortable retained mastery update) composes end to end under contract fixtures, with in-composition negative invariants at every gate.
- Honest scope: deterministic composition only. Live audio/device proof = P3-003 owner gate (real expert-corrected audio). Active serving = cue-review owner gate (every library cue remains clinical-review-required). The §8B proof additionally found and fixed a real production bug (context identity dropped from trial before-evidence) that unit tests alone had not surfaced.
- Runbook §10 next stage named: at this checkpoint perform a NEW architectural/scientific/safety/beginner-UX review before adding intonation or spontaneous speech. Unblocked work packages remaining: P5-001 motor split, P6-001 replay evaluator, fem-v1/beginner-ui integration, P3-004 (gated on P3-003).

### 2026-08-17 — Review cycle 4: CERTIFICATION PASS

- Status: TV-FEM-P1-001/P1-002 CERTIFIED (VERDICT: pass, independent xna-reviewer on 534414b).
- F7 CLOSED: controllability-decides pair present and mutation-verified against both flipped-comparator and missing-rung mutations.
- NEW-6 CLOSED: ledger counts and history accurate.
- No new findings; no regressions; delta 98bc14b→534414b scoped to test + docs.
- Reviewer capability boundary noted: children are execution-gated; suite greenness rests on the primary's witnessed runs (28/28 controller, 696/696 full, kill-proofed).
- Next dependency: P2 pitch vertical slice on `fem-v1/pitch-vertical` (or continue on controller branch); P1-003 gap (review_due) to be implemented alongside P2-004 fading/retention work.

## Local-agent update template

```markdown
### YYYY-MM-DD — TV-FEM-...

- Status:
- Branch:
- Head SHA:
- Implementation:
- Runtime reachable:
- Tests run:
  - command:
  - result:
- Evidence/artifacts:
- Safety/privacy impact:
- Known gaps:
- Next dependency:
```

## Immediate next action

**P0 + P1-001/P1-002 complete and certified. P2 deterministic layer (P2-001..P2-004) implemented suite-green on `fem-v1/pitch-vertical` @ afb603e.** Next: independent review of the four P2 modules, then runtime wiring (controller + modules behind explicit mode in voice-standalone-runtime; P2 boundary must normalize truthy safety input), then P2-005 beginner card.
