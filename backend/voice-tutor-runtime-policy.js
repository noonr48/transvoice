'use strict';

// Ids and directions mirror the DSP's canonical target profiles
// (services/voice-trainer/src/services/audio_analysis.py TARGET_PROFILES).
const STYLE_TARGETS = {
  'cute-feminine': 'cute-feminine: small, bright, light, and comfortable without childish or stereotyped framing.',
  'everyday-feminine': 'everyday-feminine: warm, forward, conversational, and durable in normal speech.',
  'bright-playful': 'bright-playful: sparkly, animated, forward, and light without forcing pitch or throat height.',
  'australian-bright-feminine': 'australian-bright-feminine: bright, forward, light, and natural in Australian everyday conversation without caricature.',
  'soft-feminine': 'soft-feminine: light, natural, and comfortably feminine through pitch and lightness rather than brightness or forced forward resonance.',
  // 'androgynous' and 'gender-neutral' REMOVED 2026-07-30 — the app is
  // male-to-female only. Hand-copied from TARGET_PROFILES in
  // services/voice-trainer/src/services/audio_analysis.py, which is the source of
  // truth; nothing keeps this copy in sync, so it must move with it.
};

const PRESET_DIRECTIONS = {
  'cute-feminine': 'feminine',
  'everyday-feminine': 'feminine',
  'bright-playful': 'feminine',
  'australian-bright-feminine': 'feminine',
  'soft-feminine': 'feminine',
  // No preset resolves to 'neutral' any more (2026-07-30). Every direction-keyed
  // table's neutral arm is therefore unreachable and is removed with it.
};

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeVoiceTutorTargetPreset(value) {
  const normalized = normalizeText(value).toLowerCase();
  return STYLE_TARGETS[normalized] ? normalized : 'cute-feminine';
}

function normalizeVoiceTutorPracticeMode(value) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return [
    'active_drill',
    'conversation_practice',
    'reflection',
    'lesson_plan',
    'safety_reset',
  ].includes(normalized)
    ? normalized
    : 'active_drill';
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function capitalizeSentenceStart(text) {
  const normalized = normalizeText(text);
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : '';
}

