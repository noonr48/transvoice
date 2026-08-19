'use strict';

/**
 * LessonPlanner — lightweight JS lesson engine replacing DeepTutor.
 *
 * Calls the GGUF model once at session start to produce structured knowledge points.
 * Uses schema-constrained output + deterministic fallback.
 * Manages lesson state: active point, progress, transitions.
 */

const { buildTargetFit, resolveMetricContract } = require('../coaching/signal-builder');
const { resolveVoiceMeasurementUsability } = require('../voice-measurement-validity');

const LESSON_SCHEMA = {
  type: 'object',
  required: ['lessonTitle', 'knowledgePoints'],
  properties: {
    lessonTitle: { type: 'string', minLength: 3, maxLength: 80 },
    sessionFocus: {
      type: 'string',
      enum: ['resonance', 'voice_weight', 'intonation', 'easy_onset', 'phrase_contour', 'safety_reset', 'mixed'],
    },
    knowledgePoints: {
      type: 'array',
      // B-SESS: relaxed 3 -> 1 so quiet/silent session shapes may plan a smaller
      // set (the full-tier fallback still pads to 3+).
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['id', 'title', 'learnerExplanation', 'cue', 'practiceAction', 'successCriteria'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string', maxLength: 60 },
          learnerExplanation: { type: 'string', maxLength: 220 },
          listenFor: { type: 'string', maxLength: 120 },
          cue: { type: 'string', maxLength: 100 },
          practiceAction: { type: 'string', maxLength: 120 },
          successCriteria: { type: 'string', maxLength: 120 },
          safetyNote: { type: 'string', maxLength: 120 },
          targetConcepts: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        },
      },
    },
  },
};

// B-SESS session-shape vocab (mirrors the runtime's sessionScope). The prompt
// speaks only in MODE/material constraints — never minutes, timers, or any
// time language (the coach is time-blind by owner law).
const SESSION_SCOPE_TIERS = Object.freeze(['full', 'quiet', 'silent']);

function normalizePlannerScope(sessionScope) {
  const source = sessionScope && typeof sessionScope === 'object' ? sessionScope : {};
  return {
    tier: SESSION_SCOPE_TIERS.includes(source.tier) ? source.tier : 'full',
    eyesFree: source.eyesFree === true,
  };
}

function asUnitFraction(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}

function formatMetricPercent(value) {
  const fraction = asUnitFraction(value);
  return fraction == null ? null : `${Math.round(fraction * 100)}%`;
}

function formatBand(floor, ceiling, unit = '%') {
  const lower = Number(floor);
  const upper = Number(ceiling);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (unit === 'Hz') return `${Math.round(lower)}–${Math.round(upper)} Hz`;
  return `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`;
}

/**
 * Build the planning prompt from voice records and learner context.
 * `sessionScope` ({tier, eyesFree}) appends MODE constraint lines only.
 */
