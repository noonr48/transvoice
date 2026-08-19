const VOICE_DRILL_PACKS = {
  'cute-feminine': [
    {
      id: 'cute-bright-reset',
      title: 'Tongue brace reset',
      focus: 'Tongue-body resonance',
      phrase: 'need a little magic',
      description: 'Set the tongue body high and the lip corners back before longer phrases.',
      cues: [
        'Start on a tiny "ng" before opening to "ee".',
        'Change one thing you can actually feel: the sides of your tongue touching your upper back teeth.',
        'Keep the jaw loose and start each word softly.',
      ],
      tags: ['starter', 'resonance', 'weight'],
      successCriteria: 'The tongue sides stay touching your back teeth all the way through, and nothing tightens.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      id: 'cute-light-onset',
      title: 'Soft starts',
      focus: 'Soft starts, no click',
      phrase: 'hi, it is so nice to meet you',
      description: 'Start each word from silence with no click and no puff of air before the tone.',
      cues: [
        'Let the jaw drop loose before the first word.',
        'Start each word on a tiny, gentle "uh" instead of a hard attack.',
        'Keep the first word easy — if the buzz in your chest jumps, start softer.',
      ],
      tags: ['starter', 'weight', 'onset'],
      successCriteria: 'The first word starts clean, with no hard click and no extra weight.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'easy',
    },
    {
      id: 'cute-question-lilt',
      title: 'Question lilt',
      focus: 'Playful intonation',
      phrase: 'could you say that again?',
      description: 'Build a buoyant upward contour at the end of a short question.',
      cues: [
        'Let the pitch of the final two words step up together.',
        'Keep the lips easy through the lift — no squeeze.',
        'Let the last two words step up together, the way a question sounds.',
      ],
      tags: ['pitch', 'intonation'],
      successCriteria: 'The last two words step up; the pitch does not fall at the end.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      id: 'cute-shadow-chunks',
      title: 'Copy chunks',
      focus: 'Reference matching',
      phrase: 'i can do that for you',
      description: 'Copy short chunks of the target voice before attempting full sentences.',
      cues: [
        'Copy one short phrase at a time.',
        // 2026-07-30: was "Judge it by the contact and by where the air feels
        // coolest, not by what it sounds like to you." That cue switched her ears
        // OFF and substituted locating the coolest point of an airstream — a
        // discrimination that takes trained singers weeks, so she could not check
        // it on the attempt she just made. This drill's job is COPYING a
        // reference, and comparing two sounds back to back is something she
        // already does; the difference she can name is the thing to change.
        'Say your copy straight after theirs and listen for the one thing that is different.',
        'Restart if the jaw tightens or the sound gets heavier halfway through.',
      ],
      tags: ['mimicry', 'stability', 'reference'],
      successCriteria: 'The take stays close to the reference voice the whole way through.',
      contraindications: ['do_not_use_if_no_reference'],
      difficulty: 'medium',
    },
  ],
  'everyday-feminine': [
    {
      id: 'everyday-forward-vowels',
      title: 'Forward vowels',
      focus: 'Everyday tongue-side resonance',
      phrase: 'i really like that idea',
      description: 'Hold the tongue-side contact through ordinary speech without squeezing the throat.',
      cues: [
        'Press the sides of your tongue against your upper back teeth on "like" and "idea".',
        'Hold that one contact and let everything else be wrong on purpose.',
        'Keep the jaw loose so the phrase stays conversational.',
      ],
      tags: ['starter', 'resonance', 'stability'],
      successCriteria: 'The tongue stays forward for the full phrase; no throat tension.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      id: 'everyday-soft-entry',
      title: 'Soft entry',
      focus: 'Gentle starts',
      phrase: 'hey, thanks for waiting',
      description: 'Start each word so gently there is no click before the tone.',
      cues: [
        'Start with the jaw barely open — smaller than you think you need.',
        'Start the first word on a tiny, gentle "uh" instead of slamming into it.',
        'Take the push away instead of adding air — quieter is not airier.',
      ],
      tags: ['starter', 'weight', 'onset'],
      successCriteria: 'The sound stays free of extra weight; no word starts with a hard click.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'easy',
    },
    {
      id: 'everyday-conversation-arc',
      title: 'Conversation arc',
      focus: 'Natural melodic movement',
      phrase: 'that actually sounds pretty good',
      description: 'Add enough pitch movement to sound alive without turning it theatrical.',
      cues: [
        'Let the pitch rise through the middle of the sentence, then settle softly.',
        'Avoid ending completely flat.',
        'Keep the lips and jaw moving smoothly, never in jumps.',
      ],
      tags: ['pitch', 'intonation', 'stability'],
      successCriteria: 'The pitch moves enough to sound alive; the ending does not drop.',
      contraindications: [],
      difficulty: 'medium',
    },
    {
      id: 'everyday-shadow-repeat',
      title: 'Copy repeat',
      focus: 'Reference imitation',
      phrase: 'let me check that for you',
      description: 'Repeat a practical everyday sentence while matching the target voice\'s feel.',
      cues: [
        'Listen and copy it once, pause, then repeat from memory.',
        'Match both how high the voice goes and the rhythm.',
        'Shorter chunks beat one long rushed pass.',
      ],
      tags: ['mimicry', 'reference', 'pitch'],
      successCriteria: 'The take stays close to the reference voice the whole way through.',
      contraindications: ['do_not_use_if_no_reference'],
      difficulty: 'medium',
    },
  ],
  'bright-playful': [
    {
      id: 'playful-sparkle-reset',
      title: 'Sparkle reset',
      focus: 'Wide lip-corner spread',
      phrase: 'that is seriously adorable',
      description: 'Draw the lip corners back and hold them there before longer lines.',
      cues: [
        'Draw your lip corners straight back so your lips lie flat against your teeth.',
        'Keep the tongue sides on your upper back teeth the whole way through.',
        'Keep the jaw loose and the sides of the tongue on the upper molars.',
      ],
      tags: ['starter', 'resonance', 'weight'],
      successCriteria: 'The tongue stays forward and the sound stays easy, not heavy.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      id: 'playful-rising-question',
      title: 'Rising question',
      focus: 'Animated question endings',
      phrase: 'are you coming with me?',
      description: 'Let the pitch keep climbing all the way to the last word of a question.',
      cues: [
        'Now the same last word at half the volume — height that survives quiet was real.',
        'Keep the tongue high and forward while climbing.',
        'End higher than you started — the last word should sound like it rises.',
      ],
      tags: ['pitch', 'intonation'],
      successCriteria: 'The last word is clearly higher than the first — you can hear it rise.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'medium',
    },
    {
      id: 'playful-light-bounce',
      title: 'Easy bounce',
      focus: 'Less weight, same loudness',
      phrase: 'okay, that is super fun',
      description: 'Palm flat on your breastbone: make the buzz weaker without getting quieter.',
      cues: [
        'Teeth a fingertip apart, slide the jaw slowly left then right — moving releases what "relax" does not.',
        'Reset if the buzz under your palm turns hard and rattly.',
        'Keep the pitch moving without the sound getting heavy.',
      ],
      tags: ['weight', 'onset', 'stability'],
      successCriteria: 'The sound stays free of extra weight for the full phrase.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'medium',
    },
    {
      // 2026-07-26 equipment law: the id stays (it is a rotation/lesson key, never
      // rendered), but the learner-facing title and description no longer say
      // "mirror" — `description` becomes the spoken performanceText, and an
      // object-shaped word there invites the learner to go find one. "echo" keeps
      // the same meaning and still classifies as mimicry (see DRILL_TAG_RULES).
      id: 'playful-mirror-burst',
      title: 'Echo burst',
      focus: 'Target imitation',
      phrase: 'wait, that is so cute',
      description: 'Use a short expressive line to echo the target voice quickly.',
      cues: [
        'Listen once, then echo immediately.',
        'Copy how the voice rises and falls, and how strong it sounds — not just the notes.',
        'Short expressive bursts are better than one long drift.',
      ],
      tags: ['mimicry', 'reference', 'intonation'],
      successCriteria: 'The take stays close to the reference voice; the tongue stays forward.',
      contraindications: ['do_not_use_if_no_reference'],
      difficulty: 'medium',
    },
  ],
  'australian-bright-feminine': [
    {
      id: 'aus-bright-forward-chat',
      title: 'Forward chat',
      focus: 'Everyday tongue-side resonance',
      phrase: 'yeah, no worries, i can do that',
      description: 'Carry the tongue-side contact into ordinary Australian conversation.',
      cues: [
        'Keep the sides of your tongue touching your upper back teeth, not louder.',
        'Use normal conversation speed.',
        'If the room is noisy, go by feel — tongue sides on your upper back teeth.',
      ],
      tags: ['starter', 'resonance', 'conversation'],
      successCriteria: 'The tongue stays forward; the sound stays free of extra weight.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      id: 'aus-bright-light-check',
      title: 'Easy check-in',
      focus: 'Question lift without caricature',
      phrase: 'do you want me to check that for you?',
      description: 'Lift a natural question while the gentle word starts and the tongue-side contact hold.',
      cues: [
        'Let the pitch of the final phrase step up gently.',
        'Keep the jaw loose and the tongue sides on the upper molars.',
        'Do not turn it sing-song.',
      ],
      tags: ['intonation', 'pitch', 'conversation'],
      successCriteria: 'The ending lifts enough to hear, and still sounds like a normal question.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'medium',
    },
    {
      id: 'aus-bright-cafe-roleplay',
      title: 'Cafe roleplay',
      focus: 'Conversational transfer',
      phrase: 'can i grab a coffee when you are ready?',
      description: 'Practice the target voice in a normal café-style request.',
      cues: [
        'Keep one thing stable: the sides of your tongue on your upper back teeth.',
        'Hold only the tongue-side contact through the words; the lips and jaw are allowed to move.',
        'Record it again if background noise covered your voice.',
      ],
      tags: ['transfer', 'conversation', 'resonance'],
      successCriteria: 'The whole request comes out in one setting — the end sounds like the start.',
      contraindications: ['do_not_use_if_capture_low'],
      difficulty: 'hard',
    },
    {
      id: 'aus-bright-reference-repeat',
      title: 'Reference repeat',
      focus: 'Target match',
      phrase: 'i reckon that sounds pretty good',
      description: 'Match the selected target\'s tongue and lip shaping without copying identity.',
      cues: [
        'If it starts to cost anything, stop first, let the throat soften, then find the version that costs nothing.',
        'Keep the low notes comfortable.',
        'Stop if your throat starts to squeeze or ache.',
      ],
      tags: ['mimicry', 'reference', 'stability'],
      successCriteria: 'The take stays close to the reference voice; the tongue stays forward.',
      contraindications: ['do_not_use_if_no_reference', 'do_not_use_if_strain'],
      difficulty: 'hard',
    },
  ],
  'soft-feminine': [
    {
      id: 'soft-light-lift',
      title: 'Easy lift',
      focus: 'Higher pitch, less weight',
      phrase: 'oh, that is lovely',
      description: 'Slide the tone up in one unbroken line without letting it get louder.',
      cues: [
        // 2026-07-30: was "Let the voice box ride up with the tone instead of
        // holding it down." The larynx is the one body part in this pack she has
        // no way to command — the intrinsic laryngeal muscles carry almost no
        // proprioceptors — so the cue named a control she does not have. An
        // imagined listener distance is external, she already owns it, and it has
        // the same acoustic consequence (close speech does not press the tone
        // down). The safety line below still names the throat, deliberately: a
        // sentence whose job is "stop if it hurts" is not a production cue.
        'Say it like you are talking to someone right next to you, not calling across a room.',
        'Start the vowel from silence so gently there is no click before it.',
        'Stop if your throat burns or aches — the lift should feel like almost nothing.',
      ],
      tags: ['pitch', 'weight', 'onset'],
      successCriteria: 'The slide goes up in one piece and the buzz under your palm stays weak; no strain.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'easy',
    },
    {
      id: 'soft-natural-tone',
      title: 'Natural tone',
      focus: 'Soft, natural resonance',
      phrase: 'how was your day',
      description: 'Keep the tongue easy and the lips soft, with no push from the back of the throat.',
      cues: [
        'Keep the jaw loose and the lips soft — nothing pushed from behind.',
        'Let the pitch do the work: slide it up without adding effort.',
        'Keep the lips soft and unspread — soft is the goal, not sharp.',
      ],
      tags: ['resonance', 'weight'],
      successCriteria: 'The line comes out at one easy effort from first word to last — no strain, no squeeze.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'easy',
    },
    {
      id: 'soft-shadow',
      title: 'Copy chunks',
      focus: 'Reference matching',
      phrase: 'i can help with that',
      description: 'Copy short chunks of a soft feminine reference voice.',
      cues: [
        'Copy one short phrase at a time, matching the tongue and lip shape.',
        'Stay close to how the reference voice sounds.',
        'Restart if the voice gets heavy or pressed.',
      ],
      tags: ['mimicry', 'stability', 'reference'],
      successCriteria: 'The take stays close to the reference voice the whole way through.',
      contraindications: ['do_not_use_if_no_reference'],
      difficulty: 'medium',
    },
  ],
};

