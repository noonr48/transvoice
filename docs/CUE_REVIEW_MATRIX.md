# Cue Evidence Matrix

**Status:** superseded specialist-gate model replaced for Pitch Shadow Alpha  
**Current executable authority:** `backend/coaching/cue-alpha-qualification.js`  
**Clinical claim:** none

This document used to require a named specialist signature before any first-release cue could progress. That made specialist availability an external staffing dependency. For the pitch-only alpha, that gate is replaced by the deterministic non-clinical qualification contract in `CUE_QUALIFICATION.md`.

External specialist review can still be attached later as additional evidence. It must not be fabricated or backfilled as if it already occurred.

## Current cue matrix

| Cue | Alpha scope | Current authority | Demonstration |
|---|---|---|---|
| `pitch.register.small-glide-up.v1` | Pitch foundation, learner below reachable target | Eligible for executable non-clinical qualification | Not required for text-only alpha |
| `pitch.register.small-glide-down.v1` | Downward pitch correction | Not in pitch-alpha allowlist | Not applicable |
| `resonance.front-vowel.ee-anchor.v1` | Resonance | Research only | Future evidence contract required before activation |
| `resonance.round-vowel.oh-anchor.v1` | Resonance | Research only | Future evidence contract required before activation |
| `phonation.source-weight.vz-flow.v1` | Phonation/source weight | Research only | Future evidence contract required before activation |
| `phonation.clarity.m-onset.v1` | Phonation/breathiness | Research only | Future evidence contract required before activation |
| `prosody.contour.hum-then-words.v1` | Prosody | Research only | Future evidence contract required before activation |
| `articulation.vowel-isolate-transfer.v1` | Articulation/resonance | Research only | Future evidence contract required before activation |
| `transfer.same-sentence.v1` | Transfer | Research only | Not on pitch-alpha critical path |

## Pitch-alpha qualification evidence

The primary pitch cue may qualify only when the executable rubric verifies all of these properties from the cue object itself:

- cue identity is explicitly in the narrow alpha allowlist;
- scope is `pitch.register` and direction matches upward correction from below target;
- safety object requires stop on pain, stop on increasing strain and never force;
- effort, pressedness and loudness are protected metrics;
- instruction uses a bounded small step and comfort/ease framing;
- instruction/rationale/success text contains no force, squeeze, push-through, whisper or larynx-manipulation directive.

Any failed rule returns `research_only`. A manually edited status string is not sufficient authority.

## Demonstration policy

The first alpha cue is a simple self-produced easy hum, small upward glide and opening into a word. It is text-described and objectively observed on the learner's own attempt, so a prerecorded demonstration is not required. This removes a second artificial staffing dependency without substituting TTS for human acoustic truth.

If a later cue depends on imitation, its demonstration requirement must be justified and validated as part of that cue's evidence contract.
