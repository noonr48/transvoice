# TransVoice — Tutor-Owned Continuous Practice

Date: 2026-07-28  
Status: design/research brief; no runtime implementation authorized  
Scope: current MTF-only product direction  
Related:

- `studio/research/mtf-voice-body-atlas-2026-07-27.md`
- `studio/specs/cue-vocabulary-spec-2026-07-27.md`
- `.deepthink/transvoice-evidence-and-progression-2026-07-28.md`

## 1. Product thesis

TransVoice is not a lesson planner, a chat interface, a game, a dashboard, or a
homework companion. It is a live spoken practice session in which the learner
presses Start, follows one small instruction at a time, speaks, hears the next
useful adjustment, and continues until they press End.

The tutor owns the cognitive work:

- remembers the learner's selected voice goal;
- chooses the current focus;
- demonstrates the exact target;
- gives one concrete action or imitation instruction;
- listens to the attempt;
- decides whether to hold, adjust, simplify, rebuild, transfer, or revisit;
- keeps exercises moving back into sentences and connected speech;
- remembers which cue variants produced immediate change, retention, and
  transfer for this learner.

The learner's job is intentionally small: listen, imitate, speak, and stop the
session when they choose.

## 2. Locked experience laws

- Voice-only lesson. No composer, chat, typed fallback, transcript panel, or
  message history.
- Preset plus Start/End only. The learner does not build a lesson.
- Start enters practice immediately. No compulsory warm-up, intake ritual, or
  theory preamble.
- No equipment. The phone microphone, the learner's voice, and easily found
  gross body contact are the available instruments.
- No homework and no "go practise this." All assigned practice occurs while the
  tutor remains present and guiding it.
- No games, streaks, scores, rewards, or character systems.
- The learner alone decides when the session ends. The tutor may interrupt an
  unsafe vocal action, but it does not suggest leaving and returning later.
- User-facing instructions use a concrete action, imitation, or valid physical
  check. Internal terms such as resonance, formants, vocal weight, and metric
  names stay internal.
- The selected preset is the exact tutor demonstration voice.
- Raw audio and full transcripts are not learner-memory artifacts.

## 3. Important refinements

### 3.1 Do not promise one objectively "correct placement"

There is no universal anatomical placement that defines the right voice.
Several physical strategies can produce similar acoustics. The tutor should
seek a goal-compatible, comfortable, repeatable coordination for this learner,
not claim to have located the one correct tongue or larynx position.

Metrics can support a direction such as "that vowel moved toward the target."
They cannot prove "your tongue was exactly here." An instruction is an
intervention chosen from evidence, not a measured anatomical diagnosis.

### 3.2 Concrete does not always mean internally anatomical

The preferred cue order is:

1. **Exact imitation:** "Copy this at half volume."
2. **Externally audible action:** "Let the final word rise, then settle."
3. **Feelable physical action/check:** "Keep the tongue sides touching the
   inside of the upper back teeth through the sentence."
4. **A learner-specific analogy:** only when memory shows that analogy has
   previously worked.

Never ask the learner to feel an intrinsic laryngeal muscle or chase a vague
vibration. Use anatomy only when the body part and action are safely findable.

### 3.3 Tutor-owned does not mean tutor-interrupted

During acquisition, feedback can be immediate and frequent. Once an adjustment
begins to work, the tutor should deliberately reduce its talking, lengthen the
speech sample, and vary the sentence. Otherwise the learner may become good at
performing one token after one correction without retaining or transferring it.

The target ratio changes through a block:

- **Acquire:** one short cue, one short attempt, immediate feedback.
- **Stabilise:** two or three attempts with less wording.
- **Transfer:** phrase and sentence attempts before feedback.
- **Extend:** several connected sentences or a short spoken response, followed
  by one summary correction.

### 3.4 Sounds are tools, never destinations

A hum, lip trill, slide, or sustained vowel may be used to acquire one
coordination or reset strain. It must retain a return pointer to the sentence
that exposed the problem.

Initial anti-loop laws:

- no more than two consecutive nonlexical attempts;
- after one usable anchor, the next task contains a word;
- a sentence is due by learner turn four unless safety or capture failure
  intervenes;
- no identical cue and token more than twice;
- after two misses, change the cue family or bridge rather than requesting the
  same sound again;
- capture failure never counts as learner failure.

## 4. The continuous practice loop

The deterministic engine owns this loop. The language model phrases the
engine-selected observation, instruction, and next target.

```text
START / RESUME
      ↓
MODEL — tutor says the exact target
      ↓
ATTEMPT — learner imitates or speaks
      ↓
EVIDENCE — prompt context + DSP + optional ASR + safety state
      ↓
DECISION
  ├─ acquired → stabilise
  ├─ partial → one micro-adjustment
  ├─ wrong direction → different cue family
  ├─ repeated miss → reduce unit, retaining sentence return pointer
  ├─ capture unresolved → repair/re-arm without vocal criticism
  └─ unsafe/strained → stop that action and choose an easier in-session reset
      ↓
REASSEMBLE — word → phrase → original sentence
      ↓
TRANSFER — new sentence / connected response
      ↓
EXTEND OR REVISIT — continue while learner has not pressed End
```