function buildPlanningPrompt(voiceState, learnerContext, sessionScope = null) {
  const summary = voiceState?.lastSummary || {};
  const metrics = summary.metrics || {};
  const advanced = metrics.advanced || {};
  const targetProfile = voiceState?.targetVoiceProfile || {};
  const metricContract = resolveMetricContract(voiceState, summary);
  const measurementUsable = resolveVoiceMeasurementUsability(advanced).usableForScoring;
  const inputRuntime = voiceState?.voiceInputRuntime || {};
  const recentAttempts = learnerContext?.recentAttempts || [];

  const lines = ['Analyze these voice practice records and produce a lesson plan.', ''];

  // Voice goal
  lines.push('Voice goal:');
  lines.push(`- Target preset: ${voiceState?.targetPreset || 'cute-feminine'}`);
  lines.push(`- Target direction: ${metricContract.target.direction}`);
  if (metricContract.target.source) lines.push(`- Target source: ${metricContract.target.source}`);
  if (metricContract.target.targetProfileId) lines.push(`- Target profile: ${metricContract.target.targetProfileId}`);
  if (targetProfile.stylePrompt) lines.push(`- Style: ${targetProfile.stylePrompt}`);
  const pitchBand = formatBand(metricContract.target.pitchFloorHz, metricContract.target.pitchCeilingHz, 'Hz');
  const resonanceBand = formatBand(metricContract.target.resonanceFloor, metricContract.target.resonanceCeiling);
  const weightBand = formatBand(metricContract.target.weightFloor, metricContract.target.weightCeiling);
  if (pitchBand) lines.push(`- Pitch band: ${pitchBand}`);
  if (resonanceBand) lines.push(`- Resonance band: ${resonanceBand}`);
  if (weightBand) lines.push(`- Vocal-weight band: ${weightBand}`);
  lines.push('');

  // Latest analysis
  lines.push('Latest voice analysis:');
  if (!measurementUsable) {
    const reasons = metricContract.measurementRejectionReasons.length
      ? metricContract.measurementRejectionReasons.join(', ')
      : 'measurement unavailable';
    lines.push(`- No usable acoustic measurement (${reasons}). Do not infer a vocal correction from this take.`);
  } else {
    if (metricContract.values.meanPitchHz != null) {
      lines.push(`- Mean pitch: ${Math.round(metricContract.values.meanPitchHz)} Hz`);
    }
    const resonance = formatMetricPercent(metricContract.values.resonanceMean);
    const weight = formatMetricPercent(metricContract.values.weightMean);
    const targetHit = formatMetricPercent(metricContract.values.targetHitFraction);
    const similarity = formatMetricPercent(metrics.similarityScore ?? metrics.similarityPct);
    if (resonance) lines.push(`- Resonance: ${resonance}`);
    if (weight) lines.push(`- Voice weight: ${weight}`);
    if (targetHit) lines.push(`- Target hit: ${targetHit}`);
    if (similarity) lines.push(`- Similarity: ${similarity}`);
    if (advanced.pitchTrajectory) lines.push(`- Pitch trajectory: ${advanced.pitchTrajectory}`);
  }
  lines.push('');

  // Student progression
  if (learnerContext) {
    lines.push('Student progression:');
    if (learnerContext.masteryLevel) lines.push(`- Mastery: ${learnerContext.masteryLevel}`);
    if (learnerContext.struggles?.length) lines.push(`- Struggles: ${learnerContext.struggles.join(', ')}`);
    if (learnerContext.reviewQueue?.length) {
      lines.push(`- Review queue: ${learnerContext.reviewQueue.map((r) => `${r.conceptId} (${Math.round((r.urgency || 0) * 100)}%)`).join(', ')}`);
    }
    lines.push('');
  }

  // Recent coaching thread
  const coachThread = voiceState?.coachThread || [];
  if (coachThread.length > 0) {
    lines.push('Recent coaching conversation:');
    for (const msg of coachThread.slice(-4)) {
      lines.push(`- ${msg.role}: ${msg.content}`);
    }
    lines.push('');
  }

  lines.push('Produce 3-5 knowledge points as a JSON array. Each point should have: id, title, learnerExplanation, listenFor, cue, practiceAction, successCriteria, safetyNote, targetConcepts.');

  // B-SESS session-shape constraints — MODE lines only, appended at the end.
  const scope = normalizePlannerScope(sessionScope);
  if (scope.tier !== 'full' || scope.eyesFree) {
    lines.push('');
    if (scope.tier === 'quiet') {
      lines.push('MODE: quiet practice — no full-voice speech; plan only humming and soft-onset material.');
    }
    if (scope.tier === 'silent') {
      lines.push('MODE: silent session — the learner will not speak aloud; plan only listening, comparing, and planning material.');
    }
    if (scope.eyesFree) {
      lines.push('MODE: eyes-free — the learner cannot read the screen; every point must work spoken-first.');
    }
  }

  return lines.join('\n');
}

/**
 * Parse knowledge points from model response.
 * Returns null if parsing fails.
 */
