#!/usr/bin/env bash
# Run the voice-trainer Python suite as part of the repo gate.
#
# WHY THIS EXISTS: these tests were orphaned. No pytest.ini, no pyproject.toml,
# and nothing in any script or CI file invoked pytest — the runner existed only
# as a binary inside services/voice-trainer/.venv. So the DSP / target-preset /
# security tests could not go red unless a human typed the command, which meant
# changes to the voice-analysis half of the app shipped unverified.
#
# It FAILS LOUDLY when the venv is missing rather than skipping. A gate that
# quietly skips is the problem this fixes, not a milder version of it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="$ROOT/services/voice-trainer"
PY="$SERVICE/.venv/bin/python"

if [ ! -x "$PY" ]; then
  cat >&2 <<EOF
[TransVoice] Python tests CANNOT RUN: no virtualenv at
  $SERVICE/.venv

The voice-analysis half of this app (DSP, target presets, streaming, security)
is tested only here, so this is a real gap in the gate, not a formality.

Create it with:
  bash $SERVICE/setup-venv.sh

To run the JS gates alone while you sort that out:
  npm run test:backend && npm run test:frontend
EOF
  exit 1
fi

cd "$SERVICE"
exec "$PY" -m pytest "$@"