The loop should feel like:

> "The first half stayed steady; the last word slipped. Keep the tongue-side
> contact through that last word. Listen: 'It should be an easy morning.' Your
> turn."

It should not feel like:

> "Your resonance score is below target. Would you like to work on pitch,
> resonance, or prosody?"

## 5. Proposed engine state

The existing lesson notion of current point, attempts, and completion is too
coarse for this interaction. A block needs:

```text
PracticeBlock {
  goalId
  focusAxis                 // internal only
  phase                     // acquire | stabilise | transfer | extend
  expectedTakeKind          // vowel | word | phrase | sentence | connected
  targetId                  // content-safe identifier
  returnTargetId            // permanent sentence return pointer
  cueFamilyId
  cueVariantId
  attemptCount
  consecutiveNonlexical
  sameCueCount
  evidenceConfidence
  lastOutcome
  requiredNextPhase
}
```

The turn resolver treats ASR and DSP as peer evidence:

```text
TurnEvidence {
  expectedText
  expectedTakeKind
  semantic: final | no_words | failed | timeout | disabled
  acoustic: usable | voiced_unscorable | silence | failed | timeout
  resolution:
    semantic_measured | semantic_only | measured_only |
    silent | unresolved | conflict
}
```

ASR may verify words. DSP may support acoustic feedback. The known prompt says
what was requested. Any usable subset may continue the lesson without
fabricating claims from missing evidence.

## 6. Memory must learn causal usefulness, not just likes

Current generic `whatWorked`, `avoid`, struggles, and coach preferences are a
useful foundation, but they cannot answer "did this cue produce change here,
and did the change survive later?"

Store structured, content-minimised cue evidence:

```text
CueEffect {
  goalId
  focusAxis
  direction
  cueFamilyId
  cueVariantId
  speechContext             // vowel | word | phrase | sentence | connected
  immediateResult           // acquisition
  reducedFeedbackResult     // retention
  newContextResult          // transfer
  comfortResult
  captureConfidence
  successCount
  missCount
  lastUsedAt
}
```

Keep these concepts separate:

- **Preference:** the learner likes the wording.
- **Acquisition:** the next attempt changed in the intended direction.
- **Retention:** it still worked after feedback was reduced or after resuming.
- **Transfer:** it worked in a different sentence or connected response.

A liked cue may not work. A cue that changes one sustained vowel may fail in a
sentence. The tutor should favor cues with transfer evidence, not merely cues
that once earned a positive reaction.

Initial deterministic memory policy:

- two ineffective uses exhaust a cue variant for the current block;
- repeated failure in two sessions retires it until context or goal changes;
- a cue is promoted only after comfortable sentence transfer;
- a formerly useful cue may be retried after decay, but not in the same failed
  loop;
- safety and capture outcomes never update vocal-skill failure counts.

Do not begin with online reinforcement learning. First make the policy
auditable, deterministic, and replayable from privacy-safe event records.

## 7. Current gaps

| Gap | Why it matters | Evidence needed |
|---|---|---|
| No tutor-owned transition policy | The model can choose another hum forever | A complete transition table with bounded repair branches |
| No mandatory sentence return | Isolated success can masquerade as lesson progress | Seeded-session tests proving return by turn four |
| Cue selection is not phase-aware | The same correction can repeat without transfer | Cue router keyed by failure type, take kind, and phase |
| Memory does not distinguish acquisition, retention, and transfer | "What worked" may only have worked once | Structured cue-effect records and replay tests |
| Feedback is not faded | Constant correction can produce tutor dependence | Acquisition versus delayed/summary feedback experiment |
| Demonstration contract is unspecified | The learner must hear an exact, imitable target | Timing, loudness, phrase length, preset-voice fidelity tests |
| Sentence-phone metrics are not calibrated enough for every cue | A proxy may choose the wrong physical intervention | Phone-versus-reference measurement study by take kind |
| ASR still controls admission and no-word routing | Valid vowel/hum takes may be discarded or looped | Fail-open evidence contract and ASR-offline tests |
| Safety can add too much questioning | Repeated effort scales violate low-friction practice | Sparse spoken comfort check plus conservative acoustic rules |
| No whole-session quality measures | A locally good reply can still produce a bad lesson | Practice-time, interruption, loop, transfer, and abandonment telemetry |
| Current evidence atlas is MTF-only | It must not be generalized to other target directions | Keep scope locked or conduct a separate scoped research program |

## 8. Research that is still worth doing

Another broad anatomy or cue-vocabulary sweep is not the next step. The body
atlas, cue spec, and failure-point corpus already cover that territory. Research
should now target the uncertain product behavior.

### Track A — Coaching policy synthesis

Turn the existing failure taxonomy into roughly 10–15 repair families. For each
family define:

- observable evidence;
- one first-line cue;
- alternate cue family;
- reduction bridge;
- sentence return;
- transfer test;
- safety/capture exceptions;
- maximum repetitions.

