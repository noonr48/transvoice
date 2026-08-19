# Deep-review: TransVoice memory and Coach trust repair

Band: GATED (F>20 C=1 I=1 S=1) · Medium: code + system + document ·
Date: 2026-07-25 · Status: GATED PASS ACTIVE — physical-phone acceptance is
the sole explicit residual

## SPEC (R-G1)

ASK (VERBATIM): “ok, let's fix all of those issue.. agentically proceed”

The demonstrative “those” inherits the immediately preceding comprehensive
memory-system review plus the three independent BLOCKED verdicts.

### Clauses (WHAT)

| # | clause | evidence artifact | verdict |
|---|---|---|---|
| 1 | fix all reviewed memory/Coach issues | Finding-by-finding table below plus fresh focused/full/evaluator/render receipts in `studio/code/transvoice-memory-repair-implementation-2026-07-25.md` | MET on disk; activation/phone residual explicit |
| 2 | proceed agentically | implementation, adversarial proof creation, live isolated model eval, production build, independent reviewer dispatch | MET |

### Instructions (HOW)

| # | instruction | honored — evidence |
|---|---|---|
| 1 | Coach is voice based, not text messaging | `docs/VOICE_COACH_MEMORY_CONTRACT.md`; evaluator `no_messaging_frame=6/6`; visible Coach has no messaging affordance |
| 2 | exactly preset plus Start/End; one no-scroll view | `frontend/voice-tutor-app.html`; `verify-coach-thumb-zone.mjs` pass with exact two controls |
| 3 | presets are named uploaded samples and selected preset is exact tutor voice | exact target binding/recovery/rebind tests; TTS clone fail-closed tests |
| 4 | Start resumes; End pauses; learner alone controls lifetime | checkpoint and lifecycle tests; sanitizer session-control tests; evaluator no-stop/no-warmup 6/6 |
| 5 | no forced warm-up, padding, rest, stop, or closing | renderer/sanitizer/product-law tests; Wave 3 doctrine supersession |
| 6 | one text area for current phrase/pronunciation, no transcript/history | Coach canvas markup; persisted-session privacy tests |
| 7 | memory must be properly prepared | schema v6, target-scoped learning, compact checkpoint, isolated eval, learner controls |
| 8 | preserve unrelated dirty-worktree changes | targeted edits only; no reset/checkout/commit/push |

### Inherited reviewer table (TABLE-MAP)

| reviewer row key | disposition and proof |
|---|---|
| corrupt checkpoint read falls open | strict readable Start + corrupt-profile regression |
| prefix-colliding learner delete | exact anchored artifact ownership + dotted-neighbor regression |
| raw SSE before sanitizer | content buffering + `voice-stream-sanitization.test.js` |
| BREATHER/CONVERSE gains a cue | action-aware removal + contract regression |
| single event exceeds retention cap | categorical hashed oversize event + 4 KiB regression |
| slower pace N/A/absent | sixth isolated learner; runtime-effect hard gate 6/6; 0.65 cloned-TTS request proof |
| Wave 3 cooldown doctrine contradiction | explicit runtime-law supersession and tooling-only clarification |
| deleted session remains in `.bak` | two required clean generations; primary and backup assertions |
| explicit session A/profile B drift | exact target rebind before live input + A/B regression |
| repair reintroduces unsafe cue | finite code-owned repair cues + final safety pass + malicious-state regression |
| max spoken words advisory only | sentence-safe final bound; cue/vocabulary/tone policy enforcement tests |
| profile Save Details uses PUT | frontend POST aligned with registered backend POST + request test |
| compact/enlarged instruction clips | one visible 120-or-160 representation; native 150% typography and DOM scroll/containment receipts |
| handoff ledger empty | implementation paths, commands/results, sealed smoke-tested rollback, activation, residual phone gate |
| preset menu semantics | truthful non-modal `role="region"`; async focus, Escape restore, Cancel, and stale-load regressions |
| corrupt/temp session and eval remnants survive Delete All | all anchored generations plus active or dormant learner/session eval rows removed and verified; unrelated siblings preserved |
| unrecoverable corrupt primary blocks Delete All before scrub | privacy-first artifact scrub; zero-target re-verification; narrowly scoped corrupt-JSON write recovery; clean primary/backup rebuild regression |
| partial/error/fallback evaluator roster passes | per-turn error/fallback failure plus complete-roster and raw-completeness hard gates; skipped/model-down runs are non-evidence |
| lifecycle persistence is best effort | Start compensation and End-always-stops capture; success requires durable session/checkpoint state |
| target A changes to B during in-flight tutor speech | target-transition abort plus exact target fingerprint revalidation before generation and throughout streaming |
| slow preset load steals focus from upload form | late focus move requires the disclosure trigger still owns focus |
| enlarged capture-ready status clips | em-sized activity box plus explicit 150% client/scroll-height proof |