// --- Zero-prop vocalise drills (flow lane) ----------------------------------
// Five drill kinds that need NOTHING but a voice and a phone. Each entry keeps
// the standard drill shape and adds the flow-lane contract fields:
//   kind:         'siren' | 'hum_sovt' | 'sustained' | 'resonance_play' | 'trill'
//                 (the tag B-SIG resolves takeKind from)
//   tier:         'full' | 'quiet' | 'both' — which session tiers may surface it
//   needsNothing: true — the zero-prop guarantee, machine-checkable
// Trills are full-voice, private-moment work (tier 'full' + a 'private' tag)
// and guided by feel rather than judged take-by-take. Resonance play is about
// the difference between the small take and the big take, not either alone.
// Cue language reuses the existing fem/neutral register split.
const VOCALISE_DIRECTIONS = {
  feminine: [
    {
      kind: 'siren',
      tier: 'both',
      title: 'Siren glide',
      focus: 'Pitch range, unbroken',
      phrase: 'mmm—ooo, up and over, down and home',
      description: 'Slide the voice up and back down on an easy mm or oo in one unbroken line.',
      cues: [
        'If it goes thin at the top, come down until it is full again, then up one small step that stays full.',
        'Round your lips at the top and glide back down to a soft landing.',
        'Keeping it quiet? Make it three small steps — low, middle, high — on a tiny hum.',
      ],
      // Marks that cues[0] DEMANDS VOLUME ("come down until it is full again")
      // and names the quiet alternative. Only set it where cues[0] genuinely asks
      // for loudness — the hum's cues[0] is already quiet AND is the how-to, so
      // forcing a 'quiet' refinement there made the sole cue less useful.
      // Consumed by backend/lessons/self-practice.js.
      quietCueIndex: 2,
      tags: ['vocalise', 'pitch'],
      successCriteria: 'The slide stays smooth and connected top to bottom, with no jumps or pressing.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'hum_sovt',
      tier: 'both',
      title: 'Hum and bloom',
      focus: 'Easy hum into soft starts',
      phrase: 'mmm… mmm—me, mmm—more',
      description: 'Rest on an easy hum, then let it open into a small word without a bump.',
      cues: [
        'Lips closed, hum tiny and steady — no scratch in it.',
        'Open mmm into "me" without changing effort.',
        'Keep the tongue high and the lip corners back; quiet is exactly right for this one.',
      ],
      tags: ['vocalise', 'resonance', 'onset'],
      successCriteria: 'The word starts exactly where the hum was sitting — no bump, no reset.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'sustained',
      tier: 'both',
      title: 'Steady vowel',
      focus: 'One vowel, held even',
      phrase: 'ahh… ehh (steady holds)',
      description: 'Hold one easy vowel steady — same pitch, same size — then let it go.',
      cues: [
        'Pick ah or eh, start gently with no click, and hold it even for a slow count of five.',
        'Keep the sound flat and calm — small wobbles are fine.',
        'If you try ee, go by ear and feel.',
      ],
      tags: ['vocalise', 'stability', 'pitch'],
      successCriteria: 'The hold stays even in pitch and size from start to finish.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'resonance_play',
      tier: 'full',
      title: 'Small voice, big voice',
      focus: 'Feeling resonance move',
      phrase: 'hello (small) … hello (big)',
      description: 'Say one word in your smallest comfortable voice, then in your biggest — and feel what moves.',
      cues: [
        'Same word twice: first with the lip corners back, then with the jaw wide open.',
        'Notice where your tongue and jaw sit each time — the change is the exercise.',
        'What counts is the difference between the two takes, not either one alone.',
      ],
      tags: ['vocalise', 'resonance'],
      successCriteria: 'The two takes land clearly apart — the change between them is what the coach listens for.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'medium',
    },
    {
      kind: 'trill',
      tier: 'full',
      title: 'Lip trill release',
      focus: 'Loose, easy airflow',
      phrase: 'brrr… (lips) or rrr… (tongue)',
      description: 'Let the lips or tongue flutter on easy air — a private, full-voice loosener, guided by feel.',
      cues: [
        'Loose lips, easy air — let the flutter ride a gentle tone.',
        'The right version usually feels like almost nothing — do not go hunting for a feeling.',
        'If trills will not come today, a gentle hum does the same job.',
      ],
      tags: ['vocalise', 'onset', 'private'],
      successCriteria: 'The flutter stays loose and steady on comfortable air — guided by feel.',
      contraindications: [],
      difficulty: 'medium',
    },
  ],
  neutral: [
    {
      kind: 'siren',
      tier: 'both',
      title: 'Siren glide',
      focus: 'Pitch range around the centre',
      phrase: 'mmm—ooo, up a little, back to centre',
      description: 'Slide a little above and below your centre on an easy mm or oo, always returning home.',
      cues: [
        'Small slides either side of centre — easy up, easy down.',
        'Always land back at the same home note, calm and even.',
        'Keeping it quiet? Make it three small steps — low, centre, high — on a tiny hum.',
      ],
      quietCueIndex: 2,
      tags: ['vocalise', 'pitch'],
      successCriteria: 'The slides stay smooth and keep returning to the same centre note.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'hum_sovt',
      tier: 'both',
      title: 'Hum and bloom',
      focus: 'Even hum into balanced starts',
      phrase: 'mmm… mmm—middle, mmm—maybe',
      description: 'Rest on an even hum, then let it open into a small word without leaning either way.',
      cues: [
        'Keep the tongue mid and the hum even — neither pushed forward nor pulled back.',
        'Open mmm into "middle" with no bump — the word keeps the hum\'s balance.',
        'Small and even; quiet is exactly right for this one.',
      ],
      tags: ['vocalise', 'resonance', 'onset'],
      successCriteria: 'The word starts exactly where the hum was sitting — balanced, with no bump.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'sustained',
      tier: 'both',
      title: 'Steady vowel',
      focus: 'One vowel, held even at centre',
      phrase: 'ahh… ehh (steady holds)',
      description: 'Hold one easy vowel steady at your centre — same pitch, same size — then let it go.',
      cues: [
        'Pick ah or eh, start at your centre, and hold it even for a slow count of five.',
        'Keep the sound flat and centred — small wobbles are fine.',
        'If you try ee, go by ear and feel.',
      ],
      tags: ['vocalise', 'stability', 'pitch'],
      successCriteria: 'The hold stays even in pitch and size from start to finish.',
      contraindications: [],
      difficulty: 'easy',
    },
    {
      kind: 'resonance_play',
      tier: 'full',
      title: 'Small voice, big voice',
      focus: 'Feeling both ends, finding the middle',
      phrase: 'hello (small) … hello (big)',
      description: 'Say one word in your smallest comfortable voice, then in your biggest — then notice the middle between them.',
      cues: [
        'Same word twice: first tiny and close, then wide and roomy.',
        // 2026-07-26 homework law: was "find the middle on your own", which reads
        // as away-from-session self-study. The move is the same; it happens now.
        'Feel both ends, then find the middle between them right now — that middle is home.',
        'What counts is the difference between the two takes, not either one alone.',
      ],
      tags: ['vocalise', 'resonance'],
      successCriteria: 'The two takes land clearly apart — the change between them is what the coach listens for.',
      contraindications: ['do_not_use_if_strain'],
      difficulty: 'medium',
    },
    {
      kind: 'trill',
      tier: 'full',
      title: 'Lip trill release',
      focus: 'Loose, easy airflow',
      phrase: 'brrr… (lips) or rrr… (tongue)',
      description: 'Let the lips or tongue flutter on easy air — a private, full-voice loosener, guided by feel.',
      cues: [
        'Loose lips, easy air — let the flutter ride a gentle, centred tone.',
        'The right version usually feels like almost nothing — do not go hunting for a feeling.',
        'If trills will not come today, a gentle hum does the same job.',
      ],
      tags: ['vocalise', 'onset', 'private'],
      successCriteria: 'The flutter stays loose and steady on comfortable air — guided by feel.',
      contraindications: [],
      difficulty: 'medium',
    },
  ],
};

