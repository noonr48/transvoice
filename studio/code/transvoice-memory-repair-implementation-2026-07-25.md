# TransVoice memory repair implementation

Date: 2026-07-25
Status: implementation complete and active in the production gateway;
physical-phone acceptance is the explicit remaining gate below.

## Product contract

- Coach is a live spoken TransVoice lesson, never a text chat or messaging interface.
- The Coach surface remains a single no-scroll view with only the preset selector and Start/End control.
- A preset is a named uploaded reference sample. The selected preset is the tutor's exact voice; there is no fallback voice.
- Start resumes the continuing lesson. End pauses it immediately and only the learner decides when to stop.
- Durable memory is compact semantic continuity, never a transcript, message history, or raw recording.

## Repair boundary

This change repairs the persistence and orchestration layers without expanding the Coach UI:

1. One canonical, exact target binding shared by learner profile, checkpoint, and live session.
2. Learning state scoped by target voice so one preset cannot contaminate another.
3. Checkpoint recovery that reconstructs a missing live session only when the exact preset is still verifiable.
4. Privacy-safe session persistence that strips conversation text and transcripts.
5. Complete reset and delete operations across learner, runtime, every owned
   session generation, and the optional evaluation ledger.
6. Corruption quarantine, previous-generation recovery, and explicit storage health witnesses.
7. Due-review derivation at read time and canonical preference IDs with deterministic effects.
8. Start/End success coupled to durable session/checkpoint writes, with
   physical input stopped on every End outcome.
9. Isolated, complete-roster evaluation and product-law gates; live evaluation
   is opt-in and categorical.
10. One visible phrase-or-pronunciation representation with native text
    enlargement and a truthful keyboard-operable preset disclosure.

## Seam map

| Producer | Seam | Consumer | Required witness |
|---|---|---|---|
| Preset selection | target binding | profile, checkpoint, runtime session, TTS | same target key and reference clip everywhere |
| Voice attempt | semantic learning update | target-scoped learner bucket | no transcript in durable records |
| Start | checkpoint recovery | live spoken session | exact preset restored and durably rebound or categorical fail-closed error |
| End | compact checkpoint/session ring | next Start | input stopped; successful response requires durable learner-stopped state |
| Reset/delete API | profile + every session generation + eval ledger | learner privacy controls | idempotent verified deletion receipt with per-store counts |
| File read/write | backup + quarantine | runtime health | recovery/failure state and last error |
| Snapshot read | schedule clock | tutor signal | newly due concepts appear without a fresh attempt |
| Preference utterance | canonical rule ID | prompt/TTS policy | grounded ID and observable deterministic effect |

## Evidence ledger

- [x] Target binding and target isolation:
  `backend/learner-context-v6-repair.test.js`,
  `backend/voice-coach-continuity.test.js`.
- [x] Missing-session recovery, corrupt-profile Start failure, explicit A/B
  rebinding, and checkpoint-write rollback:
  `backend/voice-coach-continuity.test.js`.
- [x] Durable session privacy:
  `backend/voice-session-memory-repair.test.js`,
  `backend/learner-context-runtime-control.test.js`.
- [x] Reset/delete across primary, backup, corrupt, and temporary generations
  plus evaluation rows, including a prefix-colliding dotted learner ID and
  unrelated sibling preservation:
  `backend/learner-context-runtime-control.test.js`,
  `backend/learner-context-v6-repair.test.js`.
- [x] Corruption recovery and write blocking:
  `backend/learner-context-v6-repair.test.js`,
  `backend/voice-session-memory-repair.test.js`. Delete All also has an exact
  unrecoverable-primary/no-backup regression: it scrubs the quarantined
  generation first, re-verifies zero learner records, rebuilds clean
  primary/backup generations, and preserves the unrelated session.
- [x] Due reviews derived on read:
  `backend/learner-context-v6-repair.test.js`.
- [x] Canonical preference grounding and deterministic output/TTS effects:
  `backend/coaching/sanitizer.contract.test.js`,
  `backend/coaching/signal-builder-memo.test.js`,
  `frontend/src/voice/host-orchestration-config.test.ts`,
  `frontend/src/voice/coach-speech.test.ts`.
- [x] Required Start/End durability, new-session compensation,
  End-always-stops capture, and End-as-pause continuity:
  `backend/voice-coach-continuity.test.js`.
- [x] Stale session target B is rebound to selected target A before persistence
  and VoxCPM receives only A:
  `backend/voice-coach-continuity.test.js`,
  `backend/voice-standalone-integration.test.js`.
- [x] Raw SSE text withheld until sanitization:
  `backend/voice-stream-sanitization.test.js`.
- [x] Bounded single-event and rotating ledgers:
  `backend/learner-context-v6-repair.test.js`.
- [x] Evaluator isolation, categorical-by-default privacy, complete-roster
  gating, and visible operation-markup failure:
  `backend/eval/coaching-eval.privacy.test.js`,
  `backend/eval/isolated-runtime.test.js`,
  `backend/eval/memory-use-product-laws.test.js`,
  `backend/eval/quality-suitability-eval.test.js`.
