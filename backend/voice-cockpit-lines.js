const { buildVoiceCueSheet } = require('./voice-cue-sheet');

const LINE_LIBRARY = {
  'cute-feminine': [
    {
      id: 'cute-soft-check',
      phrase: 'could you say that again?',
      intent: 'playful check-in',
      difficulty: 'medium',
      tags: ['intonation', 'pitch', 'playful-bounce'],
      teachingFocus: ['upward-ending', 'playful-bounce'],
      referenceFriendly: true,
    },
    {
      id: 'cute-bright-welcome',
      phrase: 'hey, i am really happy you are here',
      intent: 'open welcome',
      difficulty: 'medium',
      tags: ['resonance', 'stability', 'bright-vowels'],
      teachingFocus: ['forward-placement', 'bright-vowels'],
      referenceFriendly: false,
    },
    {
      id: 'cute-light-request',
      phrase: 'can you help me with this?',
      intent: 'small hopeful ask',
      difficulty: 'easy',
      tags: ['onset', 'weight', 'intonation'],
      teachingFocus: ['light-onset', 'small-mouth'],
      referenceFriendly: false,
    },
    {
      id: 'cute-soft-reassure',
      phrase: 'it is okay, we can try again',
      intent: 'soft reassurance',
      difficulty: 'easy',
      tags: ['weight', 'stability', 'soft-landings'],
      teachingFocus: ['light-onset', 'soft-landings'],
      referenceFriendly: false,
    },
    {
      id: 'cute-mirror-line',
      phrase: 'i can do that for you',
      intent: 'friendly assist',
      difficulty: 'medium',
      tags: ['reference', 'mimicry', 'stability'],
      teachingFocus: ['reference-matching', 'steady-lane'],
      referenceFriendly: true,
    },
    {
      id: 'cute-sparkle-reveal',
      phrase: 'that is actually so cute',
      intent: 'tiny delighted reveal',
      difficulty: 'hard',
      tags: ['intonation', 'resonance', 'playful-bounce'],
      teachingFocus: ['playful-bounce', 'bright-vowels'],
      referenceFriendly: false,
    },
  ],
  'everyday-feminine': [
    {
      id: 'everyday-soft-thanks',
      phrase: 'hey, thanks for waiting',
      intent: 'warm appreciation',
      difficulty: 'easy',
      tags: ['onset', 'weight', 'soft-landings'],
      teachingFocus: ['gentle-onset', 'soft-landings'],
      referenceFriendly: false,
    },
    {
      id: 'everyday-balanced-opinion',
      phrase: 'i really like that idea',
      intent: 'warm agreement',
      difficulty: 'medium',
      tags: ['resonance', 'stability', 'bright-vowels'],
      teachingFocus: ['forward-vowels', 'steady-lane'],
      referenceFriendly: false,
    },
    {
      id: 'everyday-helpful-check',
      phrase: 'let me check that for you',
      intent: 'calm assist',
      difficulty: 'medium',
      tags: ['reference', 'mimicry', 'stability'],
      teachingFocus: ['reference-matching', 'steady-lane'],
      referenceFriendly: true,
    },
    {
      id: 'everyday-light-curiosity',
      phrase: 'do you want to try that again?',
      intent: 'easy question',
      difficulty: 'medium',
      tags: ['intonation', 'pitch', 'soft-landings'],
      teachingFocus: ['upward-ending', 'soft-landings'],
      referenceFriendly: false,
    },
    {
      id: 'everyday-steady-comment',
      phrase: 'that actually sounds pretty good',
      intent: 'soft assessment',
      difficulty: 'hard',
      tags: ['pitch', 'stability', 'intonation'],
      teachingFocus: ['steady-lane', 'natural-arc'],
      referenceFriendly: false,
    },
  ],
  'bright-playful': [
    {
      id: 'playful-bouncy-question',
      phrase: 'are you coming with me?',
      intent: 'sparkly invite',
      difficulty: 'medium',
      tags: ['intonation', 'pitch', 'playful-bounce'],
      teachingFocus: ['upward-ending', 'playful-bounce'],
      referenceFriendly: true,
    },
    {
      id: 'playful-fun-reveal',
      phrase: 'okay, that is super fun',
      intent: 'excited reveal',
      difficulty: 'medium',
      tags: ['weight', 'intonation', 'playful-bounce'],
      teachingFocus: ['light-onset', 'playful-bounce'],
      referenceFriendly: false,
    },
    {
      id: 'playful-mirror-burst',
      phrase: 'wait, that is so cute',
      intent: 'sparkly reaction',
      difficulty: 'easy',
      tags: ['reference', 'mimicry', 'intonation'],
      teachingFocus: ['reference-matching', 'playful-bounce'],
      referenceFriendly: true,
    },
    {
      id: 'playful-bright-compliment',
      phrase: 'that is seriously adorable',
      intent: 'playful compliment',
      difficulty: 'hard',
      tags: ['resonance', 'playful-bounce', 'bright-vowels'],
      teachingFocus: ['forward-placement', 'bright-vowels'],
      referenceFriendly: false,
    },
    {
      id: 'playful-lifted-ask',
      phrase: 'can we do that one more time?',
      intent: 'animated ask',
      difficulty: 'hard',
      tags: ['intonation', 'pitch', 'weight'],
      teachingFocus: ['upward-ending', 'light-onset'],
      referenceFriendly: false,
    },
  ],
  'australian-bright-feminine': [
    {
      id: 'aus-bright-no-worries',
      phrase: 'yeah, no worries, i can do that',
      intent: 'easy everyday agreement',
      difficulty: 'easy',
      tags: ['resonance', 'stability', 'conversation', 'bright-vowels'],
      teachingFocus: ['forward-placement', 'bright-vowels', 'steady-lane'],
      referenceFriendly: false,
    },
    {
      id: 'aus-bright-check-in',
      phrase: 'do you want me to check that for you?',
      intent: 'warm conversational check-in',
      difficulty: 'medium',
      tags: ['intonation', 'conversation', 'soft-landings'],
      teachingFocus: ['upward-ending', 'soft-landings'],
      referenceFriendly: true,
    },
    {
      id: 'aus-bright-reckon',
      phrase: 'i reckon that sounds pretty good',
      intent: 'casual supportive opinion',
      difficulty: 'medium',
      tags: ['resonance', 'weight', 'conversation'],
      teachingFocus: ['forward-vowels', 'light-onset'],
      referenceFriendly: false,
    },
    {
      id: 'aus-bright-cafe',
      phrase: 'can i grab a coffee when you are ready?',
      intent: 'cafe ordering roleplay',
      difficulty: 'hard',
      tags: ['conversation', 'intonation', 'stability'],
      teachingFocus: ['natural-arc', 'steady-lane'],
      referenceFriendly: true,
    },
    {
      id: 'aus-bright-transfer',
      phrase: 'i will see you in a minute',
      intent: 'normal conversation carryover',
      difficulty: 'medium',
      tags: ['conversation', 'transfer', 'bright-vowels'],
      teachingFocus: ['bright-vowels', 'soft-landings'],
      referenceFriendly: false,
    },
  ],
  'soft-feminine': [
    {
      id: 'soft-gentle-hello',
      phrase: 'hi, it is really good to see you',
      intent: 'gentle greeting',
      difficulty: 'easy',
      tags: ['onset', 'weight', 'soft-landings'],
      teachingFocus: ['gentle-onset', 'soft-landings'],
      referenceFriendly: true,
    },
    {
      id: 'soft-quiet-thanks',
      phrase: 'thank you, that really helps',
      intent: 'quiet appreciation',
      difficulty: 'easy',
      tags: ['weight', 'stability', 'soft-landings'],
      teachingFocus: ['gentle-onset', 'steady-lane'],
      referenceFriendly: false,
    },
    {
      id: 'soft-easy-ask',
      phrase: 'could i get a flat white, please?',
      intent: 'everyday cafe ask',
      difficulty: 'medium',
      tags: ['conversation', 'intonation', 'onset'],
      teachingFocus: ['gentle-onset', 'upward-ending'],
      referenceFriendly: true,
    },
    {
      id: 'soft-calm-reassure',
      phrase: 'take your time, there is no rush',
      intent: 'calm reassurance',
      difficulty: 'medium',
      tags: ['weight', 'stability', 'soft-landings'],
      teachingFocus: ['soft-landings', 'steady-lane'],
      referenceFriendly: false,
    },
    {
      id: 'soft-mirror-line',
      phrase: 'i was hoping you would say that',
      intent: 'warm echo line',
      difficulty: 'hard',
      tags: ['reference', 'mimicry', 'stability'],
      teachingFocus: ['reference-matching', 'soft-landings'],
      referenceFriendly: true,
    },
  ],
};

