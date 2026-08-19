const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'can',
  'could',
  'do',
  'for',
  'from',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'this',
  'to',
  'we',
  'what',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

const HARD_ONSET_RE = /^[kgtdpbcq]/i;
const ROUNDED_VOWEL_RE = /(oo|oh|ou|ow|aw|or|o|u|w)/i;
const BRIGHT_VOWEL_RE = /(ee|ea|ie|ei|ay|ai|ae|eh|ih|i|e|y)/i;
const QUICK_TIP_RE = /(t|d|n|l|s|z|r)$/i;
const WIDE_A_RE = /(ah|aa|a(?!i|y))/i;

// Preset ids and `direction` mirror the DSP's canonical target profiles
// (services/voice-trainer/src/services/audio_analysis.py TARGET_PROFILES):
// direction is always 'feminine' (2026-07-26 retired the masculinizing direction
// and its presets; 2026-07-30 retired the two neutral presets, leaving MTF only).
// soft-feminine is feminine via
// pitch + lightness rather than brightness, so it carries tone: 'soft' and gets
// its own cue lane (no bright-vowel / forward-push vocabulary).
const PRESET_PROFILES = {
  'cute-feminine': {
    direction: 'feminine',
    defaultIntent: 'friendly invite',
    defaultMask: 'open, hopeful, unhurried',
    baseTeachingFocus: ['bright-vowels', 'light-onset', 'forward-placement', 'small-mouth'],
  },
  'everyday-feminine': {
    direction: 'feminine',
    defaultIntent: 'soft reassurance',
    defaultMask: 'friendly, easy, conversational',
    baseTeachingFocus: ['forward-vowels', 'gentle-onset', 'soft-landings'],
  },
  'bright-playful': {
    direction: 'feminine',
    defaultIntent: 'playful reveal',
    defaultMask: 'sparkly, animated, lifted',
    baseTeachingFocus: ['bright-vowels', 'playful-bounce', 'light-onset', 'forward-placement'],
  },
  'australian-bright-feminine': {
    direction: 'feminine',
    defaultIntent: 'everyday conversation',
    defaultMask: 'friendly, open, Australian-conversational',
    baseTeachingFocus: ['bright-vowels', 'forward-placement', 'light-onset', 'soft-landings'],
  },
  'soft-feminine': {
    direction: 'feminine',
    tone: 'soft',
    defaultIntent: 'soft reassurance',
    defaultMask: 'soft, unhurried, natural',
    baseTeachingFocus: ['gentle-onset', 'light-weight', 'easy-pitch-lift', 'soft-landings'],
  },
  // 'androgynous' and 'gender-neutral' REMOVED 2026-07-30 (MTF-only). This table
  // is a hand-copy of TARGET_PROFILES in audio_analysis.py; nothing syncs it.
  // getCueLane's `if (!profile) return 'feminine'` now answers for them, which is
  // the same answer any unrecognised preset gets — the required equivalence.
};

// Cue lane = which vocabulary set a preset's cues draw from. Feminine-bright
// keeps the original tables verbatim; the other lanes carry direction-appropriate
// language grounded in the matching drill packs (backend/voice-drills.js).
function getCueLane(presetId) {
  const profile = PRESET_PROFILES[presetId];
  if (!profile) return 'feminine';
  if (profile.direction === 'feminine') {
    return profile.tone === 'soft' ? 'soft-feminine' : 'feminine';
  }
  return profile.direction;
}