- [x] Live-model isolated evaluation after the complete-roster/privacy repair:
  `backend/eval/reports/memory-use-eval.2026-07-25T12-18-34-564Z.json`;
  6 expected, 6 scored, 0 errored or fallback turns, complete-roster gate true,
  every immutable Coach/memory gate true, production stores unopened, temporary
  stores cleaned. A model-down or skipped exit-zero run remains explicitly
  non-evidence.
- [x] Focused final-blocker suites:
  evaluator/sanitizer adversarial probes → 20 passed, 0 failed; corrupt-delete,
  durable-session, and product-law probes → 16 passed, 0 failed.
- [x] Full backend suite:
  `rg --files backend -g '*.test.js' | sort | xargs node --test` → 671 passed,
  0 failed.
- [x] Full frontend suite: `cd frontend && npm test` → 96 files passed,
  706 tests passed, 2 skipped.
- [x] TypeScript/production build: `cd frontend && npm run build` → 112
  modules transformed; build succeeded. The 588.73 kB runtime chunk warning is
  pre-existing performance debt, not a build failure.
- [x] Headless no-scroll maximum-content proof:
  `node studio/code/verify-coach-thumb-zone.mjs` → pass at 360×620; document
  620/620, canvas 290/290, exact 160-character pronunciation contained as the
  single representation, only preset and Start visible, Start center at
  two-thirds height.
- [x] Compact/enlarged typography proof:
  `node studio/code/verify-coach-instruction-fit.mjs` → phrase and
  pronunciation pass at 320×568 and synthetic 150% text on 360×620; both
  document and canvas scroll dimensions equal their client dimensions, with
  the enlarged font exactly 1.5× its base and no inline counter-scale. The
  capture-ready label also grows from 14px to 21px with a 29px client/scroll
  height, so it is not clipped.
- [x] Preset disclosure semantics:
  `node studio/code/verify-coach-preset-disclosure.mjs` → non-modal region,
  focus enters after load, Escape closes/restores, Cancel keeps the disclosure
  open and focuses Upload.
- [x] Served source/dist parity: `/app` serves
  `voice-runtime-CtnQdtZD.js`; local and served SHA-256 match, and the bundle
  contains the late-load active-element focus guard.
- [x] Independent final reviews: UI/accessibility/rollback PASS;
  evaluator/doctrine PASS after 25 adversarial probes; privacy/lifecycle PASS
  after a 149-test final gate, including corrupt-no-backup recovery and
  byte-identical unsupported-schema rejection.

## Implementation paths

- Learner schema, exact-target state, backup/recovery, retention, reset/delete:
  `backend/learner-context-service.js`.
- Cross-store deletion transaction and receipts:
  `backend/learner-context-route-handlers.js`,
  `backend/voice-standalone-runtime.js`.
- Checkpoint resume/rebinding, fail-closed Start, privacy-safe session storage,
  sanitized streaming: `backend/voice-standalone-runtime.js`.
- Final spoken-output law and deterministic preference enforcement:
  `backend/coaching/sanitizer.js`.
- Isolated behavioural gates and privacy-bounded runtime ledger:
  `backend/eval/memory-use-eval.js`,
  `backend/eval/quality-suitability-eval.js`,
  `backend/eval/coaching-eval.js`.
- Settings API and single-screen instruction fit:
  `frontend/src/voice/learner-memory-settings.ts`,
  `frontend/src/voice/coach-surface.ts`,
  `frontend/voice-tutor-app.html`.

## Activation and rollback

The frontend build writes the served artifacts to `dist/`; the gateway reads
those static files from disk. Backend changes were activated with:

```bash
systemctl --user restart voice-tutor-standalone.service
curl --fail http://127.0.0.1:3021/voice/standalone/readiness
```

Activation receipt (2026-07-25 21:49 ACST):

- the installed unit remained the machine-owned
  `/home/USER
- the process changed from PID 354576 to PID 738692 and remained
  `active/running`, `NRestarts=0`;
- `/health` returned online with learner and session memory healthy,
  `writeBlocked=false`, schema `voice-standalone-sessions-v2`;
- active readiness returned online for all eight probes: learner store,
  session-store write, VoiceTrainer start/stream/cleanup, GGUF chat, VoxCPM,
  and ASR;
- `/app` served the reviewed `voice-runtime-CtnQdtZD.js`.

Do not replace the installed user unit with the repository example:
`deployment/systemd/user/voice-tutor-standalone.service` targets a deployment
path, while this machine's installed unit intentionally targets the home
worktree.

If activation fails, use the sealed, smoke-tested containment release and exact
commands in `studio/code/transvoice-rollback-2026-07-25.md`. Its prepared
archive SHA-256 is
`28cc91ccc396f0f911a54a1aacf2550996b906a1baa8e9d54056fc539cece465`.
The transient rollback unit leaves this inherited dirty worktree untouched.

## Remaining acceptance boundary

- A physical Android phone is not currently attached. After attachment, run
  `adb devices -l`, open the Tailscale-served Coach, test normal and enlarged
  Android font settings, and complete one audible selected-preset turn.
- The audible turn must prove: Ready → Hearing → Thinking → Speaking, the full
  response is not cut off, the exact selected cloned preset is used, and End
  immediately closes live capture.