const VOCALISE_PRESET_LANES = {
  'cute-feminine': { prefix: 'cute', direction: 'feminine' },
  'everyday-feminine': { prefix: 'everyday', direction: 'feminine' },
  'bright-playful': { prefix: 'playful', direction: 'feminine' },
  'australian-bright-feminine': { prefix: 'aus-bright', direction: 'feminine' },
  'soft-feminine': { prefix: 'soft', direction: 'feminine' },
  // 'androgynous' (andro-*) and 'gender-neutral' (neutral-*) REMOVED 2026-07-30.
};

const VOCALISE_ID_SLUGS = {
  siren: 'siren',
  hum_sovt: 'hum',
  sustained: 'sustained',
  resonance_play: 'resonance-play',
  trill: 'trill',
};

for (const [presetKey, lane] of Object.entries(VOCALISE_PRESET_LANES)) {
  const pack = VOICE_DRILL_PACKS[presetKey];
  if (!Array.isArray(pack)) continue;
  for (const template of VOCALISE_DIRECTIONS[lane.direction]) {
    pack.push({
      ...template,
      id: `${lane.prefix}-vocalise-${VOCALISE_ID_SLUGS[template.kind]}`,
      cues: [...template.cues],
      tags: [...template.tags],
      contraindications: [...template.contraindications],
      needsNothing: true,
    });
  }
}