const CUE_OVERRIDES = {
  again: 'uh-GEHN',
  are: 'ahr',
  back: 'byack',
  can: 'kahn',
  could: 'kuhd',
  cute: 'kyooht',
  do: 'doo',
  for: 'fer',
  game: 'gyaem',
  good: 'gihd',
  guys: 'gaiiiz',
  hello: 'heh-LOH',
  hey: 'heh',
  hi: 'hii',
  i: 'ahy',
  it: 'iht',
  like: 'laik',
  morning: 'MOR-neeng',
  my: 'mai',
  now: 'nyaw',
  okay: 'oh-KAE',
  ok: 'oh-KAE',
  play: 'plae',
  really: 'ree-uh-lee',
  say: 'sae',
  sorry: 'sah-ree',
  stream: 'streeem',
  thank: 'thayngk',
  thanks: 'thayngks',
  that: 'that',
  the: 'thuh',
  to: 'tyoo',
  wait: 'wayt',
  what: 'whaht',
  would: 'wuhd',
  you: 'yuh',
  your: 'yer',
};

// Soft-feminine lane: light onsets and gentle endings, no brightening — the
// lift comes from pitch and lightness, not vowel sharpening.
const SOFT_FEMININE_CUE_OVERRIDES = {
  again: 'uh-gehn',
  could: 'kuhd',
  do: 'doo',
  good: 'guud',
  hello: 'heh-loh',
  hi: 'hii',
  i: 'ai',
  morning: 'mor-ning',
  my: 'mai',
  okay: 'oh-kay',
  ok: 'oh-kay',
  really: 'ree-lee',
  sorry: 'soh-ree',
  the: 'thuh',
  to: 'too',
  you: 'yuu',
  your: 'yor',
};

const LANE_CUE_OVERRIDES = {
  feminine: CUE_OVERRIDES,
  'soft-feminine': SOFT_FEMININE_CUE_OVERRIDES,
};

function clamp01(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.min(1, Math.max(0, Number(value)));
}

const warnedUnknownPresets = new Set();

function normalizeTargetPreset(targetPreset) {
  if (PRESET_PROFILES[targetPreset]) return targetPreset;
  if (targetPreset && !warnedUnknownPresets.has(String(targetPreset))) {
    warnedUnknownPresets.add(String(targetPreset));
    console.warn(`[voice-cue-sheet] unknown targetPreset "${String(targetPreset)}" — falling back to cute-feminine`);
  }
  return 'cute-feminine';
}