function parseKnowledgePoints(response) {
  if (!response || typeof response !== 'string') return null;

  // Try to extract JSON from the response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    // Validate each point has required fields
    const valid = parsed.every((point) =>
      point && typeof point === 'object'
      && typeof point.id === 'string' && point.id.trim()
      && typeof point.title === 'string' && point.title.trim()
      && typeof point.cue === 'string' && point.cue.trim()
    );

    return valid ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic fallback lesson planner.
 * Used when the model is unavailable or returns malformed output.
 * `sessionScope` branches the material per tier: quiet -> hum/soft-onset only
 * (2 points), silent -> tutor-led listening + silent mouthing + one concept (3
 * points). The relaxed schema (minItems 1) means these smaller sets are valid —
 * only the full tier pads to 3+.
 */
function buildFallbackLesson(voiceState, learnerContext, sessionScope = null) {
  const scope = normalizePlannerScope(sessionScope);

  if (scope.tier === 'quiet') {
    return {
      lessonTitle: 'Quiet Practice',
      sessionFocus: 'resonance',
      knowledgePoints: [
        {
          id: 'kp-quiet-1',
          title: 'Gentle Hum, Forward Home',
          learnerExplanation: 'With the lips closed, a hum lets the tongue find its high forward position while the throat does almost nothing. Keep the sides of the tongue touching your upper back teeth the whole time.',
          listenFor: 'A steady hum with no scratch in it.',
          cue: 'Lips closed, tongue sides against your upper back teeth — hum small and steady.',
          practiceAction: 'Hum a gentle "mm" and hold the tongue-side contact until it fades on its own.',
          successCriteria: 'The tongue-side contact holds for the whole hum, with no scratch and no press.',
          safetyNote: 'If anything tightens, let the hum go quieter still.',
          targetConcepts: ['voice_resonance_brightness'],
        },
        {
          id: 'kp-quiet-2',
          title: 'Soft Onset, Barely There',
          learnerExplanation: 'A sound can begin without a click. Let the tone fade in at the very front of the word instead of switching on.',
          listenFor: 'A beginning with no click or push — the sound simply arrives.',
          cue: 'Start on a tiny, gentle "uh" — no click at the front.',
          practiceAction: 'Start a quiet "mm-hmm" with no click at the front, and hold it level until it fades on its own.',
          successCriteria: 'Onsets feel smooth and unforced.',
          safetyNote: 'Stay at a loudness that feels like resting.',
          targetConcepts: ['voice_easy_phonation'],
        },
      ],
    };
  }

  if (scope.tier === 'silent') {
    return {
      lessonTitle: 'Listening Session',
      sessionFocus: 'mixed',
      knowledgePoints: [
        {
          // 2026-07-26 equipment law: was "Play two of your recent takes" — that
          // asks the learner to operate playback the Coach surface does not have
          // (the surface is the preset selector and Start/End, nothing else), and
          // it is not doable with voice and body alone. The tutor plays the two
          // versions instead, which is the register the silent-tier fallback in
          // coaching/index.js already uses: "I'll play; you judge by ear."
          id: 'kp-silent-1',
          title: 'Which One Sits Closer',
          learnerExplanation: 'Listening is practice too. I will say the same line two ways, and you notice which one sits closer to the voice you are heading toward.',
          listenFor: 'Where the tongue sits, how far the jaw opens, and where the ending lands.',
          cue: 'Name one thing the closer version did differently.',
          practiceAction: 'Listen to both versions now and choose the one that sits closer.',
          successCriteria: 'You can name one thing that made the closer version closer.',
          safetyNote: 'Nothing to perform here — this is all listening.',
          targetConcepts: ['voice_resonance_brightness'],
        },
        // 2026-07-26 homework law: this point was "Pick Tomorrow's Sentence" —
        // choose a sentence and "decide where and when you will say it". That is
        // practice scheduled for later, somewhere else, which the product law
        // forbids outright. The silent tier still needs a soundless point, so the
        // replacement does the same articulatory work the voice would do, now,
        // with nothing but the mouth: silent mouthing needs no breath, no volume,
        // and no object.
        {
          id: 'kp-silent-2',
          title: 'Shape It Silently',
          learnerExplanation: 'The tongue, lips, and jaw can rehearse a line with no sound at all. Mouthing it at full size trains the same mouth shapes your voice will use.',
          listenFor: 'Nothing to hear — feel where the tongue sits and how far the jaw opens.',
          cue: 'Mouth the line now — tongue and lips full size, no sound.',
          practiceAction: 'Mouth the line through twice right now, letting the jaw open fully on every vowel.',
          successCriteria: 'The tongue, lips, and jaw move through the whole line at full size with no voice.',
          safetyNote: 'Keep the jaw loose; there is nothing to push here.',
          targetConcepts: [],
        },
        // 2026-07-26 homework law: this point listened to "voices around you",
        // which is practice that happens away from the tutor. Same concept, same
        // silent tier, but the material is the tutor's own voice in this session.
        {
          id: 'kp-silent-3',
          title: 'One Idea: Where the Sound Lives',
          learnerExplanation: 'Resonance is the shape of the tube from your voice box to your lips, not how loud you are. A shorter tube — tongue body forward and up, lip corners drawn back — is what changes it. Nothing is placed anywhere; the tube just gets shorter.',
          listenFor: 'In the line I say next: are the lip corners drawn back, or pushed forward?',
          cue: 'Follow my mouth as I speak — corners back and tongue high, or corners forward and tongue low.',
          practiceAction: 'Listen to the line I say now and name which mouth shape made it.',
          successCriteria: 'You can name the lip and tongue shape you heard in the line.',
          safetyNote: 'This one is all listening — no sound needed from you.',
          targetConcepts: ['voice_resonance_brightness'],
        },
      ],
    };
  }

  const summary = voiceState?.lastSummary || {};
  const metrics = summary.metrics || {};
  const struggles = learnerContext?.struggles || [];
  const reviewQueue = learnerContext?.reviewQueue || [];
  const metricContract = resolveMetricContract(voiceState, summary);

  if (!resolveVoiceMeasurementUsability(metrics.advanced || {}).usableForScoring) {
    return {
      lessonTitle: 'Fresh Listening Check',
      sessionFocus: 'mixed',
      knowledgePoints: [
        {
          id: 'kp-capture-1',
          title: 'Get a Fresh Take',
          learnerExplanation: 'The last capture did not contain enough voiced sound to measure. That is a microphone or capture result, not a verdict about your voice.',
          listenFor: 'A clean, comfortably audible phrase with no clipping.',
          cue: 'Fresh capture first; coaching second.',
          practiceAction: 'Check the microphone, then record one easy phrase at a comfortable volume.',
          successCriteria: 'The app confirms a usable voiced measurement.',
          safetyNote: 'Stay comfortable; there is no need to push volume.',
          targetConcepts: [],
        },
        {
          id: 'kp-capture-2',
          title: 'Easy Onset',
          learnerExplanation: 'Let the first sound arrive gently while the capture settles. A clean start is easier to measure and easier on the voice.',
          listenFor: 'A smooth beginning without a click or push.',
          cue: 'Start on a tiny, gentle "uh".',
          practiceAction: 'Begin the first word on a tiny, gentle "uh" — no air before the sound — then finish the short phrase.',
          successCriteria: 'The onset feels comfortable and clear.',
          safetyNote: 'Keep it small and easy; never push through tightness.',
          targetConcepts: ['voice_easy_phonation'],
        },
        {
          id: 'kp-capture-3',
          title: 'Hold the Phone Still',
          learnerExplanation: 'A steady microphone distance gives the analyzer a cleaner comparison and makes later changes easier to trust.',
          listenFor: 'Even loudness from start to finish.',
          cue: 'Same distance, easy voice.',
          practiceAction: 'Keep the microphone position steady for the whole phrase.',
          successCriteria: 'The take stays even and the measurement becomes available.',
          safetyNote: 'Do not compensate for distance by pushing the voice.',
          targetConcepts: [],
        },
      ],
    };
  }

  const targetFit = buildTargetFit(
    voiceState,
    summary,
    metrics.advanced || {},
    metrics.advanced?.quality || {},
    voiceState?.targetVoiceProfile || {},
  );

  const points = [];
  let id = 1;

  // Address only measured deviations from the exact target contract. These
  // coordinate-side cues work for built-in, handmade, and reference targets.
  if (targetFit.weight.status === 'too_heavy') {
    const measured = formatMetricPercent(metricContract.values.weightMean) || 'the measured value';
    const targetBand = formatBand(metricContract.target.weightFloor, metricContract.target.weightCeiling) || 'the target band';
    points.push({
      id: `kp-${id++}`,
      title: 'Ease Vocal Weight',
      learnerExplanation: `Vocal weight measured ${measured}, above ${targetBand}. Put a palm flat on your breastbone: the buzz you feel there is the weight, and it should get weaker without getting quieter.`,
      listenFor: 'A weaker buzz under the palm at the same loudness.',
      cue: 'Palm on the breastbone, loose jaw, soft start — less press into each word.',
      practiceAction: 'Say a short phrase keeping the jaw loose and starting each word softly instead of pressing into it.',
      successCriteria: 'The buzz under your palm weakens while the loudness stays the same.',
      safetyNote: 'Keep the sound below any strain; never push through discomfort.',
      targetConcepts: ['voice_light_vocal_weight'],
    });
  } else if (targetFit.weight.status === 'too_light') {
    const measured = formatMetricPercent(metricContract.values.weightMean) || 'the measured value';
    const targetBand = formatBand(metricContract.target.weightFloor, metricContract.target.weightCeiling) || 'the target band';
    points.push({
      id: `kp-${id++}`,
      title: 'Steadier Vocal Weight',
      learnerExplanation: `Vocal weight measured ${measured}, below ${targetBand}. Put a palm flat on your breastbone: the buzz should arrive the moment voice starts and stop the moment it ends, a little stronger than it is now.`,
      listenFor: 'A buzz under the palm that starts and stops cleanly with the voice.',
      cue: 'Open the jaw a touch more — firmer contact, still easy.',
      practiceAction: 'Say a short phrase with the jaw open a touch more, letting each word start on firmer contact.',
      successCriteria: 'The buzz under your palm starts and stops cleanly with the voice, with no strain.',
      safetyNote: 'A stronger buzz never means louder or pushed — if it turns hard and rattly, ease off.',
      targetConcepts: ['voice_light_vocal_weight'],
    });
  }

  if (targetFit.resonance.status === 'too_dark') {
    const measured = formatMetricPercent(metricContract.values.resonanceMean) || 'the measured value';
    const targetBand = formatBand(metricContract.target.resonanceFloor, metricContract.target.resonanceCeiling) || 'the target band';
    points.push({
      id: `kp-${id++}`,
      title: 'Resonance Toward the Target',
      learnerExplanation: `Resonance measured ${measured}, below ${targetBand}. Move the body of your tongue forward and up, and draw your lip corners back — that shortens the tube and is what the number reads.`,
      // 2026-07-30: was "The fastest, coolest air on the ridge just behind your
      // top teeth." An eyes-free learner cannot locate the coolest point of her
      // own airstream on one attempt. Two vowels she already says, compared with
      // her own ears, give her the same distinction for free.
      listenFor: 'Say "eee", then "ah" — the "eee" is the one you are keeping.',
      cue: 'Press the sides of your tongue against your upper back teeth and draw the lip corners back.',
      practiceAction: 'Hold that tongue-side contact through a short phrase and notice where it breaks.',
      successCriteria: 'The tongue-side contact holds through the phrase without throat tightness.',
      safetyNote: 'Move the body of the tongue, not the root — do not push from the back of the throat.',
      targetConcepts: ['voice_resonance_brightness'],
    });
  } else if (targetFit.resonance.status === 'too_bright') {
    const measured = formatMetricPercent(metricContract.values.resonanceMean) || 'the measured value';
    const targetBand = formatBand(metricContract.target.resonanceFloor, metricContract.target.resonanceCeiling) || 'the target band';
    points.push({
      id: `kp-${id++}`,
      title: 'Settle the Tongue Back',
      learnerExplanation: `Resonance measured ${measured}, above ${targetBand}. Let the body of your tongue settle back and down, and stop drawing the lip corners so far back — that lengthens the tube toward your target.`,
      listenFor: 'Say "eee", then "ah" — this time the "ah" is the one you are heading toward.',
      cue: 'Let the tongue settle back and lower, and let the lip corners come off their spread.',
      practiceAction: 'Say a short phrase with the tongue settled lower and more space at the back of the mouth.',
      successCriteria: 'The tongue sits lower through the whole phrase and the sound stays clear, not muffled.',
      safetyNote: 'Do not force the larynx down or add throat tension.',
      targetConcepts: ['voice_resonance_brightness'],
    });
  }

  // Point 3: Struggle-based
  if (struggles.includes('phrase_ending_instability') || struggles.includes('pitch_falling_at_end')) {
    points.push({
      id: `kp-${id++}`,
      title: 'Stable Phrase Endings',
      learnerExplanation: 'Your pitch tends to drop at the end of phrases. Keeping the ending lifted makes the voice sound more confident and natural.',
      listenFor: 'The last word staying lifted, not dropping.',
      cue: 'Let the pitch of the last two words step up a little.',
      practiceAction: 'Say a phrase, keeping the lips and jaw moving through the last two words so the ending stays up.',
      successCriteria: 'Phrase ending stays lifted without pushing.',
      safetyNote: 'Don\'t push pitch up — just keep it from dropping.',
      targetConcepts: ['voice_phrase_endings'],
    });
  }

  // A no-issue or one-issue lesson still names the learner's actual target,
  // without assuming every target should be bright or light.
  if (points.length < 2) {
    const directionLabel = metricContract.target.direction === 'neutral'
      ? 'Balanced Target Placement'
      : 'Hold the Whole Target';
    points.push({
      id: `kp-${id++}`,
      title: directionLabel,
      learnerExplanation: 'Your chosen target is a band for pitch, resonance, and vocal weight at once. Hold the tongue, lip and jaw setting that keeps all three inside their bands instead of chasing one of them.',
      listenFor: 'Tongue-side contact, lip corners, and the buzz under your palm all holding at once.',
      cue: metricContract.target.direction === 'neutral'
        ? 'Loose jaw, easy lips — balanced and even.'
        : 'Easy lips, tongue high and forward — inside your target.',
      practiceAction: 'Repeat one short phrase while keeping the whole target combination steady.',
      successCriteria: 'Tongue contact, lip corners and the buzz under your palm all hold for the whole phrase.',
      safetyNote: 'A target is a guide, never a reason to force the voice.',
      targetConcepts: ['voice_target_zone_accuracy'],
    });
  }

  // Always include at least 3 points
  if (points.length < 3) {
    points.push({
      id: `kp-${id++}`,
      title: 'Easy Onset',
      learnerExplanation: 'Start each phrase gently — no hard attacks or pushing from the throat.',
      listenFor: 'A soft, easy beginning to each phrase.',
      cue: 'Start on a tiny, gentle "uh" — then keep that clean contact.',
      practiceAction: 'Start the first word on a tiny, gentle "uh" — the small catch before a cough — then keep that same contact.',
      successCriteria: 'No hard onset or throat pushing.',
      safetyNote: 'Keep the onset smaller until the throat stays easy.',
      targetConcepts: ['voice_easy_phonation'],
    });
  }

  if (points.length < 3) {
    const pitchBand = formatBand(metricContract.target.pitchFloorHz, metricContract.target.pitchCeilingHz, 'Hz');
    points.push({
      id: `kp-${id++}`,
      title: 'Pitch Inside the Band',
      learnerExplanation: pitchBand
        ? `Your selected pitch band is ${pitchBand}. Aim for an easy center rather than forcing either edge.`
        : 'Aim for an easy, repeatable pitch center that belongs with your selected target.',
      listenFor: 'A steady center that does not strain toward the edges.',
      cue: 'Loose jaw, easy lips — one setting across the phrase.',
      practiceAction: 'Say one short phrase at the easiest pitch you can hold without straining.',
      successCriteria: 'The pitch stays in one easy place instead of straining up or down.',
      safetyNote: 'Do not chase a number that feels uncomfortable.',
      targetConcepts: ['voice_pitch_center'],
    });
  }

  return {
    lessonTitle: 'Voice Practice Focus',
    sessionFocus: 'mixed',
    knowledgePoints: points.slice(0, 5),
  };
}

/**
 * Lesson state machine.
 */
class LessonState {
  constructor() {
    this.status = 'idle'; // idle | planning | active | practice | review | complete
    this.lessonTitle = '';
    this.sessionFocus = 'mixed';
    this.knowledgePoints = [];
    this.currentIndex = 0;
    this.attempts = {}; // knowledgePointId -> attempt count
    this.completedPoints = [];
    this.startedAt = null;
    this.plannedAt = null;
  }

  /**
   * Initialize from a lesson plan (model output or fallback).
   */
  applyPlan(plan) {
    this.lessonTitle = plan.lessonTitle || 'Voice Practice';
    this.sessionFocus = plan.sessionFocus || 'mixed';
    this.knowledgePoints = (plan.knowledgePoints || []).map((kp) => ({
      ...kp,
      id: kp.id || `kp-${this.knowledgePoints.length + 1}`,
    }));
    this.currentIndex = 0;
    this.attempts = {};
    this.completedPoints = [];
    this.status = 'active';
    this.plannedAt = Date.now();
    this.startedAt = this.startedAt || Date.now();
  }

  /**
   * Get the current knowledge point.
   */
  getCurrentPoint() {
    if (this.status !== 'active' && this.status !== 'practice') return null;
    return this.knowledgePoints[this.currentIndex] || null;
  }

  /**
   * Record an attempt on the current knowledge point.
   */
  recordAttempt(success = false) {
    const point = this.getCurrentPoint();
    if (!point) return;

    const id = point.id;
    this.attempts[id] = (this.attempts[id] || 0) + 1;
    this.status = 'practice';

    if (success) {
      this.completedPoints.push(id);
    }
  }

  /**
   * Advance to the next knowledge point.
   * Returns true if there's a next point, false if lesson is complete.
   */
  advance() {
    if (this.currentIndex < this.knowledgePoints.length - 1) {
      this.currentIndex++;
      this.status = 'active';
      return true;
    }
    this.status = 'complete';
    return false;
  }

  /**
   * Get lesson progress as a fraction.
   */
  getProgress() {
    if (this.knowledgePoints.length === 0) return 0;
    return this.completedPoints.length / this.knowledgePoints.length;
  }

  /**
   * Get a summary for the CoachingSignal personalization.
   */
  toPersonalization() {
    const current = this.getCurrentPoint();
    return {
      currentLesson: current?.title || this.lessonTitle || '',
      lessonProgress: `${this.currentIndex + 1} of ${this.knowledgePoints.length}`,
      recentWin: this.completedPoints.length > 0
        ? `Completed ${this.completedPoints.length} lesson point(s).`
        : '',
    };
  }

  /**
   * Serialize for session persistence.
   */
  toJSON() {
    return {
      status: this.status,
      lessonTitle: this.lessonTitle,
      sessionFocus: this.sessionFocus,
      knowledgePoints: this.knowledgePoints,
      currentIndex: this.currentIndex,
      attempts: this.attempts,
      completedPoints: this.completedPoints,
      startedAt: this.startedAt,
      plannedAt: this.plannedAt,
    };
  }

  /**
   * Restore from serialized state.
   */
  static fromJSON(data) {
    const state = new LessonState();
    if (!data || typeof data !== 'object') return state;
    state.status = data.status || 'idle';
    state.lessonTitle = data.lessonTitle || '';
    state.sessionFocus = data.sessionFocus || 'mixed';
    state.knowledgePoints = Array.isArray(data.knowledgePoints) ? data.knowledgePoints : [];
    state.currentIndex = data.currentIndex || 0;
    state.attempts = data.attempts || {};
    state.completedPoints = data.completedPoints || [];
    state.startedAt = data.startedAt || null;
    state.plannedAt = data.plannedAt || null;
    return state;
  }
}

/**
 * Plan a lesson — call the model or use fallback.
 * `sessionScope` ({tier, eyesFree}) shapes both the prompt (MODE constraint
 * lines) and the deterministic fallback (per-tier material).
 */
async function planLesson(voiceState, learnerContext, callModel = null, sessionScope = null) {
  const prompt = buildPlanningPrompt(voiceState, learnerContext, sessionScope);

  let plan = null;

  if (callModel) {
    try {
      const response = await callModel(
        [
          { role: 'system', content: 'You are a voice coaching lesson planner. Return only valid JSON matching the requested schema. No markdown, no explanation.' },
          { role: 'user', content: prompt },
        ],
        // Thinking-model headroom: hidden reasoning precedes the JSON plan;
        // 400 total tokens starved the answer and silently fell back.
        { maxTokens: 1024, temperature: 0.5 },
      );
      plan = parseKnowledgePoints(response);
      if (plan) {
        plan = {
          lessonTitle: 'Voice Practice',
          sessionFocus: 'mixed',
          knowledgePoints: plan,
        };
      }
    } catch (err) {
      // Model failed, use fallback
    }
  }

  if (!plan) {
    plan = buildFallbackLesson(voiceState, learnerContext, sessionScope);
  }

  return plan;
}

module.exports = {
  LESSON_SCHEMA,
  LessonState,
  planLesson,
  buildPlanningPrompt,
  parseKnowledgePoints,
  buildFallbackLesson,
};