const CONCEPT_TAGS = {
  voice_pitch_center: ['pitch'],
  voice_target_zone_accuracy: ['stability', 'pitch', 'resonance'],
  voice_resonance_brightness: ['resonance'],
  voice_light_vocal_weight: ['weight', 'onset'],
  voice_playful_intonation: ['intonation', 'pitch'],
  voice_phrase_shape_matching: ['mimicry', 'intonation', 'stability'],
  voice_reference_matching: ['mimicry', 'reference'],
};

const KEYWORD_RULES = [
  { pattern: /\bpitch|higher|lower|sirens?|range|semitone|lift upward\b/i, tags: ['pitch'] },
  { pattern: /\bintonation|question|playful|sparkle|ending|rise|arc|melod/i, tags: ['intonation'] },
  { pattern: /\bresonance|bright|brightness|forward|ng|ee|dark/i, tags: ['resonance'] },
  { pattern: /\bweight|heavy|light|chest|mass|pressure/i, tags: ['weight'] },
  { pattern: /\bonset|breathy|entry|entries|attack/i, tags: ['onset'] },
  { pattern: /\breference|shadow|echo|match|mimic|mirror/i, tags: ['mimicry', 'reference'] },
  { pattern: /\bcontour|shape|shadowing|lane|path match|phrase match/i, tags: ['mimicry', 'intonation', 'stability'] },
  { pattern: /\bsteady|stable|hold|target zone|whole time|drift\b/i, tags: ['stability'] },
];