## EVIDENCE (R-G2)

RAN (frozen implementation):

- full backend: 671 passed, 0 failed;
- full frontend: 96 files, 706 passed, 2 intentional skips;
- TypeScript/Vite production build: 112 modules, success;
- final isolated live-model report:
  `memory-use-eval.2026-07-25T12-18-34-564Z.json`, 6/6, zero
  error/fallback turns, complete roster/all hard gates true, isolated stores
  cleaned;
- headless instruction fit, thumb-zone, and preset-disclosure scripts: PASS;
- `git diff --check` and changed JavaScript syntax checks: PASS;
- installed gateway restart/readiness/health: PASS.

GREEN receipts already obtained on the current tree:

- focused evaluator/sanitizer: 20 passed, 0 failed;
- focused corrupt-delete/session/product-law: 16 passed, 0 failed;
- full backend discovery/run: 671 passed, 0 failed;
- frontend: 96 files, 706 passed, 2 skipped;
- TypeScript + Vite build: success, 112 modules;
- isolated model eval:
  `memory-use-eval.2026-07-25T12-18-34-564Z.json`; 6 expected, 6 scored,
  0 errored or fallback turns, complete roster true, every immutable gate true,
  production stores unopened, temporary stores cleaned;
- headless max-content 360×620: every geometry check true.
- compact/enlarged render: phrase and pronunciation at 320×568 and synthetic
  150% text at 360×620 keep document/canvas scroll dimensions equal to client
  dimensions without inverse scaling;
- preset disclosure headless proof: focus enters after load, Escape restores,
  and Cancel stays open/focuses Upload;
- rollback transient-unit smoke: sealed baseline `/health` and `/app` both HTTP
  200 without touching the dirty worktree.

NOT-HAPPY:

- corrupt profile Start rejects before session creation;
- dotted neighboring learner survives delete;
- both session primary and backup exclude deleted learner;
- malicious unsafe imported cues never reach final output;
- BREATHER/CONVERSE forbidden session-control text becomes non-coaching;
- a 12 KiB event becomes a bounded categorical hash record;
- checkpoint write failure rolls active capture back.
- End persistence failure still stops physical input and cannot report success;
- Delete All removes valid/corrupt/temp session generations and target/legacy
  eval rows while preserving unrelated learners.
- Delete All succeeds from an unrecoverably corrupt primary with no backup,
  removes its quarantined private bytes, rebuilds clean primary/backup
  generations, and retains the unrelated live session.

PROOF-CREATION: created
`sanitizer.contract.test.js`, `voice-stream-sanitization.test.js`, dotted-ID,
backup-generation, corrupt-Start, A/B rebind, checkpoint-failure, oversized
event, runtime preference, cloned-TTS rate, and instruction-fit checks.

INHERITED (S=1): all inherited claims were re-probed locally; the first
independent review was BLOCKED and every named defect received a regression.

## WIRING (R-G2.5)

CONSUMERS:

- learner profile route writer/reader: backend POST registration ↔ frontend
  settings client/test;
- target binding: preset selection/recovery/Start ↔ profile/checkpoint/session
  ↔ cloned TTS;
- sanitizer: buffered and streaming coach paths ↔ final TTS/evaluator;
- session persistence: reset/delete handler ↔ primary/backup store;
- Coach canvas: source HTML/TypeScript ↔ Vite-generated `dist/` ↔ gateway
  `/app`;
- external activation: installed user systemd unit; repository example is
  intentionally not copied over it.

REACHABILITY: Vite regeneration is complete; the gateway serves
`voice-runtime-CtnQdtZD.js`, whose served/local SHA-256 match and whose bundle
contains the late-focus guard. Backend is active in PID 738692 after the
installed `voice-tutor-standalone.service` restart; all eight readiness probes
and both memory-store health gates are online.

TWINS: buffered/streaming sanitizer paths, primary/backup session generations,
profile/checkpoint/session/TTS target identity, source/dist Coach markup, and
runtime/evaluator preference contracts are covered as protocol halves.