const DIFFICULTY_LEVELS = {
  easy: 0,
  medium: 1,
  hard: 2,
};

function normalizeTargetPreset(targetPreset) {
  return LINE_LIBRARY[targetPreset] ? targetPreset : 'cute-feminine';
}

function normalizeDifficultyPreference(value) {
  return ['adaptive', 'easy', 'medium', 'hard'].includes(value) ? value : 'adaptive';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferDrillDifficulty(drill) {
  const tags = Array.isArray(drill?.tags) ? drill.tags : [];
  if (tags.includes('starter') || tags.includes('onset') || tags.includes('weight')) {
    return 'easy';
  }
  if (tags.includes('mimicry') || tags.includes('reference') || tags.includes('intonation')) {
    return 'hard';
  }
  return 'medium';
}

function buildLineFromCue({
  id,
  displayText,
  targetPreset,
  source,
  intent = '',
  difficulty = 'medium',
  teachingFocus = [],
  tags = [],
  referenceFriendly = false,
  targetVoiceProfile = null,
  cueSheet = null,
}) {
  const normalizedPreset = normalizeTargetPreset(targetPreset);
  const resolvedCueSheet = cueSheet || buildVoiceCueSheet({
    phrase: displayText,
    targetPreset: normalizedPreset,
    focus: teachingFocus.join(' '),
    description: intent,
    cues: tags,
    stylePrompt: targetVoiceProfile?.stylePrompt || '',
  });

  return {
    id,
    displayText,
    performanceText: resolvedCueSheet?.styledCueLine || resolvedCueSheet?.cueLine || displayText,
    intent: intent || resolvedCueSheet?.phraseIntent || 'guided practice',
    difficulty,
    targetPreset: normalizedPreset,
    teachingFocus: Array.isArray(resolvedCueSheet?.teachingFocus) && resolvedCueSheet.teachingFocus.length > 0
      ? resolvedCueSheet.teachingFocus
      : teachingFocus,
    source,
    referenceMode: referenceFriendly ? 'reference-informed' : 'self-guided',
    cueSheet: resolvedCueSheet,
    pinned: false,
    _tags: Array.isArray(tags) ? tags.slice() : [],
    _referenceFriendly: referenceFriendly,
  };
}

function buildLineFromTemplate(template, targetPreset, targetVoiceProfile = null) {
  return buildLineFromCue({
    id: `generated-${normalizeTargetPreset(targetPreset)}-${template.id}`,
    displayText: template.phrase,
    targetPreset,
    source: 'generated',
    intent: template.intent,
    difficulty: template.difficulty,
    teachingFocus: template.teachingFocus,
    tags: template.tags,
    referenceFriendly: template.referenceFriendly,
    targetVoiceProfile,
  });
}

function buildLineFromDrill(drill, targetPreset, targetVoiceProfile = null, priority = 'adaptive-drill') {
  return buildLineFromCue({
    id: `${priority}-${slugify(drill?.id || drill?.phrase || 'line')}`,
    displayText: String(drill?.phrase || '').trim(),
    targetPreset,
    source: priority,
    intent: drill?.focus || drill?.title || 'guided drill',
    difficulty: inferDrillDifficulty(drill),
    teachingFocus: Array.isArray(drill?.cueSheet?.teachingFocus) ? drill.cueSheet.teachingFocus : [],
    tags: Array.isArray(drill?.tags) ? drill.tags : [],
    referenceFriendly: Array.isArray(drill?.tags) && (drill.tags.includes('reference') || drill.tags.includes('mimicry')),
    targetVoiceProfile,
    cueSheet: drill?.cueSheet || null,
  });
}

function scoreDifficulty(lineDifficulty, preference) {
  if (preference === 'adaptive') return 0;
  const lineLevel = DIFFICULTY_LEVELS[lineDifficulty] ?? DIFFICULTY_LEVELS.medium;
  const prefLevel = DIFFICULTY_LEVELS[preference] ?? DIFFICULTY_LEVELS.medium;
  const distance = Math.abs(lineLevel - prefLevel);
  if (distance === 0) return 1.4;
  if (distance === 1) return 0.25;
  return -0.55;
}

function scoreLine(line, {
  recommendationTags = new Set(),
  recommendedIds = new Set(),
  selectedDrillId = '',
  difficultyPreference = 'adaptive',
  hasReference = false,
} = {}) {
  let score = 1;
  const tags = Array.isArray(line._tags) ? line._tags : [];

  for (const tag of tags) {
    if (recommendationTags.has(tag)) {
      score += 0.95;
    }
  }

  if (line.source === 'selected-drill') {
    score += 2.8;
  } else if (line.source === 'adaptive-drill') {
    score += 1.6;
  }

  if (selectedDrillId && line.id.includes(slugify(selectedDrillId))) {
    score += 1.5;
  }

  for (const recommendedId of recommendedIds) {
    if (line.id.includes(slugify(recommendedId))) {
      score += 1.1;
    }
  }

  if (hasReference && line._referenceFriendly) {
    score += 0.5;
  }

  score += scoreDifficulty(line.difficulty, difficultyPreference);
  return score;
}

function dedupeLines(lines) {
  const seen = new Set();
  const deduped = [];
  for (const line of lines) {
    const key = `${String(line.displayText || '').toLowerCase()}::${line.source}`;
    if (!line.displayText || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(line);
  }
  return deduped;
}

function stripInternalFields(line) {
  if (!line || typeof line !== 'object') return null;
  const { _tags, _referenceFriendly, ...rest } = line;
  return rest;
}

/**
 * Pick a catalog line for the cockpit `regenerate` action — the per-preset seed
 * pool behind POST /voice/cockpit/line (wired 2026-07-19; before that the route
 * re-issued the same drill phrase on regenerate). Deterministic rotation: if the
 * current active line is a catalog line, serve the next template in the preset's
 * LINE_LIBRARY order; otherwise serve the first template that does not repeat
 * the current display text. Returns a full line in the same response shape as
 * the ranked builder, or null when the catalog has nothing new to offer (the
 * route then falls back to the drill path).
 */
function pickVoiceCockpitCatalogLine({
  targetPreset = 'cute-feminine',
  currentLineId = '',
  excludeText = '',
  targetVoiceProfile = null,
} = {}) {
  const normalizedPreset = normalizeTargetPreset(targetPreset);
  const templates = LINE_LIBRARY[normalizedPreset] || [];
  if (templates.length === 0) return null;

  const normalizedExclude = String(excludeText || '').trim().toLowerCase();
  const currentIndex = templates.findIndex(
    (template) => `generated-${normalizedPreset}-${template.id}` === String(currentLineId || ''),
  );

  for (let step = 1; step <= templates.length; step += 1) {
    const template = templates[(currentIndex + step + templates.length) % templates.length];
    const phrase = String(template.phrase || '').trim().toLowerCase();
    if (normalizedExclude && phrase === normalizedExclude) continue;
    return stripInternalFields(buildLineFromTemplate(template, normalizedPreset, targetVoiceProfile));
  }
  return null;
}

function buildVoiceCockpitLines({
  targetPreset = 'cute-feminine',
  targetVoiceProfile = null,
  selectedDrill = null,
  drills = [],
  recommendedIds = [],
  recommendationTags = [],
  difficultyPreference = 'adaptive',
} = {}) {
  const normalizedPreset = normalizeTargetPreset(targetPreset);
  const difficulty = normalizeDifficultyPreference(difficultyPreference);
  const recommendationTagSet = new Set(Array.isArray(recommendationTags) ? recommendationTags : []);
  const recommendedSet = new Set(Array.isArray(recommendedIds) ? recommendedIds : []);
  const selectedDrillId = typeof selectedDrill?.id === 'string' ? selectedDrill.id : '';
  const hasReference = Boolean(targetVoiceProfile);
  const templates = LINE_LIBRARY[normalizedPreset] || LINE_LIBRARY['cute-feminine'];
  const candidateLines = [];

  if (selectedDrill?.phrase) {
    candidateLines.push(buildLineFromDrill(selectedDrill, normalizedPreset, targetVoiceProfile, 'selected-drill'));
  }

  for (const drill of Array.isArray(drills) ? drills : []) {
    if (!drill?.phrase) continue;
    candidateLines.push(buildLineFromDrill(drill, normalizedPreset, targetVoiceProfile));
  }

  for (const template of templates) {
    candidateLines.push(buildLineFromTemplate(template, normalizedPreset, targetVoiceProfile));
  }

  const ranked = dedupeLines(candidateLines)
    .map((line) => ({
      line,
      score: scoreLine(line, {
        recommendationTags: recommendationTagSet,
        recommendedIds: recommendedSet,
        selectedDrillId,
        difficultyPreference: difficulty,
        hasReference,
      }),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => stripInternalFields(entry.line))
    .filter(Boolean);

  return ranked.slice(0, 5);
}

module.exports = {
  buildVoiceCockpitLines,
  normalizeDifficultyPreference,
  pickVoiceCockpitCatalogLine,
};