function cloneDrill(drill) {
  return {
    ...drill,
    cues: Array.isArray(drill.cues) ? [...drill.cues] : [],
    tags: Array.isArray(drill.tags) ? [...drill.tags] : [],
    successCriteria: drill.successCriteria || '',
    contraindications: Array.isArray(drill.contraindications) ? [...drill.contraindications] : [],
    difficulty: drill.difficulty || 'medium',
  };
}

// 2026-07-27 MTF-ONLY. What this function actually does, stated plainly because
// an earlier version of this comment claimed the OPPOSITE:
//
//   VOICE_DRILL_PACKS holds only the seven LIVE preset keys. Anything else —
//   a retired `masculine`/`masc-*`/`ftm` id, a typo, an unknown string — hits
//   the `|| VOICE_DRILL_PACKS['cute-feminine']` fallback below and gets the
//   cute-* drills. `getVoiceDrillPack('masculine')` is byte-identical to
//   `getVoiceDrillPack('cute-feminine')`.
//
// That is deliberate and is NOT a masculinizing lane: there is no resolver, no
// alias, no masc-shaped branch here, so a retired id is treated EXACTLY as any
// other unrecognised string — which is the property voice-retired-target-sweep
// pins. Keeping a retired id OUT of this function is the job of the boundaries
// that validate a target: the analyzer's `normalize_target_preset` (which
// raises, and which `get_target_profile` now also routes through) on session
// start / resume / finalize, and `updateVoiceSessionPreset`'s enum check on the
// write. Do not add a neutral shim here — that would BE special handling.
function getVoiceDrillPack(targetPreset = 'cute-feminine') {
  const pack = VOICE_DRILL_PACKS[targetPreset] || VOICE_DRILL_PACKS['cute-feminine'];
  return pack.map(cloneDrill);
}