function tokenizePhrase(phrase) {
  const tokens = String(phrase || '').match(/[A-Za-z']+|[!?.,;:]/g);
  return Array.isArray(tokens) ? tokens : [];
}

function isWordToken(token) {
  return /[A-Za-z']/.test(String(token || ''));
}

// Phrase-shape variants for the non-bright cue lanes. The feminine lane keeps
// the original inline branches verbatim; these carry the same phrase-shape
// detection with direction-appropriate intent/mask/focus language.
const LANE_PHRASE_VARIANTS = {
  'soft-feminine': {
    question: { phraseIntent: 'curious check-in', expressionMask: 'soft, light, curious', add: 'upward-ending', risingEnding: true },
    exclaim: { phraseIntent: 'gentle delight', expressionMask: 'soft, warm, pleased', add: 'soft-landings', risingEnding: true },
    thanks: { phraseIntent: 'soft reassurance', expressionMask: 'gentle, warm, natural', add: 'soft-landings', risingEnding: false },
    greeting: { phraseIntent: 'friendly invite', expressionMask: 'soft, warm, open', add: 'soft-landings', risingEnding: false },
    ask: { phraseIntent: 'gentle ask', expressionMask: 'soft, lifted, lightly curious', add: 'upward-ending', risingEnding: true },
  },
};

function inferPhraseProfile({ phrase, targetPreset, focus = '', cues = [], description = '', stylePrompt = '' }) {
  const normalizedPreset = normalizeTargetPreset(targetPreset);
  const presetProfile = PRESET_PROFILES[normalizedPreset];
  const text = `${phrase || ''} ${focus || ''} ${description || ''} ${(Array.isArray(cues) ? cues.join(' ') : '')} ${stylePrompt || ''}`
    .toLowerCase();

  const laneVariants = LANE_PHRASE_VARIANTS[getCueLane(normalizedPreset)];
  if (laneVariants) {
    // Same phrase-shape detection, same order, as the feminine branches below.
    const branch = /\?$/.test(String(phrase || '').trim())
      ? 'question'
      : (/!/.test(String(phrase || '')) || /\b(cute|adorable|wow|wait|seriously|super fun)\b/.test(text))
        ? 'exclaim'
        : /\b(thank|thanks|sorry|appreciate)\b/.test(text)
          ? 'thanks'
          : /\b(hi|hey|hello|welcome)\b/.test(text)
            ? 'greeting'
            : /\b(question|intonation|rise|lift|playful)\b/.test(text)
              ? 'ask'
              : null;
    if (branch) {
      const variant = laneVariants[branch];
      return {
        phraseIntent: variant.phraseIntent,
        expressionMask: variant.expressionMask,
        baseTeachingFocus: [...presetProfile.baseTeachingFocus, variant.add],
        risingEnding: variant.risingEnding,
      };
    }
  }

  if (/\?$/.test(String(phrase || '').trim())) {
    return {
      phraseIntent: 'curious check-in',
      expressionMask: normalizedPreset === 'bright-playful' || normalizedPreset === 'australian-bright-feminine'
        ? 'sparkly, lifted, answer-seeking'
        : 'open, hopeful, unhurried',
      baseTeachingFocus: [...presetProfile.baseTeachingFocus, 'upward-ending'],
      risingEnding: true,
    };
  }

  if (/!/.test(String(phrase || '')) || /\b(cute|adorable|wow|wait|seriously|super fun)\b/.test(text)) {
    return {
      phraseIntent: 'playful reveal',
      expressionMask: normalizedPreset === 'everyday-feminine' || normalizedPreset === 'australian-bright-feminine'
        ? 'warm, lifted, expressive'
        : 'sparkly, animated, lifted',
      baseTeachingFocus: [...presetProfile.baseTeachingFocus, 'playful-bounce'],
      risingEnding: true,
    };
  }

  if (/\b(thank|thanks|sorry|appreciate)\b/.test(text)) {
    return {
      phraseIntent: 'soft reassurance',
      expressionMask: 'gentle, warm, lifted',
      baseTeachingFocus: [...presetProfile.baseTeachingFocus, 'soft-landings'],
      risingEnding: false,
    };
  }

  if (/\b(hi|hey|hello|welcome)\b/.test(text)) {
    return {
      phraseIntent: 'friendly invite',
      expressionMask: normalizedPreset === 'bright-playful' || normalizedPreset === 'australian-bright-feminine'
        ? 'sparkly, open, delighted'
        : 'open, smiling, pleased',
      baseTeachingFocus: [...presetProfile.baseTeachingFocus, 'soft-landings'],
      risingEnding: false,
    };
  }

  if (/\b(question|intonation|rise|lift|playful)\b/.test(text)) {
    return {
      phraseIntent: 'bashful ask',
      expressionMask: 'small, lifted, lightly curious',
      baseTeachingFocus: [...presetProfile.baseTeachingFocus, 'upward-ending'],
      risingEnding: true,
    };
  }

  return {
    phraseIntent: presetProfile.defaultIntent,
    expressionMask: presetProfile.defaultMask,
    baseTeachingFocus: [...presetProfile.baseTeachingFocus],
    risingEnding: false,
  };
}

// Resonance / weight keywords map to different focus work depending on the cue
// lane: soft-feminine reaches feminine through pitch and lightness, not brightness.
const LANE_RESONANCE_FOCUS = {
  feminine: ['bright-vowels', 'forward-placement'],
  'soft-feminine': ['natural-resonance'],
};

const LANE_ONSET_FOCUS = {
  feminine: ['light-onset'],
  'soft-feminine': ['gentle-onset'],
};

function buildTeachingFocus({ baseTeachingFocus, focus = '', cues = [], description = '', phrase = '', lane = 'feminine' }) {
  const focusSet = new Set(Array.isArray(baseTeachingFocus) ? baseTeachingFocus : []);
  const text = `${focus || ''} ${description || ''} ${(Array.isArray(cues) ? cues.join(' ') : '')} ${phrase || ''}`.toLowerCase();

  if (/\b(bright|forward|resonance|ng|ee)\b/.test(text)) {
    for (const item of (LANE_RESONANCE_FOCUS[lane] || LANE_RESONANCE_FOCUS.feminine)) {
      focusSet.add(item);
    }
  }
  if (/\b(weight|onset|light|soft|breathy)\b/.test(text)) {
    for (const item of (LANE_ONSET_FOCUS[lane] || LANE_ONSET_FOCUS.feminine)) {
      focusSet.add(item);
    }
  }
  if (/\b(question|lift|intonation|rise|ending)\b/.test(text)) {
    focusSet.add('upward-ending');
  }
  if (/\b(playful|sparkle|bounce)\b/.test(text)) {
    focusSet.add('playful-bounce');
  }
  if (/\b(reference|shadow|echo|mirror|mimic)\b/.test(text)) {
    focusSet.add('reference-matching');
  }
  if (/\b(stable|steady|hold|lane)\b/.test(text)) {
    focusSet.add('steady-lane');
  }

  return [...focusSet];
}

function scoreAnchorWord(word, index, totalWords) {
  const lower = word.toLowerCase();
  if (STOPWORDS.has(lower) && totalWords > 2) {
    return -1;
  }
  const middle = totalWords <= 1 ? 0 : (totalWords - 1) / 2;
  const proximityScore = 1.2 - Math.abs(index - middle) / Math.max(totalWords, 1);
  const lengthScore = Math.min(word.length, 8) * 0.15;
  const brightnessScore = BRIGHT_VOWEL_RE.test(lower) ? 0.7 : 0;
  return proximityScore + lengthScore + brightnessScore;
}

function pickAnchorIndices(wordEntries, risingEnding) {
  const anchors = new Set();
  if (wordEntries.length === 0) return anchors;

  if (risingEnding) {
    anchors.add(wordEntries[wordEntries.length - 1].index);
  }

  const bestCandidate = wordEntries
    .map((entry) => ({ ...entry, score: scoreAnchorWord(entry.word, entry.index, wordEntries.length) }))
    .sort((left, right) => right.score - left.score)[0];

  if (bestCandidate && bestCandidate.score >= 0) {
    anchors.add(bestCandidate.index);
  }

  return anchors;
}

function buildCueWord(word, { isLastWord, risingEnding, anchor, lane = 'feminine' }) {
  const lower = word.toLowerCase();
  const overrides = LANE_CUE_OVERRIDES[lane] || CUE_OVERRIDES;
  let cue = overrides[lower] || lower;

  if (!overrides[lower] && lane === 'feminine') {
    // Brightening respellings are a feminine-lane device; the other lanes keep
    // plain spelling and let the override maps carry the direction.
    cue = cue
      .replace(/ing$/i, 'eeng')
      .replace(/ay/gi, 'ae')
      .replace(/ai/gi, 'ae')
      .replace(/oo/gi, 'oo')
      .replace(/ow$/i, 'ow');
  }

  if (isLastWord && risingEnding && !cue.endsWith('~')) {
    cue = `${cue}~`;
  }

  let styledCue = cue;
  if (!/[A-Z]/.test(styledCue) && anchor) {
    styledCue = styledCue.toUpperCase();
  }

  return {
    cue,
    styledCue,
  };
}

function buildTokenConceptTags({ isFirstWord, isLastWord, hardOnset, brightWord, risingEnding, focus = '', cues = [] }) {
  const tags = new Set();
  const guideText = `${focus || ''} ${(Array.isArray(cues) ? cues.join(' ') : '')}`.toLowerCase();

  if (isFirstWord || hardOnset) {
    tags.add('onset');
    tags.add('weight');
  }
  if (brightWord || /\b(bright|forward|resonance)\b/.test(guideText)) {
    tags.add('resonance');
  }
  if (isLastWord && risingEnding) {
    tags.add('intonation');
    tags.add('pitch');
  }
  if (/\b(reference|shadow|mirror|mimic)\b/.test(guideText)) {
    tags.add('reference');
    tags.add('mimicry');
  }

  return [...tags];
}

// Per-token guidance vocabulary, one entry per cue lane. The feminine column is
// the original wording verbatim; the other lanes keep the same trigger logic but
// speak in that lane's register (light and natural without brightness for the
// soft-feminine lane).
const LANE_MOUTH_SHAPES = {
  feminine: { roundedBright: 'small round then slight smile', rounded: 'small round', bright: 'small smile spread', wideA: 'narrow-open', risingEnd: 'tiny tall vowel', rest: 'keep it small' },
  'soft-feminine': { roundedBright: 'soft round', rounded: 'soft round', bright: 'gentle, barely spread', wideA: 'gentle open', risingEnd: 'tiny tall vowel', rest: 'soft and small' },
};

function inferMouthShape({ roundedWord, brightWord, wideAWord, isLastWord, risingEnding, lane = 'feminine' }) {
  const v = LANE_MOUTH_SHAPES[lane] || LANE_MOUTH_SHAPES.feminine;
  if (roundedWord && brightWord) return v.roundedBright;
  if (roundedWord) return v.rounded;
  if (brightWord) return v.bright;
  if (wideAWord) return v.wideA;
  if (isLastWord && risingEnding) return v.risingEnd;
  return v.rest;
}

const LANE_JAW_ACTIONS = {
  feminine: { risingEnd: 'keep it small at the end', hardOnset: 'barely drop', wideA: 'do not widen', rest: 'keep it small' },
  'soft-feminine': { risingEnd: 'keep it small at the end', hardOnset: 'barely drop', wideA: 'do not widen', rest: 'keep it relaxed' },
};

function inferJawAction({ hardOnset, wideAWord, isLastWord, risingEnding, lane = 'feminine' }) {
  const v = LANE_JAW_ACTIONS[lane] || LANE_JAW_ACTIONS.feminine;
  if (isLastWord && risingEnding) return v.risingEnd;
  if (hardOnset) return v.hardOnset;
  if (wideAWord) return v.wideA;
  return v.rest;
}

const LANE_LIP_ACTIONS = {
  feminine: { risingEnd: 'finish slightly smiling', rounded: 'soft round lips', bright: 'corners up', rest: 'keep forward' },
  'soft-feminine': { risingEnd: 'finish gently', rounded: 'soft round lips', bright: 'soft corners', rest: 'keep soft' },
};

function inferLipAction({ roundedWord, brightWord, isLastWord, risingEnding, lane = 'feminine' }) {
  const v = LANE_LIP_ACTIONS[lane] || LANE_LIP_ACTIONS.feminine;
  if (isLastWord && risingEnding) return v.risingEnd;
  if (roundedWord) return v.rounded;
  if (brightWord) return v.bright;
  return v.rest;
}

const LANE_TONGUE_ACTIONS = {
  feminine: { bright: 'front-high tongue', quickTip: 'tip flips quick', rWord: 'keep the tongue forward, not pulled back', rest: 'tip loose' },
  'soft-feminine': { bright: 'tongue easy, not pushed forward', quickTip: 'tip flips quick', rWord: 'soft r, no pull-back', rest: 'tip loose' },
};

function inferTongueAction({ brightWord, quickTipWord, lowerWord, lane = 'feminine' }) {
  const v = LANE_TONGUE_ACTIONS[lane] || LANE_TONGUE_ACTIONS.feminine;
  if (brightWord) return v.bright;
  if (quickTipWord) return v.quickTip;
  if (/r/.test(lowerWord)) return v.rWord;
  return v.rest;
}

// 2026-07-26: a breath-in cue belongs ONLY on the FIRST word — that is the one
// place in a phrase where the learner actually inhales. Previously every rest
// word carried 'easy steady airflow', so a 9-word line printed 6-7 airflow
// reminders under words where no breath event happens, and the whole sheet read
// as "breathe" advice. Rest words now rotate short, TARGET-ALIGNED, actionable
// micro-cues drawn from the lane's own vocabulary (forward focus / brightness /
// steady pitch), deterministically indexed by word position so the same phrase
// always renders the same sheet.
const LANE_AIRFLOW_CUES = {
  feminine: {
    firstHard: 'tiny gasp start',
    first: 'soft sigh in',
    risingEnd: 'float the release',
    hardOnset: 'soften the hit',
    rest: ['tongue high and forward', 'lips lightly spread', 'steady the pitch'],
  },
  'soft-feminine': {
    firstHard: 'air first, then the word',
    first: 'soft sigh in',
    risingEnd: 'float the release',
    hardOnset: 'soften the hit',
    rest: ['lips soft and easy', 'tongue easy, not pushed', 'steady the pitch'],
  },
};

function inferAirflowCue({
  isFirstWord,
  isLastWord,
  hardOnset,
  risingEnding,
  lane = 'feminine',
  wordIndex = 0,
}) {
  const v = LANE_AIRFLOW_CUES[lane] || LANE_AIRFLOW_CUES.feminine;
  if (isFirstWord && hardOnset) return v.firstHard;
  if (isFirstWord) return v.first;
  if (isLastWord && risingEnding) return v.risingEnd;
  if (hardOnset) return v.hardOnset;
  const rotation = v.rest;
  const index = Number.isInteger(wordIndex) && wordIndex > 0 ? wordIndex : 0;
  return rotation[index % rotation.length];
}

// 2026-07-30: the FEMININE lane gained its own entry, and the 'coolest air on
// the ridge behind the top teeth' default is gone.
//
// That string was the single most-shipped cue in the app — the feminine lane had
// no entry, so four of the five presets fell through to it on every ordinary
// word — and it is the worst instance of the fault this pass exists to fix: it
// asks her to locate where an airstream feels coldest, a discrimination that
// takes trained singers weeks, in an eyes-free product, while telling her not to
// trust her ears. She cannot tell whether she did it, so it teaches nothing.
//
// TWO EARLIER AUDITS BLESSED IT and their tests still cite it — one as approved
// replacement copy, one ruling airstream temperature "a legal body referent".
// Both were judging it on VOCABULARY (is the word banned?), which it passes.
// The rubric in docs/DESIGN-2026-07-30-ADAPTIVE-TEACHING.md §4 judges it on
// VERIFIABILITY (C2 — can she tell she did it?), which it fails. That is the
// newer and, on this point, the deciding standard: the owner's complaint was
// never that the words were forbidden, it was that they were useless to a
// beginner. The replacements name contact and shape she can feel directly.
const LANE_PLACEMENT_FEELS = {
  feminine: {
    bright: 'tongue sides on the upper molars',
    rounded: 'lips forward, corners still back',
    rest: 'tongue sides touching, lips lightly spread',
  },
  'soft-feminine': { bright: 'tongue easy, no push', rounded: 'lips forward, corners not spread', rest: 'tongue easy, jaw loose' },
};

function inferPlacementFeel({ roundedWord, brightWord, lane = 'feminine' }) {
  const v = LANE_PLACEMENT_FEELS[lane] || LANE_PLACEMENT_FEELS.feminine;
  if (brightWord) return v.bright;
  if (roundedWord) return v.rounded;
  return v.rest;
}

const LANE_EXPRESSION_CUES = {
  feminine: { delight: 'tiny delighted gasp', revealIntent: 'playful reveal', question: 'hopeful question', thanks: 'soft reassurance', greeting: 'friendly invite', checkIn: 'gentle check-in' },
  'soft-feminine': { delight: 'soft delight', revealIntent: 'gentle delight', question: 'gentle question', thanks: 'soft reassurance', greeting: 'friendly invite', checkIn: 'gentle check-in' },
};

function inferExpressionCue({ lowerWord, isFirstWord, isLastWord, phraseIntent, risingEnding, lane = 'feminine' }) {
  const v = LANE_EXPRESSION_CUES[lane] || LANE_EXPRESSION_CUES.feminine;
  if (/\b(cute|adorable|love|fun)\b/.test(lowerWord)) return v.delight;
  if (isLastWord && risingEnding) {
    return phraseIntent === v.revealIntent ? v.revealIntent : v.question;
  }
  if (/\b(thank|thanks|sorry)\b/.test(lowerWord)) return v.thanks;
  if (/\b(hi|hey|hello|welcome)\b/.test(lowerWord)) return v.greeting;
  if (isFirstWord && /\b(could|would|can|will)\b/.test(lowerWord)) return v.checkIn;
  return phraseIntent;
}

const LANE_AVOID_CUES = {
  feminine: { risingEnd: 'do not drop', hardOnset: 'do not slam the consonant', rounded: 'do not go wide', rest: 'do not shove' },
  'soft-feminine': { risingEnd: 'do not drop', hardOnset: 'do not slam the consonant', rounded: 'do not go wide', rest: 'do not push from the throat' },
};

function inferAvoidCue({ isLastWord, risingEnding, hardOnset, roundedWord, lane = 'feminine' }) {
  const v = LANE_AVOID_CUES[lane] || LANE_AVOID_CUES.feminine;
  if (isLastWord && risingEnding) return v.risingEnd;
  if (hardOnset) return v.hardOnset;
  if (roundedWord) return v.rounded;
  return v.rest;
}

const LANE_TEACHING_NOTES = {
  feminine: { firstHard: 'start it gently, with no click', risingEnd: 'lift and leave it hanging instead of dropping', bright: 'lip corners back, tongue sides on the upper molars', rounded: 'keep the lips small and the corners still back', rest: 'keep the tongue high and the lips lightly spread' },
  'soft-feminine': { firstHard: 'start it gently, with no click', risingEnd: 'lift and leave it hanging instead of dropping', bright: 'lips soft, tongue easy — no extra spread', rounded: 'keep the lips soft and easy', rest: 'keep the lips soft and the tongue easy' },
};

function inferTeachingNote({ isFirstWord, isLastWord, hardOnset, risingEnding, brightWord, roundedWord, lane = 'feminine' }) {
  const v = LANE_TEACHING_NOTES[lane] || LANE_TEACHING_NOTES.feminine;
  if (isFirstWord && hardOnset) return v.firstHard;
  if (isLastWord && risingEnding) return v.risingEnd;
  if (brightWord) return v.bright;
  if (roundedWord) return v.rounded;
  return v.rest;
}

function buildVoiceCueSheet({
  phrase,
  targetPreset = 'cute-feminine',
  focus = '',
  cues = [],
  description = '',
  stylePrompt = '',
} = {}) {
  const cleanPhrase = String(phrase || '').trim();
  if (!cleanPhrase) {
    return null;
  }

  const resolvedPreset = normalizeTargetPreset(targetPreset);
  const lane = getCueLane(resolvedPreset);
  const tokens = tokenizePhrase(cleanPhrase);
  const words = tokens.filter(isWordToken);
  if (words.length === 0) {
    return null;
  }

  const phraseProfile = inferPhraseProfile({
    phrase: cleanPhrase,
    targetPreset: resolvedPreset,
    focus,
    cues,
    description,
    stylePrompt,
  });
  const teachingFocus = buildTeachingFocus({
    baseTeachingFocus: phraseProfile.baseTeachingFocus,
    focus,
    cues,
    description,
    phrase: cleanPhrase,
    lane,
  });

  const wordEntries = words.map((word, index) => ({ word, index }));
  const anchorIndices = pickAnchorIndices(wordEntries, phraseProfile.risingEnding);
  const builtTokens = [];
  let wordIndex = 0;

  for (const token of tokens) {
    if (!isWordToken(token)) {
      continue;
    }

    const lowerWord = token.toLowerCase();
    const isFirstWord = wordIndex === 0;
    const isLastWord = wordIndex === words.length - 1;
    const hardOnset = HARD_ONSET_RE.test(lowerWord);
    const roundedWord = ROUNDED_VOWEL_RE.test(lowerWord);
    const brightWord = BRIGHT_VOWEL_RE.test(lowerWord);
    const quickTipWord = QUICK_TIP_RE.test(lowerWord);
    const wideAWord = WIDE_A_RE.test(lowerWord);
    const { cue, styledCue } = buildCueWord(token, {
      isLastWord,
      risingEnding: phraseProfile.risingEnding,
      anchor: anchorIndices.has(wordIndex),
      lane,
    });

    const conceptTags = buildTokenConceptTags({
      isFirstWord,
      isLastWord,
      hardOnset,
      brightWord,
      risingEnding: phraseProfile.risingEnding,
      focus,
      cues,
    });

    builtTokens.push({
      text: token,
      cue,
      styledCue,
      emphasis: isLastWord && phraseProfile.risingEnding
        ? 'lift-ending'
        : isFirstWord && hardOnset
          ? 'light-start'
          : anchorIndices.has(wordIndex)
            ? 'keep-bright'
            : 'steady',
      conceptTags,
      mouthShape: inferMouthShape({ roundedWord, brightWord, wideAWord, isLastWord, risingEnding: phraseProfile.risingEnding, lane }),
      jawAction: inferJawAction({ hardOnset, wideAWord, isLastWord, risingEnding: phraseProfile.risingEnding, lane }),
      lipAction: inferLipAction({ roundedWord, brightWord, isLastWord, risingEnding: phraseProfile.risingEnding, lane }),
      tongueAction: inferTongueAction({ brightWord, quickTipWord, lowerWord, lane }),
      airflowCue: inferAirflowCue({
        isFirstWord,
        isLastWord,
        hardOnset,
        risingEnding: phraseProfile.risingEnding,
        lane,
        wordIndex,
      }),
      placementFeel: inferPlacementFeel({ roundedWord, brightWord, targetPreset: resolvedPreset, lane }),
      expressionCue: inferExpressionCue({
        lowerWord,
        isFirstWord,
        isLastWord,
        phraseIntent: phraseProfile.phraseIntent,
        risingEnding: phraseProfile.risingEnding,
        lane,
      }),
      avoidCue: inferAvoidCue({ isLastWord, risingEnding: phraseProfile.risingEnding, hardOnset, roundedWord, lane }),
      note: inferTeachingNote({ isFirstWord, isLastWord, hardOnset, risingEnding: phraseProfile.risingEnding, brightWord, roundedWord, lane }),
      startProgress: clamp01(wordIndex / words.length),
      endProgress: clamp01((wordIndex + 1) / words.length),
    });
    wordIndex += 1;
  }

  const cueLine = builtTokens.map((token) => token.cue).join(' ');
  const styledCueLine = builtTokens.map((token) => token.styledCue || token.cue).join(' ');

  return {
    phrase: cleanPhrase,
    targetPreset: resolvedPreset,
    phraseIntent: phraseProfile.phraseIntent,
    expressionMask: phraseProfile.expressionMask,
    teachingFocus,
    cueLine,
    styledCueLine,
    tokens: builtTokens,
  };
}

module.exports = {
  buildVoiceCueSheet,
  normalizeTargetPreset,
  getCueLane,
  PRESET_PROFILES,
};
