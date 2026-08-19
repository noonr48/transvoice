# TransVoice First-Call Runbook

This runbook has two separate phases. **OFFLINE_READY means only that static checks passed. It does not mean the live call is ready or authorized.** All service, browser, microphone, session, model, and TTS checks remain deferred.

## OFFLINE_READY

### Offline command

From `/home/USER run only:

```bash
node scripts/preflight-first-call.cjs
```

Do not substitute another doctor, starter, endpoint check, or process inspection. During this phase, HTTP 503 responses or degraded dependency reports are expected because dependencies are intentionally not running or tested. They do not justify starting anything.

### Status meanings

Plain-language terms used by the preflight:

- `baseline`: the approved starting commit used to detect unexpected repository changes.
- `lease`: the exact files this work is allowed to change.
- `CLEAN_BASELINE`: a call-critical file still matches its accepted committed version, and its focused offline checks pass.
- `OWNED_VERIFIED`: a changed call-critical file has a known owner and purpose, reviewed content, stable hashes, and passing focused offline checks.
- `mutation`: a deliberate small defect placed in a temporary copy to confirm that the tests catch it.
- `hermetic`: the check uses only approved local files and controlled test substitutes. It does not contact live services, devices, or the network.

- `OFFLINE_READY` with exit `0`: every blocking offline check passed. Request a separate first-live authorization; do not proceed automatically.
- `BLOCKED` with exit `1`: required ownership, custody, configuration, or evidence is unknown. Stop.
- `FAIL` with exit `1`: an offline requirement failed. Stop.
- Internal error with exit `2`: the preflight could not make a trustworthy decision. Stop.
- `PASS`: one offline check passed.
- `WARN_DO_NOT_USE`: current static evidence is readable and accepted only with the named component left unused.
- `DEFERRED`: a `FIRST_LIVE_ONLY` check was deliberately not performed.
- `BLOCKING_UNKNOWN`: evidence is missing or ambiguous; `offlineReady` must be `false`.

### Config check

The preflight must statically read `/home/USER and compare its current SHA-256 with the reviewed SHA-256:

`3986d991cf0fa9a4fe65346f0ee3948a0af9e95e126c9f80a0182f3d0955b018`

It must parse the current `Environment=`, `After=`, and `Wants=` entries. It must not query or control the service manager.

| Current static result | Required decision |
|---|---|
| Missing or unreadable | Record only the path/read error. Report `FAIL` or `BLOCKING_UNKNOWN`, set `offlineReady=false`, and stop. |
| Reviewed hash | Confirm from the current bytes that `VOXCPM_ENABLED=true`, `VOXCPM_URL=http://127.0.0.1:8020`, and no VoxCPM unit appears in `After=` or `Wants=`. Only then may agent-process ownership plus explicit non-use produce `WARN_DO_NOT_USE`. Any mismatch or ambiguity blocks. |
| Different readable hash | Parse only the fresh current values and explicitly evaluate planned use and ownership. Ambiguity or conflict blocks. A warning is non-blocking only when agent-process remains the owner and the unit will not be used, reloaded, edited, or enabled. |

Never use, reload, edit, enable, or promote that dormant gateway unit. Never use or promote `scripts/start-all-with-tts.sh`. The future gateway owner is **agent-process**, for both startup and stopping.

### Evidence location

Read the generated receipts under:

`/home/USER

The final decision must include the preflight JSON/stderr, custody evidence, test and mutation receipts, installed-unit receipt, leased-file hashes, reviews, and the sorted SHA-256 ledger. Evidence must contain no credentials, learner speech, audio, session IDs, model output, or live responses.

### Offline checklist

- [ ] The command reports `overall: OFFLINE_READY`, `offlineReady: true`, and exit `0`.
- [ ] The branch matches the approved `baseline`, and every change stays within the `lease`.
- [ ] Syntax, the exact 26-test suite, `mutation` checks, the `hermetic` check, and runbook checks pass.
- [ ] Every call-critical path is `CLEAN_BASELINE` or `OWNED_VERIFIED`.
- [ ] No custody entry is `BLOCKING_UNKNOWN`.
- [ ] `processOwner` is `agent-process`.
- [ ] The installed-unit result follows the table above and cites a readable current parse and current hash.
- [ ] Every live check remains `DEFERRED` with reason `FIRST_LIVE_ONLY`.

## Blockers and Stop Conditions

Stop without any live action if any of these occurs:

- The branch or baseline is wrong, a leased hash drifts, or another repository path changes.
- Any custody item is `BLOCKING_UNKNOWN`, any test or mutant gate fails, or an unexpected route/device/network action appears.
- The installed unit is missing, unreadable, ambiguous, selected for use, or conflicts with agent-process ownership.
- Process ownership is unclear, protected staged work changes, or evidence is incomplete.
- One session ID can be ended more than once across normal POST and unload-beacon transports.
- A live check is reported as passed during the offline phase.

## FIRST_LIVE_ONLY — Deferred and Not Authorized

Do not perform this section now. It requires a later explicit authorization and a fresh resource-safe check confirming that no protected work would be disturbed.

### Startup dependency order for later

When separately authorized, start and verify one dependency at a time under an identified owner:

1. Confirm resource safety and protected-work boundaries.
2. Start the model/inference dependency and verify its bounded health check.
3. Start VoxCPM TTS and verify its bounded readiness check.
4. Start the TransVoice gateway with agent-process and verify gateway health.
5. Open `/coach`.
6. Through a user gesture, check browser `SpeechRecognition` support and microphone permission. `/coach` uses the browser for speech recognition; there is no separate ASR service to start.
7. Run one short supervised exchange only.

Do not continue after a failed or degraded dependency. Do not use a convenience starter or service-unit fallback.

### Minimal first-call script

- Learner: “Hello. This is a short microphone check.”
- Coach: return one short response.
- Learner: “Thank you. End the test.”
- Operator: select **End** once, confirm the page returns to Idle/Waiting/0, then stop the test.

### Exactly-once End expectations

- Normal End sends one bounded session-end POST for the nonempty active session ID and no unload beacon.
- A later page unload sends nothing for that already-ended ID.
- If unload is the first cleanup owner, it sends one beacon and no POST.
- A failed transport attempt is still one attempt; there is no retry or cross-transport fallback.
- The final UI is Idle/Waiting/0 with Start enabled, End disabled, and `data-ready=true`.

### First-live stop conditions

Stop the supervised check immediately on a failed health gate, unexpected permission prompt, duplicate session cleanup, stale active UI, unexpected route, private-data exposure, unstable audio, or resource conflict. Preserve the bounded evidence and do not improvise a fallback.

### Rollback

Use the same named agent-process owner that started the gateway to stop it. Stop later-started dependencies in reverse startup order, but only through each dependency's recorded owner. Re-run the offline preflight after any configuration or code rollback. Do not alter shared staged work or unrelated dirty files.

## Protected Work Warning

This machine may be running expensive training or GPU work. Before any future live authorization, identify the owners and resource boundaries without disturbing them. If ownership or resource safety is uncertain, stop and leave all live checks deferred.