function getVoiceDrillById(targetPreset = 'cute-feminine', lessonId = '') {
  if (!lessonId) return null;
  const match = getVoiceDrillPack(targetPreset).find((drill) => drill.id === lessonId);
  if (match) return match;

  for (const pack of Object.values(VOICE_DRILL_PACKS)) {
    const fallback = pack.find((drill) => drill.id === lessonId);
    if (fallback) return cloneDrill(fallback);
  }
  return null;
}

function collectRecommendationTags({ summary, studentModel } = {}) {
  const tags = new Set();
  const snippets = [];

  if (Array.isArray(summary?.issues)) snippets.push(...summary.issues);
  if (Array.isArray(summary?.nextDrills)) snippets.push(...summary.nextDrills);
  if (typeof summary?.transcript === 'string') snippets.push(summary.transcript);
  if (Array.isArray(studentModel?.struggles)) snippets.push(...studentModel.struggles);

  const conceptIds = [];
  if (Array.isArray(studentModel?.reviewQueue)) {
    for (const item of studentModel.reviewQueue) {
      if (item?.conceptId) conceptIds.push(String(item.conceptId));
      if (item?.name) snippets.push(String(item.name));
    }
  }
  if (Array.isArray(studentModel?.conceptIds)) {
    conceptIds.push(...studentModel.conceptIds.map((conceptId) => String(conceptId)));
  }

  for (const conceptId of conceptIds) {
    for (const tag of CONCEPT_TAGS[conceptId] || []) {
      tags.add(tag);
    }
  }

  for (const snippet of snippets) {
    const text = String(snippet || '');
    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(text)) {
        for (const tag of rule.tags) tags.add(tag);
      }
    }
  }

  return [...tags];
}

