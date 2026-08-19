# TransVoice containment rollback — 2026-07-25

This is the exact recovery handoff for the 2026-07-25 gateway activation. It
does not modify, reset, or check out the inherited dirty worktree.

## Sealed artifact

- Prepared release:
  `/home/USER
- SHA-256:
  `28cc91ccc396f0f911a54a1aacf2550996b906a1baa8e9d54056fc539cece465`
- Extracted release:
  `/home/USER
- Source commit:
  `a7a8c33166ef22eb6099a69c6ea769264c4884f7`

The prepared artifact includes production dependencies. The source commit
omitted its required `multer` package from `package.json`, so the sealed
release supplements it with `multer@2.2.0` without changing application
source. Its internal `ROLLBACK-MANIFEST.md` records that exception.

Verify the artifact:

```bash
cd /home/USER
sha256sum --check studio/code/transvoice-rollback-a7a8c331.sha256
```

If the extracted release is missing, restore it without touching the
application worktree:

```bash
mkdir -p /home/USER
tar -xzf /home/USER \
  -C /home/USER
```

## Activate the containment release

Stop only the current gateway, then launch the sealed release as a separate
transient unit on the same local port:

```bash
systemctl --user stop voice-tutor-standalone.service
systemd-run --user \
  --unit=voice-tutor-standalone-rollback \
  --collect \
  --property=Type=simple \
  --property=WorkingDirectory=/home/USER \
  --setenv=NODE_ENV=production \
  --setenv=VOICE_STANDALONE_HOST=127.0.0.1 \
  --setenv=VOICE_STANDALONE_PORT=3021 \
  --setenv=VOXCPM_ENABLED=true \
  --setenv=VOXCPM_URL=http://127.0.0.1:8020 \
  --setenv=VOICE_ASR_ENABLED=true \
  --setenv=VOICE_ASR_URL=http://INTERNAL_HOST:PORT \
  --setenv=VOICE_ASR_API_STYLE=simple \
  --setenv=VOICE_ASR_LANGUAGE=en \
  --setenv=VOICE_ASR_TIMEOUT_MS=10000 \
  --setenv=VOICE_ASR_LIVE_MODE=buffered \
  --setenv=SMART_TURN_ENABLED=true \
  --setenv=SMART_TURN_PYTHON_PATH=/home/USER \
  --setenv=SMART_TURN_MODEL_PATH=/home/USER \
  --setenv=SMART_TURN_TIMEOUT_MS=500 \
  --setenv=VOICE_LIVE_CANDIDATE_SILENCE_MS=1800 \
  --setenv=VOICE_LIVE_FALLBACK_SILENCE_MS=4500 \
  --setenv=VOICE_LIVE_SEMANTIC_THRESHOLD=0.65 \
  --setenv=VOICE_LIVE_MAX_AUDIO_BYTES=4194304 \
  /usr/bin/node \
  /home/USER
curl --fail http://127.0.0.1:3021/health
curl --fail --output /dev/null http://127.0.0.1:3021/app
```

The smoke proof ran this same transient-unit mechanism at `127.0.0.1:39222`
with an isolated state root. `/health` and `/app` both returned HTTP 200, then
the transient unit stopped cleanly.

## Return to the repaired release

```bash
systemctl --user stop voice-tutor-standalone-rollback.service
systemctl --user start voice-tutor-standalone.service
curl --fail http://127.0.0.1:3021/voice/standalone/readiness
```

This artifact is a bootable containment baseline. It intentionally predates
the current memory deletion, evaluator privacy, exact selected-preset TTS, and
Coach accessibility repairs, so it is not a substitute for fixing a failed
activation.