CONSISTENCY: the implementation is checked against
`docs/VOICE_COACH_MEMORY_CONTRACT.md`; no Coach-surface memory controls or
message history were added.

INSTRUMENTATION: target/checkpoint/deletion/sanitizer events are categorical;
raw response/audio/transcript text is excluded. New seams have failure tests and
isolated receipts.

DERIVED-DIFFS: generated `dist/` and the new evaluator JSON report were read;
the report is isolated/clean and the build carries the expected hashed assets.

RIPPLE: frontend API change updated its test; sanitizer change updated both
paths and evaluator; persistence change updated backup assertions; documentation
historical audit now declares supersession. Frontier pending independent review.

## ADVERSARIAL (R-G3)

### Mirror

- WEAKEST: physical Android font scaling and audible selected-preset playback
  cannot be tested without an attached phone → reviewer focus and explicit
  acceptance residual.
- MISSING: SITUATION shift performed: the gateway process predates backend
  changes → activation is a named final gate, not silently claimed.
- PUNTS:

| decision | alternative | surfaced |
|---|---|---|
| show one phrase-or-pronunciation representation and honor native font enlargement | stack both representations or counter-scale enlarged text | implementation handoff and UI reviewer focus |
| buffer model text until complete sanitization | token-by-token partial display | streaming regression and handoff |
| sealed transient-unit rollback while worktree is dirty | destructive blanket checkout | exact rollback handoff and transient-unit smoke |

### Premortem

1. Typography fit passes desktop Chromium but Android accessibility scaling
   behaves differently.
2. Restarted gateway loads code but exact cloned TTS/audible completion still
   fails on the phone.
3. An unknown future artifact class is added without joining the verified
   Delete All inventory.

### Fix-claims and process causes

- API method mismatch: contract was mocked on only one side →
  guard=request-method regression against registered POST.
- prefix deletion: filename prefix was mistaken for ownership →
  guard=anchored exact-artifact patterns plus colliding-ID test.
- stale backup: tests inspected only the primary generation →
  guard=two-generation persistence and primary+backup assertions.
- unsafe repair: post-filter insertion lacked a second boundary →
  guard=finite repair vocabulary, final guards, malicious-state test.
- raw SSE: final payload was treated as the only consumer →
  guard=wire-level no-raw-content regression.
- clipping/accessibility: accepted content bounds were not rendered at
  compact/enlarged geometry → guard=one-representation max-contract render,
  native 150% enlargement, and no-inline-scale assertions.
- false evaluation green: the successful subset was mistaken for the planned
  run → guard=complete-roster/raw-completeness hard gates.
- incomplete deletion: only clean primary/backup files were inventoried and
  persistence ran before scrub → guard=privacy-first anchored all-generation
  scan, dormant eval-row hash, post-delete verification, and corrupt-primary
  rebuild regression.

CLASS SWEEP: each finding was searched across its class: all session-control
actions, all owned learner artifacts, both persistence generations, both coach
response paths, all canonical preferences, and source/generated Coach surfaces.

REVIEWER (GATED): all three independent re-reviews PASS:

- design/usability + rollback: native 150% status fit, focus race, served
  source/dist hash, and rollback proof;
- runtime/evaluator doctrine: 25 adversarial probes, fixed-evaluator report and
  pointer audit, historical-doctrine supersession;
- code/privacy/lifecycle: 149-test gate plus independent stale-target,
  Start/End compensation, corrupt/no-backup rebuild, and byte-identical
  unsupported-schema probes.

## CLOSE (R-G4)

TRACE: clause/instruction → change → evidence is recorded in the SPEC and
TABLE-MAP above.

RESIDUALS:

- physical-device acceptance: no ADB device attached → fires when
  `adb devices -l` lists the phone;
- containment rollback: sealed prepared commit archive, SHA-256 manifest,
  installed dependencies, and transient-unit HTTP smoke are recorded in
  `studio/code/transvoice-rollback-2026-07-25.md`.

ACTIVATION:

- frontend `dist/`: rebuilt; served from disk;
- backend: ACTIVE; installed unit PID 738692, zero restarts, health/readiness
  online, session schema v2 and both memory stores unblocked;
- phone acceptance: INERT until device attachment.

TRIAD and STOP: independent review, frozen-tree verification, and live
activation are PASS. Physical phone acceptance stays the sole explicit
residual.