// 2026-07-26 (Defect 4): how hard a recently-prescribed drill is pushed down,
// indexed by how recently it was prescribed (0 = most recent). These are
// DELIBERATELY smaller than the tag-match boost (1.15) and the explicit
// selection boost (1.4): a drill the learner's own metrics call for, or one
// they picked themselves, must still be able to come back immediately. The
// penalties only outweigh the ordering tiebreak (0.01/position), which is what
// froze the recommendation into one fixed permutation forever.
const RECENTLY_PRESCRIBED_PENALTIES = Object.freeze([0.9, 0.6, 0.3]);
const RECENTLY_PRESCRIBED_MEMORY = RECENTLY_PRESCRIBED_PENALTIES.length;

function recommendVoiceDrillIds({
  targetPreset = 'cute-feminine',
  summary = null,
  studentModel = null,
  selectedLessonId = null,
  hasReference = false,
  // Drill ids prescribed on the previous call(s), most recent FIRST. Down-ranked,
  // never excluded — see RECENTLY_PRESCRIBED_PENALTIES.
  recentDrillIds = null,
} = {}) {
  const drills = getVoiceDrillPack(targetPreset);
  const recentIds = Array.isArray(recentDrillIds)
    ? recentDrillIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const recommendationTags = new Set(collectRecommendationTags({ summary, studentModel }));
  const rawTargetHitPct = summary?.metrics?.targetHitPct;
  const targetHitPct = rawTargetHitPct != null && Number.isFinite(Number(rawTargetHitPct))
    ? Math.max(0, Math.min(1, Number(rawTargetHitPct)))
    : null;
  if (rawTargetHitPct != null && targetHitPct === null) {
    console.warn(`[Voice] Invalid targetHitPct passed to recommendVoiceDrillIds for preset "${targetPreset}"`);
  }
  const scored = drills.map((drill, index) => {
    let score = 1 - (index * 0.01);

    if (!summary && drill.tags.includes('starter')) {
      score += 1.2;
    }

    if (selectedLessonId && drill.id === selectedLessonId) {
      score += 1.4;
    }

    for (const tag of drill.tags) {
      if (recommendationTags.has(tag)) {
        score += 1.15;
      }
    }

    if (hasReference && (drill.tags.includes('mimicry') || drill.tags.includes('reference'))) {
      score += 0.85;
    }

    if (targetHitPct !== null && targetHitPct >= 0.6 && drill.tags.includes('mimicry')) {
      score += 0.35;
    }

    const recency = recentIds.indexOf(drill.id);
    if (recency >= 0 && recency < RECENTLY_PRESCRIBED_PENALTIES.length) {
      score -= RECENTLY_PRESCRIBED_PENALTIES[recency];
    }

    return { id: drill.id, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, 3).map((entry) => entry.id);
}

/**
 * The preset keys that have a real pack. Exported so a caller can tell an
 * UNKNOWN preset from a known one — `getVoiceDrillPack` deliberately falls back
 * to cute-feminine so the tutor is never left with nothing, but that fallback
 * hands FEMININE cue copy to a learner whose target is neutral, which is the
 * wrong-lane defect class. Callers that would rather serve nothing than serve
 * the wrong register check this first.
 */
function listVoiceDrillPresetKeys() {
  return Object.keys(VOICE_DRILL_PACKS);
}

module.exports = {
  collectRecommendationTags,
  getVoiceDrillById,
  getVoiceDrillPack,
  listVoiceDrillPresetKeys,
  recommendVoiceDrillIds,
  RECENTLY_PRESCRIBED_MEMORY,
  RECENTLY_PRESCRIBED_PENALTIES,
};
