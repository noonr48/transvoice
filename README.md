# TransVoice

**Open-source voice-feminization training software.** A deterministic coaching
engine that helps adult beginners (MTF/transfeminine) learn a comfortable,
sustainable speaking voice through evidence-based motor learning — one skill
at a time, with strict measurement honesty and safety-first design.

## What this is

TransVoice is a voice-training companion built on a core principle:
**deterministic code decides what to teach; language models only phrase it.**

The coaching engine (Node.js) runs a fixed decision ladder every turn:

```
safety stop (pain always halts) → capture repair → difficulty reduction
→ pending-trial resolution → curriculum phase → metric eligibility
→ deterministic ranking → approved-cue serve → beginner card
```

Around it: a Python DSP analyzer (FastAPI + parselmouth/Praat), a pitch
tracker with laryngograph-validated ground truth, controlled-vowel formant
evidence contracts, feedback fading, exact-next causality enforcement, and a
replay evaluator that measures the coaching itself.

**Status:** research/development. The deterministic control plane is
composition-proven and shadow-tested (865+ tests); acoustic validation
against human corpora and clinical cue review are in progress. No
learner-facing activation until those gates pass. See
`docs/FEMINIZATION_V1_STATUS.md` for the full operational ledger.

## Design laws (non-negotiable)

- No gender/passing/femininity score — pitch is a graded motor variable,
  not a classification.
- No anatomical claims from acoustics.
- Pain stops training. Always. Mid-settlement included.
- Missing evidence is unknown — never zero, never success.
- A cue earns causal credit only when genuinely served and acknowledged,
  and only from the exact next eligible attempt.
- Shadow decisions never mutate learning state.
- Unreviewed cues cannot be served — no env-var shortcuts.

## Quick start (development)

```
# Backend coaching engine
npm install --prefix backend --ignore-scripts --no-audit --no-fund
node --test backend/coaching/*.test.js

# Frontend
cd frontend && npm install
npx vitest run && npx tsc --noEmit

# VoiceTrainer (Python DSP service)
cd services/voice-trainer
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest httpx
.venv/bin/python -m pytest
```

Requires Node ≥ 22, Python ≥ 3.12. See `AGENTS.md` for the agent-facing
entry point and `docs/` for the full specification set.

## License

**AGPL-3.0** (see `LICENSE`). If you run a modified version as a network
service, you must offer its source to those users. Contributions back are
required by the license terms — fork, improve, publish, contribute.

## Contributing

PRs welcome. Small scoped changes preferred (see the PR discipline in
`docs/FEMINIZATION_V1_AGENT_EXECUTION.md`). Safety-relevant changes require
test coverage; the CI gates are the coaching suite + frontend + analyzer.

This project handles sensitive voice data. Never commit recordings,
learner profiles, or session artifacts — the repo carries source and
synthetic test fixtures only.