function isConversationPracticeCoachingSentence(sentence) {
  const normalized = normalizeText(sentence);
  if (!normalized) {
    return false;
  }
  const hasVoiceTerm = /\b(?:voice|pitch|resonance|vowel|vowels|vowel sound|weight|onset|phonation|intonation|prosody|articulation|target voice|bright|brighter|brightness|forward|forward sound|bright forward|forward resonance)\b/i.test(normalized);
  const hasCoachingAction = /\b(?:try|repeat|redo|record|sample|drill|practice|say it again|say that again|let's hear|next line|next pass)\b/i.test(normalized);
  const hasAnalyzerTerm = /\b(?:analyzer|metric|capture|recording|mic|microphone|voice score|pitch score|resonance score|score confidence|voice sample|audio sample|clean sample|clean take|voice take|new take|take again|record another take)\b/i.test(normalized);
  return hasAnalyzerTerm || (hasVoiceTerm && hasCoachingAction);
}

function sanitizeVoiceTutorReplyForPracticeMode(reply, { practiceMode = 'active_drill' } = {}) {
  const normalizedReply = normalizeText(reply);
  if (!normalizedReply || normalizeVoiceTutorPracticeMode(practiceMode) !== 'conversation_practice') {
    return normalizedReply;
  }
  const sentences = splitSentences(normalizedReply);
  if (sentences.length === 0) {
    return normalizedReply;
  }
  const kept = sentences.filter((sentence) => !isConversationPracticeCoachingSentence(sentence));
  if (kept.length === sentences.length || kept.length === 0) {
    return normalizedReply;
  }
  return kept.join(' ');
}

function sanitizeVoiceTutorReplyForPitchStableDarkLarge(reply, scenario = {}) {
  let sanitized = normalizeText(reply);
  if (!sanitized) {
    return sanitized;
  }

  const scenarioPolicy = buildVoiceTutorScenarioPolicyLines(scenario).join('\n');
  const shouldApplyScenarioRule = /pitch is already acceptable|pitch-stable dark\/large/i.test(scenarioPolicy);
  if (!shouldApplyScenarioRule && !/\bkeep (?:your )?pitch comfortable\b/i.test(sanitized)) {
    return sanitized;
  }

  sanitized = sanitized
    .replace(/\bkeep (?:your )?pitch comfortable(?:\s+and)?\s*/gi, '')
    .replace(/\bkeep (?:the )?same pitch(?:\s+and)?\s*/gi, '')
    .replace(/\bwithout (?:raising|lifting|changing) (?:your )?pitch(?:\s+and)?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (shouldApplyScenarioRule && /\bpitch\b/i.test(sanitized)) {
    const withoutPitchSentences = splitSentences(sanitized)
      .filter((sentence) => !/\bpitch\b/i.test(sentence))
      .join(' ');
    if (withoutPitchSentences) {
      sanitized = withoutPitchSentences;
    }
  }

  if (
    shouldApplyScenarioRule
    && (
      /\bpitch\b/i.test(sanitized)
      || !/\b(?:resonance|forward|bright|brighter|vowel|vowels|smaller)\b/i.test(sanitized)
      || !/\b(?:lighter voice weight|voice weight|less press|less pressed|lighter|lighten)\b/i.test(sanitized)
    )
  ) {
    sanitized = 'Make the vowels smaller and brighter with lighter voice weight; keep it easy, not pressed.';
  }

  return capitalizeSentenceStart(sanitized);
}

function sanitizeVoiceTutorReplyForRuntimePolicy(reply, options = {}) {
  const pitchSanitized = sanitizeVoiceTutorReplyForPitchStableDarkLarge(reply, options);
  return sanitizeVoiceTutorReplyForPracticeMode(pitchSanitized, options);
}

function getVoiceTutorStyleTarget(targetPreset = 'cute-feminine') {
  return STYLE_TARGETS[normalizeVoiceTutorTargetPreset(targetPreset)];
}

function getVoiceTutorTargetDirection(targetPreset = 'cute-feminine') {
  return PRESET_DIRECTIONS[normalizeVoiceTutorTargetPreset(targetPreset)] || 'feminine';
}

function collectVoiceTutorScenarioPolicyText(value = {}) {
  const expected = value.expected && typeof value.expected === 'object' ? value.expected : {};
  return [
    normalizeText(value.prompt || value.user || value.question || value.message),
    normalizeText(value.stylePrompt || value.style_prompt),
    normalizeText(expected.prompt || expected.note),
    ...(Array.isArray(expected.requiredCueFamilies) ? expected.requiredCueFamilies : []),
    ...(Array.isArray(expected.disallowedCueFamilies) ? expected.disallowedCueFamilies : []),
  ].filter(Boolean).join('\n');
}

function isVoiceTutorConversationNoCorrectionExpected(value = {}) {
  const expected = value.expected && typeof value.expected === 'object' ? value.expected : value;
  return Boolean(
    expected.conversationNoCorrection
      || expected.noCorrection
      || expected.noVoiceCorrection
      || expected.conversationPracticeNoPromotion
      || expected.conversation_practice_no_promotion,
  );
}

function shouldEvaluateRawVoiceTutorReply(value = {}) {
  const expected = value.expected && typeof value.expected === 'object' ? value.expected : value;
  const practiceMode = normalizeVoiceTutorPracticeMode(value.practiceMode || value.practice_mode || expected.practiceMode);
  return Boolean(
    expected.scoreRawResponse
      || expected.scoreRawConversation
      || expected.rawEvaluation
      || (practiceMode === 'conversation_practice' && isVoiceTutorConversationNoCorrectionExpected({ expected })),
  );
}

function buildVoiceTutorScenarioPolicyLines(scenario = {}) {
  const expected = scenario.expected && typeof scenario.expected === 'object' ? scenario.expected : {};
  const text = collectVoiceTutorScenarioPolicyText(scenario).toLowerCase();
  const requiredCueFamilies = Array.isArray(expected.requiredCueFamilies) ? expected.requiredCueFamilies : [];
  const requiresResonanceAndWeight = requiredCueFamilies.includes('resonance') && requiredCueFamilies.includes('weight');
  const pitchStable = /\b(?:pitch|f0).{0,48}\b(?:ok|okay|comfortable|stable|fine|good|already|high enough)\b/i.test(text)
    || /\b(?:ok|okay|comfortable|stable|fine|good|already|high enough).{0,48}\b(?:pitch|f0)\b/i.test(text)
    || /\bpitch stayed stable\b/i.test(text);
  const darkLargeOrBrightTarget = /\b(?:dark|large|heavy|pressed|not (?:cute|bright)|cute bright|bright feminine|bright\/cute)\b/i.test(text);
  const lines = [];

  if (isVoiceTutorConversationNoCorrectionExpected(scenario)) {
    lines.push(
      '- Scenario rule: this is ordinary spoken conversation practice with no requested correction. Respond to the topic aloud; do not add a voice cue, repeat request, analyzer note, sample request, or drill tail.',
      '- Scenario rule: end after the topical answer. Forbidden in this scenario: voice, pitch, resonance, vowel, brighter, forward sound, say it again, let\'s try, repeat, sample, recording, analyzer, drill.',
    );
  }

  if (requiresResonanceAndWeight || (pitchStable && darkLargeOrBrightTarget)) {
    lines.push(
      '- Scenario rule: pitch is already acceptable here. Do not mention pitch at all. Correct dark/large/heavy tone with smaller/forward/brighter resonance plus the exact plain cue "lighter voice weight" or "less pressed".',
    );
  }

  return lines;
}

// The one direction-coded line inside active_drill; every other practice-mode
// line is direction-neutral.
const DIRECTION_ACTIVE_DRILL_PITCH_LINES = {
  feminine: '- If the prompt says pitch is okay, comfortable, or already high enough, do not make pitch the main correction; use forward resonance plus "lighter voice weight".',
};

function buildVoiceTutorPracticeModeLines(practiceMode = 'active_drill', { direction = 'feminine' } = {}) {
  const normalizedMode = normalizeVoiceTutorPracticeMode(practiceMode);
  if (normalizedMode === 'conversation_practice') {
    return [
      '- Practice mode: conversation_practice. Sustain natural spoken dialogue first; acoustic correction is secondary.',
      '- Respond aloud to the actual topic before giving any voice note.',
      '- Default to zero correction on an ordinary spoken turn; let the learner practice by speaking naturally.',
      '- If the learner is not asking for correction, give only the topical spoken response.',
      '- In conversation practice, do not ask the learner to repeat, redo, record, or run a drill unless they directly ask for correction.',
      '- Only if the learner directly asks for correction or a next voice focus, append one tiny cue; never stack pitch, resonance, weight, and prosody in the same spoken reply.',
      '- Do not turn ordinary spoken dialogue into a drill or analyzer report unless the learner asks.',
    ];
  }
  if (normalizedMode === 'safety_reset') {
    return [
      '- Practice mode: safety_reset. Reduce intensity; prioritize comfort, easy phonation, clean capture, and a smaller target.',
      '- In safety reset, do not advance difficulty or reward a strained success.',
    ];
  }
  if (normalizedMode === 'reflection') {
    return [
      '- Practice mode: reflection. Summarize what changed, pick one next focus, and avoid live-drill overload.',
    ];
  }
  if (normalizedMode === 'lesson_plan') {
    return [
      '- Practice mode: lesson_plan. Plan the sequence; do not pretend to hear a take that was not provided.',
    ];
  }
  return [
    '- Practice mode: active_drill. Give one precise voice correction and one next attempt.',
    '- In active drill, do not request a clean sample unless the prompt or analyzer context explicitly says confidence, noise, clipping, or capture quality is bad.',
    DIRECTION_ACTIVE_DRILL_PITCH_LINES[direction] || DIRECTION_ACTIVE_DRILL_PITCH_LINES.feminine,
    '- If a metric score worries the learner but capture quality is not explicitly bad, frame it as a training hint and give one trainable cue.',
  ];
}

// Direction-aware policy lines. The feminine column keeps the original wording
// verbatim; neutral targets get non-gendered guidance instead of feminizing
// cues (the prior behavior for every preset).
const DIRECTION_POLICY_LINES = {
  feminine: {
    affirming: '- Keep the experience female-affirming and immersive by treating the selected target voice as the practice default, not as a comparison against a male baseline.',
    noPitchChasing: '- If the session plan or notepad says no pitch chasing, do not suggest a higher pitch; keep pitch comfortable and use resonance, weight, articulation, or capture reset instead.',
    pitchStable: '- Pitch-stable dark/large rule: if pitch is okay, comfortable, stable, or already high enough but the voice is dark, large, heavy, pressed, or the learner asks for bright/cute style, do not mention pitch at all; pair smaller/forward/brighter resonance with the exact plain cue "lighter voice weight" or "less pressed".',
    larynx: '- If the learner asks about swallowing or holding the larynx high, explicitly reject holding or forcing it and translate to a safe forward/smaller-vowel cue.',
  },
};

function buildVoiceTutorRuntimePolicyLines({
  targetPreset = 'cute-feminine',
  stylePrompt = '',
  includeHeader = true,
  practiceMode = 'active_drill',
} = {}) {
  const styleTarget = getVoiceTutorStyleTarget(targetPreset);
  const direction = getVoiceTutorTargetDirection(targetPreset);
  const directionLines = DIRECTION_POLICY_LINES[direction] || DIRECTION_POLICY_LINES.feminine;
  const customStyle = normalizeText(stylePrompt);
  return [
    ...(includeHeader ? ['Voice tutor policy:'] : []),
    `- Style target: ${styleTarget}${customStyle ? ` Custom style note: ${customStyle}.` : ''}`,
    ...buildVoiceTutorPracticeModeLines(practiceMode, { direction }),
    '- Coach target alignment, not identity scoring; never say the learner is male/female enough, passing, clockable, or failed.',
    directionLines.affirming,
    '- Prefer normal conversation carryover: one ordinary line, one cue, then another natural pass.',
    ...(direction === 'feminine'
      ? ['- For Australian-bright style, use natural everyday phrasing and forward brightness; do not exaggerate accent, personality, age, or gender stereotypes.']
      : []),
    '- Never reward throat squeeze, forced larynx height, whispering, chronic breathiness, or pushing through strain.',
    directionLines.noPitchChasing,
    directionLines.pitchStable,
    directionLines.larynx,
  ];
}

function buildVoiceTutorCapturePolicyLines({ includeHeader = true } = {}) {
  return [
    ...(includeHeader ? ['Capture reliability policy:'] : []),
    '- If analyzer confidence is low, noise is high, clipping is detected, SNR is poor, or speech coverage is too low, ask for one cleaner clearly voiced sample before coaching pitch, resonance, weight, or prosody.',
    '- Treat metrics from consumer microphones as hints; when reliability is provisional, say so briefly and avoid over-correcting.',
    '- For normal rooms, ask for steady mic distance, comfortable volume, and a short voiced line; do not require studio-quality recording.',
  ];
}

module.exports = {
  STYLE_TARGETS,
  buildVoiceTutorPracticeModeLines,
  buildVoiceTutorCapturePolicyLines,
  buildVoiceTutorRuntimePolicyLines,
  buildVoiceTutorScenarioPolicyLines,
  getVoiceTutorStyleTarget,
  getVoiceTutorTargetDirection,
  isVoiceTutorConversationNoCorrectionExpected,
  sanitizeVoiceTutorReplyForRuntimePolicy,
  sanitizeVoiceTutorReplyForPracticeMode,
  shouldEvaluateRawVoiceTutorReply,
  normalizeVoiceTutorPracticeMode,
  normalizeVoiceTutorTargetPreset,
};