Deliverable: one deterministic transition table that can generate adversarial
six- to twelve-turn session traces.

Gate: every safe path reaches connected speech; every unsafe path stops the
unsafe action; no path can remain indefinitely on a sound.

### Track B — Cue and feedback micro-study

For a small set of representative targets, compare:

- demonstration/imitation first;
- concrete physical action first;
- an already-known learner-specific analogy;
- immediate feedback versus feedback after a short cluster of attempts.

Measure:

- change on the next attempt;
- survival in the original sentence;
- survival in a new sentence;
- survival after feedback is reduced or at the next session;
- comfort and perceived cognitive load.

This is product-specific research. Existing motor-learning literature gives
direction, but not the winning feedback schedule for this tutor, population,
and phone task.

### Track C — Phone measurement validity

Record prompted vowels, words, phrases, and sentences on representative phones
and environments. Compare the engine's usable measures with a trusted offline
reference and expert auditory review.

For each metric decide:

- valid take kinds;
- minimum voiced duration;
- confidence threshold;
- confounds such as room, microphone distance, loudness, consonants, and vowel
  identity;
- which cue families it may select;
- wording claims it may never support.

Gate: no metric drives a physical cue outside its validated take kinds and
confidence range.

### Track D — Guided-session pilot

Run short, live, phone-based sessions with the full interaction shape. Debrief
after End rather than making the learner explain their thinking during every
attempt.

Measure:

- Start-to-first-spoken-attempt latency;
- percentage of session time the learner is actually speaking;
- coach talk and interruption ratio;
- prompts requiring a learner decision;
- nonlexical streak length;
- turn when the first full sentence occurs;
- cue repetitions after failure;
- transfer into a new sentence;
- continuity with ASR disabled;
- session abandonment and safety incidents.

Suggested first pilot: five to ten people or repeated sessions, used to expose
interaction defects rather than claim clinical efficacy.

### Track E — Specialist safety audit

Have a speech-language pathologist with gender-affirming voice expertise review
the cue families, contraindications, metric-to-cue claims, and transition table.
This is especially important because the product deliberately minimizes the
learner's need to reason about technique.

## 9. Recommended sequence

1. Freeze this product contract and the learner-facing language law.
2. Complete Track A on paper and in executable session fixtures.
3. Run Track C for the few metrics used by the first vertical slice.
4. Build one narrow tutor-owned slice:
   baseline sentence → one acquisition cue → short bridge → same sentence →
   new sentence, with ASR disabled.
5. Run Tracks B and D against that slice.
6. Adjust the policy and memory model from observed failures.
7. Expand one axis and failure family at a time.

The first slice should not attempt a complete curriculum. Its job is to prove
that the tutor can conduct a continuous session, recover from a failed cue,
return to sentences, and preserve useful causal memory without asking the
learner to manage the lesson.

## 10. Initial acceptance contract

- Start produces a model or concrete first action without a theory preamble.
- The learner is never asked to select a drill, interpret a metric, type, or
  leave and practise elsewhere.
- At most one actionable adjustment is spoken per attempt.
- No safe session exceeds two consecutive nonlexical learner turns.
- A full sentence is requested by learner turn four in at least 95% of seeded
  safe traces.
- A repeated miss changes the cue or bridge; it never produces the identical
  instruction a third time.
- Capture failure is named as capture failure and never blamed on the voice.
- ASR disabled does not stop a prompted measured practice block.
- Every acoustic claim is supported by usable acoustic evidence.
- Every lexical claim is supported by semantic evidence.
- The tutor reduces feedback after acquisition and tests transfer.
- The tutor does not suggest ending; practice continues until the learner
  presses End unless the current vocal action is unsafe.
- Memory can show why a cue was selected and whether it helped acquisition,
  retention, or transfer.

## 11. Research basis and limitations

- ASHA guidance treats gender-affirming voice as multidimensional,
  client-defined, comfortable, safe, and dependent on connected-speech
  carryover rather than a single metric:
  https://www.asha.org/practice-portal/professional-issues/gender-affirming-voice-and-communication/
- A 2023 systematic review found improvements across interventions but also
  heterogeneous measures, small samples, and meaningful differences between
  vowels, reading, and spontaneous speech:
  https://pubmed.ncbi.nlm.nih.gov/37481572/
- A long-term 14-week crossover study found some durable acoustic effects while
  also showing that vowels and connected speech can behave differently:
  https://pubmed.ncbi.nlm.nih.gov/38704279/
- A recent motor-learning review supports phase-dependent feedback and warns
  that the best schedule depends on the task, learner, and context:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC13152083/
- A 2026 adherence scoping review reports substantial dropout and highlights
  relevance, rapport, goal clarity, and access, but it does not directly prove
  that a no-homework product is clinically superior:
  https://pubmed.ncbi.nlm.nih.gov/42420112/

Therefore the broad direction is evidence-aligned, while the defining product
claims—near-zero learner planning, continuous tutor presence, no homework, and
phone-only cue adaptation—still require direct product testing. They should be
treated as hypotheses to validate, not as conclusions already established by
clinical literature.
