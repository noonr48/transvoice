# Cue Qualification — Non-Clinical Pitch Alpha

**Status:** active engineering contract for the pitch shadow/alpha track  
**Clinical claim:** none

TransVoice cannot make a qualified specialist appear on demand, and it must not fabricate one. A mandatory named-specialist signature therefore makes external staffing a product dependency rather than a safety mechanism.

For the narrow pitch alpha, the release gate is an auditable **non-clinical cue qualification**. It asks whether a cue is bounded, scope-limited, explicitly guarded and testable. It does not assert medical or clinical approval. External specialist review remains useful additional evidence when available, but it is not required to continue engineering or to run the non-clinical pitch-alpha protocol.

`backend/coaching/cue-alpha-qualification.js` is the executable gate. Version 1 intentionally allows only `pitch.register.small-glide-up.v1` and requires pitch-register scope, the upward pitch-foundation direction, explicit pain/increasing-strain/never-force guards, protected effort/pressedness/loudness metrics, bounded small-movement and comfort/ease wording, and absence of force/squeeze/push-through/whisper/larynx-manipulation instructions.

Failure of any rule yields `research_only`. Passing yields `alpha_qualified_nonclinical`. A status string by itself is not authority; qualification is recomputed from cue content and metadata.

A prerecorded demonstration is not required for this first pitch cue. The learner performs the described hum-to-word glide and their own attempt is the acoustic evidence. TTS is never acoustic truth. If a future cue depends on imitation that cannot be described and verified without an example, that cue needs a separate demonstration-evidence contract.

We still do not manufacture human evidence. Usability results, real-device pilot outcomes, expert-corrected acoustic ground truth and any future specialist opinion must come from actual people if we claim those things happened. That is different from making specialist availability a prerequisite for engineering progress.
