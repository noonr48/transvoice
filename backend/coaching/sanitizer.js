'use strict';

// 2026-08-16: wrong-direction safety is a deployable repository contract.
// This used to require a machine-local sibling checkout and silently became a
// no-op everywhere else. A sanitizer safety law must travel with the runtime.
const { stripCrossDirectionSentences } = require('./direction-safety');

const { resolvePreviousCueAction } = require('./previous-cue-actions');

/**
 * Sanitizer — post-processing for model output.
 *
 * Ensures the model's response respects policy constraints:
 * - No pitch mentions when avoidTopics includes 'pitch'
 * - No coaching in conversation mode when shouldCorrect=false
 * - No unsafe suggestions (pain, squeezing, etc.)
 * - No doNotSay phrases (v2): explicit phrases from the signal the model must avoid
 * - No gender framing in cues (v2): the model must use targetFit status, not labels
 *
 * v2 philosophy: the model is "best effort", the sanitizer is the contract.
 * If the model emits a doNotSay phrase, strip it; if stripping would empty the
 * reply, replace with a safe fallback.
 */

const UNSAFE_PATTERNS = [
  /\bpush through (?:the )?(?:pain|strain|fatigue|discomfort)\b/i,
  /\bforce (?:your )?(?:larynx|voice|throat|pitch)\b/i,
  /\bhold (?:your )?(?:larynx|throat|breath)\b/i,
  /\bswallow(?:ing)? (?:your )?(?:larynx|voice)\b/i,
  /\bwhisper(?:ing)? (to|for|as) (?:practice|training)\b/i,
  /\bsqueeze (?:your )?(?:throat|voice|larynx)\b/i,
];

const COACHING_ACTION_PATTERN = /\b(?:try|repeat|redo|record|sample|drill|practice|say it again|say that again|let's hear|next line|next pass|do it again|one more time)\b/i;
const VOICE_TERM_PATTERN = /\b(?:voice|pitch|resonance|vowel|vowels|weight|onset|phonation|intonation|prosody|articulation|bright|brighter|forward|forward sound)\b/i;
const PITCH_PATTERN = /\bpitch\b/i;

// v2: gender framing the model should never introduce as a label
const GENDER_LABEL_PATTERNS = [
  /\b(?:feminine|masculine|female|male|woman|man|girl|guy|girlvoice|guyvoice|girly|manly|ladylike)\b/gi,
];

// v2: phrases that should never appear in a coaching cue (e.g. clinical jargon)
const PROHIBITED_CUE_PATTERNS = [
  /\b(?:clinical|diagnosis|disorder|pathology|patient|therapy session)\b/gi,
];

// 2026-07-26: the canned fallbacks used to name a STATE with no action in it
// ("gentle and unforced"), so a stripped or non-actionable reply left the
// learner with nothing to do. Each fallback now names a physical action AND
// where in the line to make it, within the boundSpokenReply clamp
// (<= 2 sentences, <= 45 spoken words) and using only direction-neutral,
// safety-clean vocabulary.
// 2026-07-26: rewritten into the ARTICULATORY register (tongue / lips / jaw /
// soft palate). The 2026-07-26-morning versions already named an action, but no
// BODY PART — so a stripped reply still handed the learner an abstraction. Each
// fallback names an articulator, stays inside the boundSpokenReply clamp
// (<= 2 sentences, <= 45 spoken words), is direction-neutral, and avoids the
// `as if` / `like a` constructions IMAGERY_PATTERN strips under the
// concrete-over-imagery preference.
// 2026-07-28 beginner-language law: "the displayed line" is UI jargon — the
// learner may not be looking at a screen at all (EyesFree). The canonical plain
// form is "the practice sentence", and it must work with no screen in reach.
const SAFE_FALLBACK = 'Say the practice sentence with a loose jaw and easy lips, letting every word land as clearly as the first.';
const LOW_EFFORT_CUE = 'Let the jaw hang loose and start the next sound softly, keeping it level all the way through.';
const GENERIC_ACTIONABLE_CUE = 'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins.';
const ACTIONABLE_COACHING_ACTIONS = new Set(['coach', 'gentle', 'adapt']);
// 2026-07-26: 'spread' and 'round' are articulator verbs the new register needs.
// 'rest' was tried and REVERTED: it opened a hole in the learner-owns-session
// law. Measured — with 'rest' in this list, "You can rest the voice whenever you
// like.", "Take your time and rest your throat." and "Rest the voice now and
// pick it up later." all passed through VERBATIM, where before each was judged
// non-actionable and replaced. SESSION_CONTROL_PATTERNS does not cover those
// phrasings, so this list was the only thing catching them. Do not re-add 'rest'.
// 2026-07-26 (whole-body register): the verb list gains the POSTURAL actions the
// widened rubric teaches — drop/relax/soften/release/loosen/widen/lengthen/roll/
// feel/stand/plant/tuck/unlock/ease. Without them a body cue like "Feel the buzz
// in your chest as the line lands" names a real physical action and still fails
// this test, so resolveCoreLoopRepairReply throws it away and substitutes the
// generic cue. MEASURED before the change: 3 of 6 realistic body cues were
// destroyed with cause `missing_actionable_cue`.
// Still deliberately EXCLUDED: 'rest' (documented above — it reopens the
// learner-owns-session hole) and bare postural ADJECTIVES (soft/loose/tall/
// level). Admitting adjectives would make almost any sentence "actionable"
// ("that was easy", "nice and loose"), which is precisely the state-without-
// action failure the articulatory rubric was written to fix.
// 2026-07-27: `make`/`aim` added. MEASURED gap — "Make the sound more silvery
// as you go up." and "Aim for a lighter voice." matched NO verb here, so they
// were not recognised as instructions and the cue-shape law could not reach
// them. Widening this pattern can only make a reply MORE likely to be judged
// actionable, so it cannot newly destroy a real cue.
const POSTURAL_ACTION_PATTERN = /\b(?:try|use|keep|let|bring|move|hold|start|begin|add|reduce|lighten|brighten|darken|open|close|focus|give|carry|say|speak|hum|trill|lift|lower|raise|settle|spread|round|place|drop|relax|soften|release|loosen|widen|lengthen|roll|feel|stand|plant|tuck|unlock|ease|make|aim)\b/i;
// The one verbless form that IS a real instruction: a body part named with the
// posture it should take ("shoulders soft and away from your ears" — attested 19x
// in the training corpus, so the model will emit it). Kept tight on purpose: the
// body noun and the posture word must be ADJACENT, so "your pitch level was fine"
// and "that was easy" cannot match.
const POSTURAL_SETUP_PATTERN = /\b(?:shoulders?|neck|jaw|chin|chest|spine|posture|head|knees?)\s+(?:stay(?:s|ing)?\s+|sit(?:s|ting)?\s+|hang(?:s|ing)?\s+)?(?:soft|softer|loose|looser|level|tall|long|longer|open|easy|down|wide|back|released|relaxed)\b/i;
const ACTIONABLE_CUE_PATTERN = new RegExp(
  `${POSTURAL_ACTION_PATTERN.source}|${POSTURAL_SETUP_PATTERN.source}`,
  'i',
);
// 2026-07-26: the articulator nouns are LOAD-BEARING here, not decoration. This
// pattern is the test for "did the reply contain a usable voice action".
// MEASURED before the change: of three realistic articulatory replies, one
// ("Spread your lips slightly into the start of a smile, and keep the tongue
// high and forward") matched NO term and was replaced by the generic fallback;
// the other two survived only incidentally, because they happened to also say
// "sound"/"word"/"line". So the hole was real but partial: an articulatory cue
// that does not also name sound/word/line/tone got destroyed. Whether a good
// cue survived was luck of phrasing, which is not a contract.
// Adding tongue/lips/jaw/mouth/palate/teeth keeps the register change
// alive at runtime instead of silently undoing it. Deliberately NOT added:
// 'smile' and 'buzz' — every code-owned string that uses them also names a real
// articulator, so they buy nothing, and both appear in ordinary conversational
// speech ("that made me smile"), where a false "this is an actionable cue"
// would mis-split acknowledgment from cue in applyPreferenceContract.
// 2026-07-26 (whole-body register): the owner widened the practical instruction
// space from the mouth to the WHOLE BODY — posture and physical actions that move
// the voice toward the goal. The body nouns are therefore load-bearing here for
// exactly the reason the articulator nouns were: MEASURED, "Place a hand on your
// chest and feel the buzz while you say it" named NO term in the old list and was
// destroyed at runtime, as was "Shoulders soft and away from your ears".
// Body parts are safe additions in a way 'buzz'/'smile' were not: they do not
// appear as praise or as ordinary conversational filler, so they cannot cause the
// applyPreferenceContract split to mistake an acknowledgment for a cue.
// 2026-07-27 CUE VOCABULARY — ONE list, two consumers. Before this change the
// body nouns lived only inside ACTIONABLE_VOICE_PATTERN's literal alternation,
// so the cue-shape law (PRODUCT LAW 5 below) would have needed a second copy of
// them. Splitting the alternation into named arrays and rebuilding the pattern
// from their union means there is exactly one place to add a body part, and the
// two laws cannot drift apart about what a body referent is.
//
// BODY_PART_TERMS is the gross-landmark set only. The atlas is explicit that
// fine laryngeal landmark palpation is unreliable on feminine necks (69.4% vs
// 19.4% correct identification), so `cricothyroid`/`thyroarytenoid` are NOT
// body referents here — they are banned outright by CUE_VOCABULARY_RULES.
const BODY_PART_TERMS = [
  'larynx', 'voice box', 'throat', 'tongue', 'lip', 'lips', 'jaw', 'mouth',
  'palate', 'teeth', 'tooth', 'molar', 'molars', 'gum', 'gums', 'ridge',
  'roof', 'nose', 'nostril', 'nostrils', 'face', 'cheek', 'cheeks',
  'cheekbone', 'cheekbones', 'skull', 'shoulder', 'shoulders', 'neck', 'chin',
  'chest', 'sternum', 'breastbone', 'head', 'body', 'posture', 'hand', 'hands',
  'palm', 'palms', 'finger', 'fingers', 'fingertip', 'fingertips', 'corner',
  'corners', 'rib', 'ribs', 'spine', 'waist', 'belly', 'navel', 'ear', 'ears',
  'knee', 'knees', 'cartilage',
];
// The sound QUALITIES the coach may name but which are NOT body referents. A
// coaching sentence carrying only these is exactly the failure the owner named:
// "telling the user to just use a 'brighter' voice as that tells us nothing".
// This array — and only this array — gates the cue-shape law.
const VOICE_QUALITY_TERMS = [
  'voice', 'sound', 'tone', 'pitch', 'resonance', 'vowel', 'vowels', 'weight',
  'onset', 'phonation', 'intonation', 'prosody', 'articulation', 'timbre',
  'range', 'quality',
];
// Session OBJECTS: the things a turn is about, not qualities of the sound.
// Split out of the quality list for a MEASURED reason — while `line`, `word`
// and `phrase` gated the cue-shape law, three ordinary non-technique sentences
// were destroyed at runtime: "Give me the line whenever you like."
// (voice-coach-take-leg), "Summarize what changed and pick one focus for the
// next line." (reflection_summary) and the fewer-corrections acknowledgment
// split. None of them claims anything about how the voice should sound, so none
// of them owes the learner a body referent.
const VOICE_OBJECT_TERMS = [
  'breath', 'closure', 'hum', 'trill', 'line', 'phrase', 'word', 'ending',
  'rate',
];
const VOICE_ABSTRACT_TERMS = [...VOICE_QUALITY_TERMS, ...VOICE_OBJECT_TERMS];
// Spec §1: an ACTION is "a body part + what it does (or an imitation task the
// body can just perform)". These are the imitation tasks — movements the body
// executes without needing a part named. MEASURED against all 27 approved
// phrasings in the cue-vocabulary spec §4: 8 of them ("Slide the tone up in one
// unbroken line", "Hold an 'mmm', then open into a vowel without changing
// effort", "Make that buzz weaker without getting quieter", …) name no body
// part at all, so a body-parts-only vocabulary destroys them. With the movement
// and sensation arrays included, 0 of 27 false-fire.
// Deliberately EXCLUDED: 'rest'. It is excluded from POSTURAL_ACTION_PATTERN
// above for a measured reason (it reopens the learner-owns-session hole), and
// admitting it here would let "Rest the voice now" satisfy the cue-shape law.
const MOVEMENT_TERMS = [
  'slide', 'slides', 'sliding', 'glide', 'glides', 'gliding', 'step', 'steps',
  'lift', 'lifts', 'lifting', 'lower', 'lowers', 'raise', 'raises', 'press',
  'presses', 'pressing', 'push', 'pushes', 'pushing', 'draw', 'draws', 'pull',
  'pulls', 'hold', 'holds', 'holding', 'open', 'opens', 'close', 'closes',
  'spread', 'spreads', 'round', 'rounds', 'rounding', 'pinch', 'pinches',
  'tuck', 'nod', 'place', 'places', 'touch', 'touches', 'hang', 'hangs',
  'drop', 'drops', 'widen', 'narrow', 'shorten', 'lengthen', 'flatten',
  'curl', 'arch', 'tilt', 'ride', 'rides', 'travel', 'travels', 'pant',
  'yawn', 'swallow', 'blow', 'flutter', 'float', 'settle', 'settles',
  'relax', 'soften', 'release', 'loosen', 'roll', 'stand', 'plant', 'unlock',
  'ease', 'breathe', 'inhale', 'exhale', 'bend', 'curve', 'sit', 'sits',
  'start', 'starts', 'begin', 'stop', 'move', 'moves', 'moving',
];
// The sensations the seven valid checks actually read (spec §3). These are
// body referents in the owner's sense — "what a sensation is meant to feel
// like" — so a cue that names one has told the learner something checkable.
// `temperature` is here because the cool, fast airstream on the ridge behind
// the top teeth IS spec §3 signal 2 — it passes the validity test (the
// sensation is caused by the variable being trained: where the tract's
// narrowest point is), so naming it plainly is legal.
//
// This array is ALSO what keeps the cue-shape law off the emotional/identity
// failure modes, which have no physical answer and must not be forced into a
// body cue. MEASURED across six realistic identity replies ("Take the pressure
// off the sound entirely", "It costs effort now because it is new, not because
// it is not you"): 0 of 6 fire, because `pressure`, `effort` and `tension` are
// exactly the words that register speaks in. Removing them would make the law
// demand a body cue where none applies.
const SENSATION_TERMS = [
  'buzz', 'buzzing', 'vibration', 'vibrations', 'contact', 'flutter',
  'crackle', 'click', 'puff', 'air', 'airstream', 'cool', 'cooler', 'coolest',
  'pressure', 'temperature', 'tingle', 'ache', 'aches', 'burn', 'burns', 'effort', 'tension',
  'firmness', 'stretch', 'texture', 'rumble', 'scratch',
];

function buildTermPattern(...termGroups) {
  const terms = [...new Set(termGroups.flat())]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  return new RegExp(`\\b(?:${terms.join('|')})\\b`, 'i');
}

// Rebuilt from the arrays above. MEASURED: the generated alternation is a
// superset of the hand-written one it replaces — every term of the 2026-07-26
// list is still present, plus the atlas landmarks the seven valid checks name
// (breastbone, nostril, molar, fingertip, corner, ridge, cheekbone, navel).
// Widening this pattern can only make a reply MORE likely to be judged
// actionable, never less, so it cannot newly destroy a real cue.
const ACTIONABLE_VOICE_PATTERN = buildTermPattern(BODY_PART_TERMS, VOICE_ABSTRACT_TERMS);
// The cue-shape law's positive vocabulary: body part OR imitation movement OR
// checkable sensation. Kept structural on purpose — spec §6 warns that a second
// banned-word list "will fail open on new phrasings", and a new metaphor the
// model invents next month still will not contain any of these terms.
const CUE_BODY_REFERENT_PATTERN = buildTermPattern(BODY_PART_TERMS, MOVEMENT_TERMS, SENSATION_TERMS);
// Claims something about how the voice sounds — the gate half of the cue-shape
// test. Quality terms only; see VOICE_OBJECT_TERMS for what was excluded and why.
const VOICE_QUALITY_PATTERN = buildTermPattern(VOICE_QUALITY_TERMS);
const VOICE_ABSTRACT_PATTERN = buildTermPattern(VOICE_ABSTRACT_TERMS);
// The app's OWN surface. A sentence about the microphone, the capture or the
// on-screen graph is operational speech, not voice technique, so the cue-shape
// law does not ask it for a body referent. MEASURED: without this exemption the
// capture-repair cue "Try that once more a little closer to the mic with a
// clear, steady voice." was replaced by the generic cue at runtime, which loses
// the one fact the learner needed (mic distance). Deliberately NOT an equipment
// hole: every term here names a surface the learner already has open, and
// EQUIPMENT_RULES still fires on anything they would have to go and get.
// MEASURED and narrowed on 2026-07-27: the first draft also listed `start`,
// `end`, `take` and `session`. Those are ordinary cue words, not app surfaces —
// "Let the tone be sweeter at the end." was exempted by `end` and escaped the
// cue-shape law completely. Every term below names a surface and nothing else.
// 2026-07-28: `displayed` REMOVED. Its only live use was the jargon "displayed
// line", and its presence here shielded exactly that phrase from the cue-shape
// law. (The phrase is now rewritten by BANNED_VOCAB_RULES on sight, and no
// code-owned string may say it — the learner may be in EyesFree, with no screen
// in reach at all.)
const APP_SURFACE_PATTERN = /\b(?:mic|microphone|recording|capture|captured|graph|dot|lane|screen|replay|playback|button)\b/i;

function cueForDueReview(focus) {
  const normalized = String(focus || '').trim().toLowerCase();
  if (!normalized) return '';
  // 2026-07-26 DIRECTION LAW: these cues are keyed off a PERSISTED review-queue
  // label, not off measured deviation from the learner's target, so nothing
  // downstream makes them direction-aware. They MUST therefore be
  // direction-NEUTRAL. Measured: an earlier rewrite said "let the pitch of the
  // last two words step up a little" — a rising ending is a feminizing device,
  // so the cross-direction stripper deleted the whole sentence for a
  // masculinizing learner and the turn collapsed to a bare "I hear you." with no
  // action at all (measured before the 2026-07-26 MTF-only cut; the law is kept
  // because the stripper still runs and a NEUTRAL-target learner still must not
  // be pushed either way). "A clear pitch change" is the direction-neutral form. Each
  // cue also still names its review axis, because the renderer directive asks
  // the reply to name the review focus — in PLAIN words (2026-07-28), so the
  // axis names below are glossed, never spoken raw: "pitch floor" is how low
  // the voice dips, "resonance" is how the mouth shapes the sound, "vocal
  // weight" is how heavy or rumbly the sound is, "intonation" is the melody.
  if (normalized.includes('intonation')) return 'Give one word in the practice sentence a clear pitch change up or down — that is the melody — letting the lips and jaw finish the word.';
  if (normalized.includes('pitch floor')) return 'Start the practice sentence on a small "mm" hum, then open the jaw into the words, and keep how low your voice dips right where the hum put it.';
  if (normalized.includes('resonance')) return 'Hold one tongue and lip shape for the whole practice sentence, so the sound stays matched to the selected voice.';
  // 2026-07-26: the focus axis was renamed breath_flow -> tone_clarity, so match
  // BOTH the new vocabulary and the legacy 'breath*' labels already persisted in
  // learner review queues. The RETURNED cue is the closure action in every case:
  // the metric behind this axis is glottal closure, never breathing.
  if (
    normalized.includes('tone_clarity')
    || normalized.includes('tone clarity')
    || normalized.includes('closure')
    || normalized.includes('breath')
  ) {
    return 'Start the first word with a tiny, gentle "uh" — the small catch just before a cough — then keep that clean contact.';
  }
  // 'Match the vocal weight …' (the wording at 90ab6f5 and in the first pass of
  // this rewrite) matched NO verb in ACTIONABLE_CUE_PATTERN, so the core-loop
  // repair judged its own cue non-actionable and replaced it with the generic
  // one — a pre-existing defect, fixed here by leading with 'Keep'.
  // 2026-07-28: the axis is named by its felt check (a chest buzz is the valid
  // weight signal), never by the identifier "vocal weight".
  if (normalized.includes('weight')) return 'Keep the jaw at one openness across the whole practice sentence, so the buzz you feel in your chest matches the selected voice.';
  if (normalized.includes('pronunciation')) return 'Say each word the way you heard it, letting the lips and tongue make each shape fully.';
  // The due-review label is persisted learner data, not trusted executable
  // wording. Unknown labels must never be interpolated back into spoken output.
  return GENERIC_ACTIONABLE_CUE;
}

// ---------------------------------------------------------------------------
// 2026-07-28 META-QUESTION RESPONDER. The beginner asks ABOUT the practice
// sentence — "what is the practice sentence?", "what do I say?", "repeat the
// sentence", "read it to me" — and the coach must ANSWER, never coach. (The
// provocation: the tutor said "say the practice sentence slowly", the owner
// asked what the practice sentence IS, the turn was classified 'coach', and
// core-loop repair destroyed the answer.) Detection lives HERE, off
// signal.userUtterance, not in policy-gates: the sanitizer sees every turn
// however policy classified it, so the answer cannot be routed away by the
// take-bearing-turn rules. The reply flows through the normal law pipeline —
// the quoted line can be model-authored via card-ops, so it re-crosses every
// law like any other text — and resolveCoreLoopRepairReply is exempted from
// judging it (it runs the same detector).
// ---------------------------------------------------------------------------

const PRACTICE_LINE_QUESTION_PATTERNS = [
  /\bwhat(?:'s| is| was)\s+(?:the\s+)?(?:practice\s+)?(?:sentence|line)\b/i,
  /\bwhat\s+(?:do|should|can|could)\s+i\s+(?:say|read|speak|repeat)\b(?:\s+(?:now|here|next|again))?\s*[.?!]?\s*$/i,
  /\bwhat\s+am\s+i\s+supposed\s+to\s+(?:say|do|read|speak)\b(?:\s+(?:now|here|next|again))?\s*[.?!]?\s*$/i,
  /\b(?:repeat|say|tell|read)\s+(?:me\s+)?(?:the\s+)?(?:practice\s+)?(?:sentence|line)\b/i,
  /\bread\s+(?:it|that)\s+(?:to|for)\s+me\b/i,
  /\bcan\s+you\s+(?:say|read|repeat)\s+(?:the\s+)?(?:practice\s+)?(?:sentence|line)\b/i,
  /\bcan\s+you\s+say\s+it(?:\s+(?:for|to)\s+me)?\s*[.?]?\s*$/i,
];
// "Say that again" about the TUTOR's own speech (not the sentence) — answered
// by re-speaking the last coach message verbatim.
const TUTOR_REPEAT_PATTERNS = [
  /\b(?:say|repeat)\s+that\s+again\b/i,
  /\bwhat\s+did\s+you\s+say\b/i,
  /\bcan\s+you\s+repeat(?:\s+yourself)?\s*[.?]?\s*$/i,
];

const PRACTICE_LINE_QUOTE_MAX = 60;

function quotePracticeLine(signal) {
  let line = typeof signal?.practiceLine === 'string'
    ? signal.practiceLine.replace(/\s+/g, ' ').trim()
    : '';
  if (!line) return '';
  // 2026-07-28: the line can be MODEL-AUTHORED via card-ops, so it is cleaned
  // before it is ever quoted into speech. Ops fences are stripped first (a
  // malformed block must never reach TTS — the same fence-presence rule as
  // sanitizeCoachReply step 0), then the banned-vocabulary rewrite applies,
  // and a line that still trips the beginner-jargon sentence law is REFUSED
  // (no quote at all) rather than spoken raw.
  line = line.replace(/```+\s*(?:remember-ops|card-ops)[\s\S]*$/i, '').trim();
  line = sanitizeBannedVocabulary(line).text;
  if (BEGINNER_JARGON_RULES.some((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(line);
  })) {
    return '';
  }
  // Sentence punctuation is stripped from the quote: boundSpokenReply splits on
  // [.!?] and would otherwise detach the closing quote mark into its own
  // "sentence" ('…today? ".'). The words are unchanged; the spoken pauses come
  // from the surrounding sentence.
  const spoken = line.replace(/[.!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spoken.length > PRACTICE_LINE_QUOTE_MAX
    ? `${spoken.slice(0, PRACTICE_LINE_QUOTE_MAX).trimEnd()}…`
    : spoken;
}

// Splice the actual sentence into a code-owned cue as a colon-quote:
// 'Say the practice sentence slowly: "<line>".' The static exports stay the
// no-line case (tests pin them); the quote is capped so the one-sentence form
// stays inside the 45-spoken-word clamp, and the colon form keeps the cue
// actionable ('say' + 'words') so it survives the final law pass.
function cueWithLine(base, signal) {
  const quote = quotePracticeLine(signal);
  if (!quote) return base;
  const root = String(base || '').replace(/[.!?]\s*$/, '');
  return `${root}: "${quote}".`;
}

function resolvePracticeLineAnswer(signal) {
  const utterance = typeof signal?.userUtterance === 'string' ? signal.userUtterance.trim() : '';
  if (!utterance) return null;
  const quote = quotePracticeLine(signal);
  if (quote && PRACTICE_LINE_QUESTION_PATTERNS.some((pattern) => pattern.test(utterance))) {
    return { cause: 'practice_line_question', reply: `Say these words with me: "${quote}".` };
  }
  const lastCoachMessage = typeof signal?.lastCoachMessage === 'string'
    ? signal.lastCoachMessage.trim()
    : '';
  if (lastCoachMessage && TUTOR_REPEAT_PATTERNS.some((pattern) => pattern.test(utterance))) {
    return { cause: 'repeat_tutor', reply: lastCoachMessage };
  }
  return null;
}

// 2026-07-26: the coach must NEVER address the learner by name. Dropping the
// Name line from the memo was necessary but NOT sufficient — a name still
// reaches the prompt through the practice line ("Hi, I'm <Name> — nice to meet
// you.", a legitimate self-introduction exercise) and through model-authored
// memo free text ("What worked: <Name> kept the tongue forward", "Recent
// moments: <Name> got gendered right"). MEASURED: with realistic memory data,
// 2 name-bearing lines still reach the model. The fine-tune uses a name
// whenever it sees one, so the system-prompt prohibition is best-effort; this
// is the contract.
//
// Deliberately narrow, to protect learners whose name is an ordinary word
// (Grace, Will, May, Hope, Faith):
//   - VOCATIVE POSITION ONLY (after a comma, or before one at a sentence head),
//     never a bare mention;
//   - CASE-SENSITIVE on the stored capitalization, so "Take it with grace,
//     Grace." loses only the address;
//   - "Will you keep the jaw loose?" is untouched (no comma).
function stripLearnerVocative(reply, signal) {
  const text = String(reply || '');
  const raw = String(signal?.personalization?.learnerMemoFields?.displayName || '').trim().slice(0, 80);
  if (!raw || !text) return text;
  // ONLY the capitalized form is ever matched. displayName is stored raw —
  // learner-context-service normalizeText only trims and slices, it never
  // capitalizes — so a learner who types "grace" is stored as "grace". Matching
  // the stored casing put the lowercase token in the match set and mangled
  // ordinary coach speech: "take it with grace, then let the line settle" ->
  // "take it with, then let the line settle" (measured, 10/10 lowercase
  // name-words corrupted: hope, will, grace, rose, mark, faith, sunny, art,
  // ray, bill). A vocative from a language model is capitalized in practice, so
  // this costs a missed address only for a deliberately lowercase-styled name —
  // far cheaper than corrupting the coach's speech for everyone else.
  const capitalizeWords = (s) => s.replace(/(^|\s)(\p{Ll})/gu, (m, pre, ch) => pre + ch.toUpperCase());
  const variants = new Set();
  for (const token of [raw, raw.split(/\s+/)[0]]) {
    const t = String(token || '').trim();
    // Internal spaces are allowed so a full name ("Ana Maria") is matchable too;
    // anything with other punctuation is refused and never reaches new RegExp.
    if (t.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u.test(t)) continue;
    variants.add(capitalizeWords(t));
  }
  if (!variants.size) return text;
  const NOT_NAME_CHAR = "(?![\\p{L}\\p{M}'’-])";
  let out = text;
  let removedSomething = false;
  // Bounded fixpoint: one replace() pass is non-overlapping, so a doubled
  // address ("Robin, Robin, keep …") would leave the second one behind — after
  // the first match is consumed the second is no longer at a sentence head.
  // Three passes is far more than any real reply needs and cannot loop.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = out;
    out = stripVocativeOnce(out, variants, NOT_NAME_CHAR);
    if (out === before) break;
    removedSomething = true;
  }
  // Cleanup and re-capitalization repair damage this function caused; running
  // them when nothing was removed edits the coach's own wording ("Try e.g. the
  // hum first." -> "Try e.g. The hum first.").
  if (!removedSomething) return text;
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  // A removed leading vocative leaves the next word lowercase.
  out = out.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, pre, ch) => pre + ch.toUpperCase());
  // Never let the guard empty the reply.
  return out.length >= 2 ? out : text;
}

function stripVocativeOnce(text, variants, NOT_NAME_CHAR) {
  let out = text;
  for (const name of variants) {
    // Escape regex metacharacters FIRST, then make the two apostrophe forms
    // interchangeable: a name stored as O'Brien must still be caught when the
    // model writes O’Brien, which language models do routinely.
    const n = name
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/['’]/g, "['’]");
    out = out
      // ORDER MATTERS. The sentence-head form runs FIRST: it is the only rule
      // that also consumes the comma AFTER the name. If the trailing rule ran
      // first it would match the leading " Robin" (because a comma follows it)
      // and strip the name while orphaning that comma — measured on
      // "I hear you, Ann. Ann, keep the jaw loose." -> "I hear you., keep …".
      // "Robin, keep the jaw loose." at the head of a sentence
      .replace(new RegExp(`(^|[.!?]\\s+)${n}${NOT_NAME_CHAR}\\s*,\\s*`, 'gu'), '$1')
      // "…, Robin — …" (an em dash follows the address). Emits a SPACE, not the
      // empty string: the match eats the whitespace on both sides of the name,
      // which would otherwise weld the dash onto the previous word ("one— keep").
      .replace(new RegExp(`[,\\s]+${n}${NOT_NAME_CHAR}\\s*(?=[—–])`, 'gu'), ' ')
      // "…, Robin." / "…, Robin!" / "…, Robin, and …" at a clause or sentence end
      .replace(new RegExp(`[,\\s]+${n}${NOT_NAME_CHAR}\\s*(?=[.!?,;:]|$)`, 'gu'), '');
  }
  // Replacements ONLY. Cleanup, re-capitalization and the never-empty guard all
  // belong to the caller — doing them here would make every pass differ from
  // its input and defeat the fixpoint's stability check.
  return out;
}

function resolveCoreLoopRepairReply(reply, signal) {
  const action = String(signal?.policy?.coachingAction || '').trim().toLowerCase();
  if (!ACTIONABLE_COACHING_ACTIONS.has(action) || signal?.policy?.shouldCorrect !== true) {
    return null;
  }
  // 2026-07-28: a learner asking ABOUT the practice line (or for a repeat) is
  // answered deterministically at the top of sanitizeCoachReply. That answer
  // is never judged for an executable voice action — destroying it was the
  // "what is the practice sentence?" bug (the answer was replaced with the
  // exact canned line that provoked the question).
  if (resolvePracticeLineAnswer(signal)) return null;
  const text = String(reply || '');
  if (ACTIONABLE_CUE_PATTERN.test(text) && ACTIONABLE_VOICE_PATTERN.test(text)) {
    return null;
  }

  const dueCue = cueForDueReview(signal?.personalization?.dueReviewFocus);
  // recommendedDrill/coachMove wording can originate in model or imported
  // state. Core-loop repair happens after the safety filters, so it may only
  // insert this finite, code-owned cue vocabulary. 2026-07-28: the learner
  // hears the ACTUAL sentence in the fallback whenever one exists.
  const cue = cueWithLine(dueCue || GENERIC_ACTIONABLE_CUE, signal);
  if (action !== 'gentle') {
    return { cause: 'missing_actionable_cue', reply: cue };
  }
  // 2026-07-26: the acknowledgment is ALWAYS name-free. It previously
  // interpolated a validated learnerMemoFields.displayName ("I hear you,
  // Robin."); the coach must never address the learner by name, so the whole
  // name-validation branch is gone. learnerMemoFields.displayName is still READ
  // in this file — by stripLearnerVocative above, which is the deterministic
  // guarantee that the name is never SPOKEN. The field is therefore
  // load-bearing for the no-name contract: do not drop it from the signal.
  const acknowledgment = 'I hear you.';
  return { cause: 'missing_actionable_cue', reply: `${acknowledgment} ${cue}` };
}

// The learner owns session lifetime through the single Start/Stop control. The
// speaking coach may reduce vocal effort, but must not decide or suggest when a
// lesson ends. These patterns are intentionally narrow so safety wording such
// as "do not push" remains intact.
const SESSION_CONTROL_PATTERNS = [
  /\b(?:start|begin|do|try)(?:ing)? (?:with )?(?:a |the )?(?:quick |short |gentle )?warm[\s-]?up\b/i,
  /\bwarm[\s-]?up (?:first|before|to start|to begin)\b/i,
  /\b(?:let'?s\s+)?(?:start|begin)\s+with\s+(?:an?\s+|some\s+)?(?:lip trills?|hums?|sirens?|glides?|stretches?|breathing(?: exercises?)?)\s+before\s+(?:the\s+)?(?:lesson|session|practice)\b/i,
  /\bgood place to stop\b/i,
  /\b(?:that(?:'s| is)|this is) enough for (?:today|now)\b/i,
  /\bcall it a day\b/i,
  /\b(?:let'?s|we(?:'ll| will)|i(?:'ll| will))\s+(?:close|finish|wrap up)\b/i,
  /\b(?:let'?s|we can|we(?:'ll| will))\s+pick (?:this|it) up\s+(?:later|tomorrow|next time)\b/i,
  /\b(?:that(?:'s| is)|we(?:'re| are))\s+(?:done|finished)\s+for\s+(?:today|now)\b/i,
  /\b(?:take|have) (?:a |some )?(?:short )?(?:break|rest)\b/i,
  /\btake (?:a )?(?:moment|minute) to rest\b/i,
  /\brest (?:first|before|for a while)\b/i,
  /\b(?:stop|pause|end) (?:the )?(?:practice|session|lesson|for today)\b/i,
  /\b(?:you can|you may|feel free to) stop\b/i,
  /\bcome back (?:later|when)\b/i,
  /\breturn (?:later|when)\b/i,
  /\b(?:text|message|chat) (?:me|back|with me|your reply|your response)\b/i,
  /\b(?:type|write) (?:your|a) (?:reply|response|message)\b/i,
  /\b(?:send|submit|post|enter)\s+(?:me\s+)?(?:your|a|the)\s+(?:answer|reply|response|message)(?:\s+(?:in|into|through)\s+(?:the|a)\s+(?:box|field|chat|composer))?\b/i,
  /\b(?:use|open) (?:the |a )?(?:text |message )?(?:chat|composer)\b/i,
];

// A renderer invitation must leave the learner free to stop. These categorical
// rules catch the common imperative/question forms without retaining learner or
// model text in telemetry.
const REP_PRESSURE_RULES = [
  {
    code: 'imperative_one_more',
    pattern: /\b(?:(?:let(?:'s| us)|please)\s+)?(?:try|take|do|give(?:\s+me)?|record|say|read|hear|send)\s+(?:(?:it|that|the line)\s+)?(?:just\s+)?one more(?:\s+(?:time|take|pass|line|go|rep|for me))?\b/gi,
  },
  {
    code: 'requested_one_more',
    pattern: /\b(?:i|we)\s+(?:want|need|would like)\s+(?:to\s+hear\s+)?(?:just\s+)?one more(?:\s+(?:time|take|pass|line|go|rep|for me))?\b/gi,
  },
  {
    code: 'just_one_more',
    pattern: /\bjust\s+one more(?:\s+(?:time|take|pass|line|go|rep|for me))?\b/gi,
  },
  {
    code: 'one_more_question',
    pattern: /\bone more(?:\s+(?:time|take|pass|line|go|rep|for me))?\s*\?/gi,
  },
];

// ---------------------------------------------------------------------------
// 2026-07-26 PRODUCT LAW 1 — HOMEWORK. Owner-directed, verbatim intent: "the
// tutor never tells the user to go away to practice". ALL practice happens
// RIGHT NOW, in this session, step by step with the tutor. A reply proposing
// away-from-session practice ("practise this at home", "keep at it daily",
// "we'll pick it up tomorrow") is not a softer version of coaching — it is the
// thing that makes the learner close the app.
//
// Detector shape (mirrors SESSION_CONTROL_PATTERNS): narrow, sentence-level,
// word-boundary, case-insensitive. Deliberate NON-firing cases:
//   - bare "later"  -> "a little later in the line" is ordinary placement
//     language, so `later` alone is NEVER a rule; only "later today/tonight/
//     this week/on" and "practise ... later" frames fire.
//   - bare "next time" -> "next time through the line" is the next REP, in
//     session. It fires only inside a defer frame ("save that for next time").
//   - bare "on your own" -> "find the middle on your own" is an in-session
//     self-discovery cue (voice-drills.js "Small voice, big voice"). It fires
//     only with a practice verb in the same sentence.
// ---------------------------------------------------------------------------

const HOMEWORK_RULES = [
  {
    // "practise this at home" / "work on it on your own" / "run it by yourself"
    code: 'practice_away',
    pattern: /\b(?:practi[cs]e|practi[cs]ing|work on|working on|run|rehearse|drill|repeat|try)\b[^.!?]{0,48}?\b(?:at home|on your own|by yourself|in your own time|outside (?:of )?(?:our |the |these )?sessions?|between (?:our |the )?sessions?|when you (?:have|get) (?:a )?(?:time|chance|moment))\b/i,
  },
  {
    // The away-place / away-window phrases that carry no in-session reading.
    code: 'away_from_session',
    pattern: /\b(?:at home|in your own time|between (?:our |the )?sessions?|outside (?:of )?(?:our |the |these )?sessions?|during the week|over the (?:week|weekend)|away from (?:here|the app|our sessions?))\b/i,
  },
  {
    // Recurring-routine framing: a schedule is by definition not "right now".
    code: 'daily_routine',
    // The `routine` arm needs a determiner/possessive in front so the ADJECTIVE
    // sense ("a routine check") cannot fire; "your morning routine", "a daily
    // routine" and "the routine" all do.
    pattern: /\b(?:every day|each day|daily|nightly|a few times a (?:day|week)|(?:twice|two|three|2|3) times a (?:day|week)|throughout the (?:day|week))\b|\b(?:your|a|the|this|that|my|our)\s+(?:daily\s+|morning\s+|evening\s+|nightly\s+|practice\s+|warm[\s-]?up\s+)*routines?\b|\bmake (?:it|this) (?:a|part of your) (?:daily |morning |evening )?(?:habit|routine)\b/i,
  },
  {
    // "keep practising this week" / "keep at it tomorrow" — a practice verb
    // pointed at a future window (either word order).
    code: 'keep_practicing_future',
    pattern: /\b(?:keep|carry on|continue|stick with)\b[^.!?]{0,32}?\b(?:practi[cs]ing|working|going|at it)\b[^.!?]{0,32}?\b(?:this week|next week|tomorrow|later (?:today|tonight|this week|on)|each day|every day|daily)\b|\b(?:this week|next week|tomorrow|each day|every day|daily)\b[^.!?]{0,32}?\b(?:keep|carry on|continue)\b[^.!?]{0,24}?\b(?:practi[cs]ing|working|at it)\b/i,
  },
  {
    // Deferral: parking the work in a future session instead of doing it now.
    code: 'defer_to_future',
    pattern: /\b(?:save|leave|park|hold|revisit|come back to|pick (?:this|it|that) up|we(?:'ll| will) (?:do|try|work on) (?:this|it|that))\b[^.!?]{0,32}?\b(?:for |until |on )?(?:next time|next session|next week|tomorrow|another day|later (?:today|tonight|this week|on))\b/i,
  },
  {
    // Explicit future-session/return framing.
    code: 'future_session',
    pattern: /\b(?:come back|check back|see you)\s+(?:tomorrow|next (?:time|week|session)|in a (?:day|week|few days))\b|\bbefore (?:our |the |your )?next session\b|\b(?:tomorrow|next session)'?s? (?:practice|session|warm[\s-]?up)\b/i,
  },
  {
    // Homework by name.
    code: 'homework_noun',
    pattern: /\bhome ?work\b|\bassignment\b|\bpractice plan for (?:the |this |next )?week\b|\bto[\s-]?do list\b/i,
  },
];

// ---------------------------------------------------------------------------
// 2026-07-26 PRODUCT LAW 2 — EQUIPMENT. Owner-directed, verbatim intent: the
// tutor "never tells the user to use a tool / requires an equipment". Every
// instruction must be performable THIS SECOND with only the learner's voice and
// body. This restates the 2026-07-19 zero-friction ruling ("if the app says
// 'yo, we need a straw now' the user will just do 'well, screw that' and closes
// app") as a deterministic runtime contract rather than a prompt hint.
//
// TWO TIERS, on purpose. A single flat word list was rejected: `mirror`,
// `recording`, `app` and `device` all have legitimate senses inside THIS
// product, and a flat list would silently destroy real cues at runtime — the
// same failure mode that ACTIONABLE_VOICE_PATTERN documents above.
//   HARD tier  — objects with no legitimate voice-coaching sense: bare mention
//                fires. Word-boundary keeps "watering", "watery", "glassy",
//                "cupboard", "open"/"happen" out.
//   FRAMED tier — words the product itself owns. `mirror` fires only as a
//                physical object ("in the mirror", "a mirror"), never as the
//                verb ("mirror the target voice" — voice-drills.js:188).
//                `recording`/`app`/`device` fire only when they name an
//                EXTERNAL tool ("a recording app", "download an app"); the
//                TransVoice app IS a recorder, and banning its own capture
//                vocabulary would break honest capture-repair speech.
//
// METAPHOR RULING (pinned): a simile/imagery frame with NO acquisition verb is
// EXEMPT — "let the ending ring like a glass bell" asks the learner to obtain
// nothing, so it cannot cost them the friction this law exists to prevent.
// Imagery is a separate concern with a separate owner: the
// `concrete-over-imagery` preference in applyPreferenceContract strips it when
// the learner asked for that. Two laws, one owner each. The exemption is
// deliberately narrow: an acquisition verb anywhere in the sentence cancels it,
// so "hold a straw like a pen" still fires.
// ---------------------------------------------------------------------------

const EQUIPMENT_SIMILE_FRAME = /\blike an?\b|\bas if\b|\bas though\b|\bimagine\b|\bpicture\b|\bpretend\b|\bthink of it as\b/i;
const EQUIPMENT_ACQUISITION_VERB = /\b(?:get|grab|take|took|hold|holding|use|using|used|find|fetch|pour|fill|sip|drink|blow|breathe through|phonate through|reach for|pick up|put|place|set up|open|download|install|buy|bring out|hold up)\b/i;

const EQUIPMENT_RULES = [
  // ---- HARD tier: bare mention fires ----
  { code: 'object_straw', pattern: /\bstraws?\b/i },
  { code: 'object_spoon', pattern: /\bspoons?\b/i },
  { code: 'object_pen', pattern: /\bpens?\b|\bpencils?\b/i },
  // `cup` as a VERB on the body ("cup your hand behind your ear") needs no
  // object, so it is exempted by lookahead; "a cup of water" still fires.
  { code: 'object_cup', pattern: /\bcups?\b(?!\s+(?:your|one|a|the)\s+(?:hand|hands|palm|palms|ear|ears))/i },
  { code: 'object_glass', pattern: /\bglass(?:es)?\b/i },
  // \bwater\b cannot match "watering" or "watery" (the following char is a word
  // char), which is exactly the false positive the law brief calls out.
  { code: 'object_water', pattern: /\bwater\b|\bbottles?\b/i },
  { code: 'object_metronome', pattern: /\bmetronomes?\b/i },
  { code: 'object_tuner', pattern: /\btuners?\b|\bpitch pipe\b/i },
  { code: 'object_instrument', pattern: /\bpianos?\b|\bkeyboards?\b/i },
  // ---- FRAMED tier: needs an object/external frame ----
  {
    code: 'object_mirror',
    pattern: /\b(?:an?|the|your|another)\s+mirror\b|\b(?:in|into|at|before|front of)\s+(?:the\s+|a\s+|your\s+)?mirror\b/i,
  },
  {
    code: 'external_recorder',
    pattern: /\b(?:recording|recorder|voice[\s-]?memo|tuner|metronome|pitch|piano)\s+apps?\b|\bvoice recorders?\b|\bvoice memos?\b|\brecording (?:device|equipment)\b|\brecord yourself\b/i,
  },
  {
    code: 'external_tool',
    pattern: /\b(?:another|a separate|a second|a different|some other|an external|a third[\s-]?party)\s+(?:apps?|applications?|devices?|tools?|gadgets?)\b|\b(?:download|install|open up)\s+(?:an?\s+|the\s+)?(?:apps?|applications?|devices?|tools?)\b|\byou(?:'ll| will)? need (?:an?|some|any) (?:apps?|devices?|tools?|equipment)\b/i,
  },
];

// ---------------------------------------------------------------------------
// 2026-07-27 PRODUCT LAW 3 — BANNED CUE LEXICON. Source: studio/specs/
// cue-vocabulary-spec-2026-07-27.md §2, evidenced by studio/research/
// mtf-voice-body-atlas-2026-07-27.md §0-§1. Owner-directed, verbatim intent:
// "tell the user to know what a sensation is meant to feel like or how the body
// is meant to be placed instead of telling the user to just use a 'brighter'
// voice as that tells us nothing".
//
// SCOPE: RENDERED coach text only. This module never sees a variable name, so
// the axis identifiers (`resonance`, `weight`) stay legal as words the coach
// may say; it is the QUALITY words and the PLACEMENT FICTIONS that are banned.
//
// TWO TIERS, for the same measured reason EQUIPMENT_RULES has two. A flat list
// containing `light`, `full`, `round` and `warm` destroys ordinary coach speech:
// "the full line", "round lips", "a warm check-in" and "light quick panting"
// (the atlas's own §7 exercise) are all legitimate and all body-anchored.
//   HARD tier   — words that name a sound quality and nothing else. Bare
//                 mention fires: bright/dark and their whole families, plus the
//                 abstract quality nouns (brightness, lightness, fullness,
//                 warmth, richness), which are never about the body.
//   FRAMED tier — light / full / round / rich / warm fire ONLY when attached to
//                 a sound noun (voice, tone, vowel, resonance, note, timbre).
//
// METAPHOR RULING (pinned, inherited from the equipment law): a simile with no
// acquisition verb passes at runtime. Kept consistent here — a banned quality
// word inside a simile frame is still a banned quality word (it names the
// destination, not the road), so the exemption is NOT extended to this law; the
// ruling it preserves is that this law does not add a second imagery filter on
// top of the `concrete-over-imagery` preference, which still owns that concern.
//
// INVALID-CHECK ASYMMETRY — the one thing not to get backwards. Felt vibration
// is a VALID weight signal and an INVALID resonance signal. Sternal
// accelerometry reads subglottal pressure oscillation (valid below ~300 Hz,
// which covers the whole target range), so a palm on the breastbone legitimately
// reads vocal weight; but Sundberg damped the paranasal sinuses with liquid and
// voice quality did not change, so face/mask/cheekbone/sinus buzz tracks pitch,
// not tract shape. `invalid_resonance_buzz` therefore lists ONLY the non-chest
// locations plus the explicit resonance claim: "Palm on your breastbone, make
// the buzz weaker" passes untouched, "feel the buzz in your cheekbones" fires.
// ---------------------------------------------------------------------------

const CUE_VOCABULARY_RULES = [
  // ---- HARD tier: bare mention fires ----
  { code: 'quality_bright', pattern: /\bbright(?:er|est|ly)?\b|\bbrighten(?:s|ed|ing)?\b/i },
  { code: 'quality_dark', pattern: /\bdark(?:er|est|ly)?\b|\bdarken(?:s|ed|ing)?\b/i },
  {
    // The abstract quality nouns. There is no body reading of any of these.
    code: 'quality_noun',
    pattern: /\b(?:brightness|darkness|lightness|fullness|warmth|richness|roundness)\b/i,
  },
  {
    // Placement fictions. Nothing moves and sound is not placed; where the
    // phrase is legitimate at all it is shorthand for a shorter tube.
    // 2026-07-28 hole closed: the fiction does not need the word "forward" or
    // an explicit sound noun — "balanced placement", "neutral placement" and
    // "the placement stays put" are the same claim wearing an adjective. A bare
    // modifier + placement, or placement + a state verb, fires too.
    code: 'placement_fiction',
    pattern: /\bforward placement\b|\bplace the (?:sound|voice|tone|resonance)\b|\b(?:sound|voice|tone|resonance)\s+placement\b|\bplacement of the (?:sound|voice|tone|resonance)\b|\b(?:same|balanced|neutral|stable|steady|correct|proper|ideal|natural|optimal|vocal|good|right)\s+placement\b|\bplacement\s+(?:stays?|holds?|moves?|moved|shifts?|shifted|sits?|is|feels?|goes?|lands?)\b/i,
  },
  { code: 'placement_mask', pattern: /\bthe mask\b|\bmasky\b|\binto the mask\b/i },
  {
    code: 'placement_resonate_in',
    pattern: /\bresonat(?:e|es|ed|ing|ion)\b[^.!?]{0,16}\b(?:in|into|from|behind|through)\s+(?:your\s+|the\s+)?(?:face|nose|nasal|cheekbones?|cheeks?|sinus(?:es)?|head|mask|skull|forehead)\b/i,
  },
  {
    // Two claims sharing one name; by felt location it is folklore.
    code: 'register_folklore',
    pattern: /\bhead voice\b|\bchest voice\b|\bhead resonance\b|\bchest resonance\b/i,
  },
  {
    // Its measurable correlate is ~8 mm larynx LOWERING plus hypopharyngeal
    // widening — a resonance-masculinizing change, i.e. the wrong direction.
    code: 'throat_folklore',
    pattern: /\bopen (?:your |the )?throat\b|\bopen[- ]throat(?:ed)?\b|\bwiden (?:your |the )?throat\b|\bthroat (?:stays? |kept? )?open\b/i,
  },
  {
    // The diaphragm is an inhalation muscle, not voluntarily controllable
    // during exhalation, so every instruction built on it is unactionable.
    code: 'breath_folklore',
    pattern: /\b(?:sing|speak|say|project|support)(?:ing)?\s+(?:it\s+)?from (?:your |the )?diaphragm\b|\bdiaphragmatic (?:support|breathing|breath)\b|\bbelly[- ]breath(?:e|es|ed|ing)?\b|\bbreathe into your belly\b/i,
  },
  {
    // `support` as an undefined instruction. Narrow on purpose: the frame must
    // make it the vocal-technique noun, so ordinary encouragement is untouched.
    code: 'undefined_support',
    pattern: /\b(?:use|using|find|finding|engage|engaging|add|adding|more|better|good|proper|your|the)\s+(?:more\s+|better\s+|good\s+|proper\s+|extra\s+)?support\b|\bsupport (?:the|your) (?:voice|tone|sound|note|breath|line|phrase)\b|\bsupported (?:tone|sound|voice|note)\b|\bbreath support\b/i,
  },
  {
    // Community shorthand. Keep the exercise, drop the name (atlas §1).
    code: 'community_shorthand',
    pattern: /\bbig dog\b|\bsmall dog\b|\bvocal size\b|\btwang(?:y|ing|ed)?\b|\bknodel\b|\bR1\b|\bR2\b/i,
  },
  {
    // Canonical proprioceptors are largely absent from the intrinsic laryngeal
    // muscles — a dedicated study found NO muscle spindles at all in
    // cricothyroid. Chasing the sensation is the muscle-tension-dysphonia
    // pathway; correct production is nearly sensationless.
    code: 'muscle_introspection',
    pattern: /\b(?:cricothyroid|thyroarytenoid|lateral cricoarytenoid|interarytenoid)\b|\b(?:feel|sense|notice|find)\b[^.!?]{0,24}\b(?:vocal folds?|vocal cords?|larynx muscles?|laryngeal muscles?)\b[^.!?]{0,24}\b(?:contract|contracting|tighten|tightening|work|working|engage|engaging|tilt|tilting|move|moving)\b/i,
  },
  {
    // Felt vibration used as a RESONANCE signal. Chest / sternum / breastbone
    // are deliberately absent from the location list — that is the valid
    // WEIGHT check and must pass.
    code: 'invalid_resonance_buzz',
    // SCOPED TO WHAT THE EVIDENCE ACTUALLY RULES OUT. The atlas's invalid class
    // is BONE-CONDUCTED vibration: Sundberg damped the paranasal sinuses with
    // liquid and voice quality did not change; facial-bone vibration correlates
    // with expert perceptual rating at only r ~= 0.6. So face / cheek /
    // cheekbone / mask / sinus / skull / forehead fire on bare mention.
    //
    // Three locations are deliberately ABSENT from that bare-fire list because
    // the same document blesses each of them for a DIFFERENT variable:
    //   chest / sternum / breastbone -> valid signal 3, vocal WEIGHT
    //   nose (fingertip at the side)  -> valid signal 6, NASALITY / port open
    //   palm, lips during /m/         -> valid signals 3 and 7, WEIGHT
    // For those, a felt buzz is only illegal when the sentence claims RESONANCE
    // or PLACEMENT from it — which is the third arm below.
    //
    // MEASURED: an earlier draft listed bare `teeth` as an always-invalid buzz
    // location. It fired on the code-owned drill cue "Hum the line on 'm' or
    // 'n' first and feel the buzz on your lips and behind your top teeth" —
    // direct mechanoreception during a nasal hum, which atlas §7 teaches — and
    // destroyed it at runtime. The research names no such finding for the
    // alveolar ridge; signal 2 reads that region by AIRFLOW, not vibration.
    pattern: /\b(?:buzz|buzzes|buzzing|vibrat(?:e|es|ing|ion|ions)|ring|rings|ringing)\b[^.!?]{0,32}\b(?:in|into|on|at|behind|against|through|near|around)\s+(?:your\s+|the\s+)?(?:upper\s+|top\s+|front\s+|back\s+)?(?:face|cheekbones?|cheeks?|mask|sinus(?:es)?|nasal cavity|skull|forehead)\b|\b(?:face|cheekbones?|cheeks?|mask|sinus(?:es)?|skull|forehead)\b[^.!?]{0,24}\b(?:buzz|buzzes|buzzing|vibrat(?:e|es|ing|ion))\b|\b(?:buzz|buzzes|buzzing|vibration)\b[^.!?]{0,40}\b(?:resonance|placement)\b|\b(?:resonance|placement)\b[^.!?]{0,40}\b(?:buzz|buzzes|buzzing|vibration)\b/i,
  },
  {
    // "Let the resonance move forward" — the cue fires whether or not anything
    // changed, which the atlas rates as worse than no cue at all.
    code: 'sound_travels',
    pattern: /\b(?:resonance|the sound|the tone|the voice)\b[^.!?]{0,24}\b(?:move|moves|moving|travel|travels|shift|shifts|go|goes|come|comes|sit|sits|stay|stays)\b[^.!?]{0,20}\b(?:forward|forwards|further forward|back|backward|backwards|up into|into the)\b/i,
  },
  // ---- FRAMED tier: fires only against a sound noun ----
  {
    // "a lighter voice", "fuller tone", "rounder vowels", "warm resonance".
    // BARE `full` and BARE `round` are deliberately absent from all three
    // FRAMED rules, while their comparatives are kept. MEASURED: with them in,
    // the law fired on "nothing that needs a full voice" (renderer-client's
    // quiet-scope directive, where `full` means volume) and would fire on
    // "round vowels" (the phonetic term for lip rounding, which the atlas §7
    // lip-corner and protrusion exercises actively teach). A comparative is a
    // judgement about tone and has no such innocent reading.
    code: 'quality_before_sound',
    pattern: /\b(?:light|lighter|lightest|fuller|fullest|rounder|rich|richer|warm|warmer)\b(?:\s+(?:and|but|yet)\s+\w+)?\s+(?:voice|sound|tone|tones|vowel|vowels|resonance|note|notes|timbre|quality)\b/i,
  },
  {
    // "keep the voice light", "the tone sounds fuller", "vowels stay warmer",
    // and the bare postmodifier "make the vowels rounder" (no linking verb).
    code: 'quality_after_sound',
    pattern: /\b(?:voice|sound|tone|tones|vowel|vowels|resonance|note|notes|timbre)\b[^.!?]{0,24}\b(?:is|are|was|were|stay|stays|stayed|feel|feels|felt|sound|sounds|sounded|get|gets|got|become|becomes|turn|turns|keep|keeps|keeping|make|makes|making|land|lands)\b[^.!?]{0,16}\b(?:light|lighter|lightest|fuller|fullest|rounder|rich|richer|warm|warmer)\b|\b(?:voice|sound|tone|tones|vowel|vowels|resonance|note|notes|timbre)\s+(?:a\s+(?:bit|little)\s+|slightly\s+|much\s+|even\s+)?(?:light|lighter|lightest|warm|warmer|rich|richer|fuller|fullest|rounder)\b/i,
  },
  {
    // The pronoun form the model reaches for most: "keep it light", "make it
    // fuller". Bounded to keep/make/let/leave so "it lands lightly on the
    // teeth" (a real body cue) is untouched.
    code: 'quality_pronoun',
    pattern: /\b(?:keep|keeping|make|making|let|letting|leave|leaving)\s+(?:it|them|that|this)\s+(?:a\s+(?:bit|little)\s+|slightly\s+|more\s+)?(?:light|lighter|fuller|rounder|rich|richer|warm|warmer)\b/i,
  },
];

// ---------------------------------------------------------------------------
// 2026-07-27 PRODUCT LAW 4 — CONTRAINDICATED PRACTICES. Source: spec §5 /
// atlas §5. These are not merely suboptimal; each has a documented harm or a
// documented dead end, so the coach must never propose one at any temperature.
//
// Each rule is a PROPOSAL frame, not a bare word, because the coach must stay
// able to WARN about the same practice. "Never whisper — keep it voiced" is the
// atlas's own instruction for the panting exercise and must survive; "Try a
// whisper siren" must not. MEASURED: with bare /\bwhisper\b/, 3 of 3 legitimate
// safety warnings in the atlas §7 exercise bank were destroyed.
// ---------------------------------------------------------------------------

const CONTRAINDICATED_RULES = [
  {
    // Thin, artificial timbre and a significantly reduced range.
    code: 'falsetto_pitch_work',
    pattern: /\bfalsetto\b/i,
  },
  {
    // Audible whispering requires false-fold constriction, which learners
    // carry into voiced speech.
    code: 'whisper_practice',
    pattern: /\bwhisper(?:ed|ing|y)?\s+(?:sirens?|drills?|exercises?|practi[cs]e|technique|glides?|scales?|warm[\s-]?ups?|takes?)\b|\b(?:try|do|use|start|begin|practi[cs]e|repeat|say|read|speak|run|take|give)\b[^.!?]{0,32}\b(?:in|on|with)\s+a\s+whisper\b|\bwhisper\s+(?:the|this|that|it|a|one|each|every)\s+(?:line|phrase|word|sentence|vowel|take|take)\b|\bsirens?\s+(?:in|on)\s+a\s+whisper\b/i,
  },
  {
    // Recruits swallowing muscles irrelevant to speech; tension-dysphonia risk.
    code: 'swallow_hold_or_max_raise',
    pattern: /\bswallow[\s-]and[\s-]hold\b|\bhold (?:the |your )?swallow\b|\bswallow (?:and|then) hold\b|\b(?:push|raise|lift|keep|hold|force)\b[^.!?]{0,24}\b(?:larynx|voice box|adam'?s apple)\b[^.!?]{0,24}\bas high as (?:possible|you can|it (?:will )?go)\b|\bas high as (?:possible|you can)\b[^.!?]{0,24}\b(?:larynx|voice box)\b/i,
  },
  {
    // Masks weight instead of reducing it and trains a dead end.
    code: 'deliberate_breathiness',
    pattern: /\badd(?:ing)?\s+(?:some\s+|a little\s+|a bit of\s+|more\s+)?(?:breath(?:iness)?|air)\b[^.!?]{0,40}\b(?:light|lighter|softer|feminine|sound|sounds)\b|\b(?:make|makes|making|keep|keeps|keeping|let|lets|letting)\b[^.!?]{0,16}\bbreathy\b|\bbreathy\b[^.!?]{0,32}\b(?:to sound|so it sounds|so you sound|for a)\b|\bspeak breathily\b|\buse (?:a |some )?breathi(?:ness|er)\b/i,
  },
  {
    // Predictably insufficient, not merely suboptimal: causal resynthesis flips
    // attribution ~82% of the time only when F0 AND resonance both move.
    code: 'pitch_only_strategy',
    pattern: /\b(?:just|only|simply|all you (?:need|have) to do is|all it takes is)\b[^.!?]{0,32}\b(?:raise|raising|lift|lifting|push|pushing|bring|bringing|get)\b[^.!?]{0,16}\bpitch\b|\bpitch (?:is|alone is) (?:all|the only thing|enough)\b|\bonly (?:the )?pitch (?:matters|counts)\b|\bpitch[\s-]only\b|\bnothing (?:else )?but pitch\b|\bpitch is all (?:you|that) (?:need|matters)\b/i,
  },
  {
    // Legal as a RELEASE tool; illegal as a habitual speaking posture, because
    // it lowers the larynx and drops F2/F3 — the wrong direction as a habit.
    code: 'yawn_sigh_as_posture',
    pattern: /\byawn(?:[\s-]sigh)?\s+(?:posture|position|set[\s-]?up|shape|stance)\b|\b(?:speak|speaking|talk|talking|say|saying|read|reading)\b[^.!?]{0,16}\b(?:with|from|in|on)\s+(?:a |the |that )?yawn(?:[\s-]sigh|y)?\b|\b(?:hold|holding|keep|keeping|stay in|carry)\b[^.!?]{0,16}\byawn(?:[\s-]sigh)?\b|\byawn(?:[\s-]sigh)?\b[^.!?]{0,32}\b(?:every time|each time|always|whenever you speak|as you speak|while (?:you )?speak(?:ing)?|all the time|habit|habitual|throughout)\b/i,
  },
];

// ---------------------------------------------------------------------------
// 2026-07-27 PRODUCT LAW 5 — CUE SHAPE. Spec §1: a coaching instruction must
// contain an ACTION, where an action is "a body part + what it does (or an
// imitation task the body can just perform)". A cue fails if it names only a
// quality of the sound with no body action — "those describe the destination,
// not the road".
//
// STRUCTURAL, not a second blocklist. Spec §6 is explicit that a second
// banned-word list "will fail open on new phrasings", so the test is positive:
// does the sentence contain a term from CUE_BODY_REFERENT_PATTERN (body parts +
// imitation movements + checkable sensations, all defined once at the top of
// this file)? A metaphor nobody has invented yet still contains none of them.
//
// THE GATE MATTERS AS MUCH AS THE TEST. The requirement is applied ONLY to
// sentences that are (a) instructions and (b) about the sound. MEASURED against
// the 27 approved phrasings in spec §4: this law false-fires on 0 of 27, while
// the naive "every instruction needs a body part" rejects 8 of them ("Slide the
// tone up in one unbroken line", "Hold an 'mmm', then open into a vowel",
// "Make that buzz weaker without getting quieter", …). Sentences that are not
// instructions ("I hear you.")
// and instructions that never name the sound are both out of scope by
// construction, so this law cannot touch ordinary conversation.
//
// SPEC §3a (added 2026-07-27) MAKES THAT SCOPING A REQUIREMENT, not a nicety:
// "the deterministic cue-shape rule must therefore be scoped to coaching
// instructions, not to every coach sentence. A reply that answers an objection,
// acknowledges a feeling, or declines to prescribe is compliant with no body
// referent at all." The five blocks it names — the identity objection, the
// voice dying around people who knew you before, being flawless as a character
// but unavailable as yourself, fear of sounding ridiculous mid-attempt, and
// expecting hormones to have done it — have no physical answer, and forcing one
// onto them "is worse than saying nothing".
//
// This implementation already met §3a and did not need changing. MEASURED
// against all five blocks plus seven realistic objection-answering replies:
// 0 fire. Two independent properties do it, so neither alone is load-bearing —
// most such sentences carry no instruction verb, and the ones that do speak in
// `effort` / `pressure` / `tension`, which are SENSATION_TERMS. The pin lives
// in sanitizer.cue-vocabulary.test.js so a future widening cannot quietly
// break it.
// ---------------------------------------------------------------------------

const CUE_SHAPE_RULES = [
  {
    code: 'cue_without_body_referent',
    // Duck-typed to match the { code, pattern } shape applySentenceLaw expects;
    // the predicate is a conjunction, which no single regex expresses cleanly.
    pattern: {
      test(sentence) {
        const s = String(sentence || '');
        if (!ACTIONABLE_CUE_PATTERN.test(s)) return false;
        if (!VOICE_QUALITY_PATTERN.test(s)) return false;
        if (APP_SURFACE_PATTERN.test(s)) return false;
        return !CUE_BODY_REFERENT_PATTERN.test(s);
      },
    },
  },
];

/**
 * Does this sentence still carry a usable, executable voice action?
 * Reuses the two patterns that already define "actionable" for the core-loop
 * repair and the fewer-corrections split, so the laws below cannot disagree
 * with the rest of the sanitizer about what counts as a cue.
 */
function carriesActionableCue(text) {
  const s = String(text || '');
  return ACTIONABLE_CUE_PATTERN.test(s) && ACTIONABLE_VOICE_PATTERN.test(s);
}

/**
 * Shared engine for the two product laws.
 *
 * Mirrors sanitizeSessionControl's mechanism (sentence split -> per-sentence
 * verdict -> adjacent dedupe), with the one refinement the laws need: the
 * remedy is CONDITIONAL. If the surviving sentences still carry an actionable
 * cue, the offending sentence is DROPPED (no invented coaching, no duplicated
 * cue); only when the drop would leave the learner with nothing to do is it
 * REPLACED with a code-owned now-action. Returns { text, hits } where hits are
 * rule codes, matching the sanitizeRepPressure witness shape.
 */
function applySentenceLaw(reply, rules, options = {}) {
  const hits = [];
  if (!reply || typeof reply !== 'string') {
    return { text: reply || '', hits };
  }
  const isExempt = typeof options.exempt === 'function' ? options.exempt : () => false;
  const hasReplacement = Object.prototype.hasOwnProperty.call(options, 'replacement');
  const replacement = hasReplacement ? String(options.replacement || '').trim() : GENERIC_ACTIONABLE_CUE;
  const sentences = reply.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);

  const verdicts = sentences.map((sentence) => {
    if (isExempt(sentence)) return { sentence, hit: null };
    const rule = rules.find((r) => r.pattern.test(sentence));
    return { sentence, hit: rule ? rule.code : null };
  });
  if (!verdicts.some((v) => v.hit)) return { text: reply, hits };

  const survivors = verdicts.filter((v) => !v.hit).map((v) => v.sentence);
  const survivorsActionable = survivors.some((sentence) => carriesActionableCue(sentence));

  const rewritten = [];
  for (const verdict of verdicts) {
    if (!verdict.hit) {
      rewritten.push(verdict.sentence);
      continue;
    }
    hits.push(verdict.hit);
    // Drop when the rest of the reply still tells the learner what to do now;
    // otherwise hand back a code-owned in-session action so the turn is not
    // left empty (an empty turn falls through to resolveActionFallback, which
    // is a coarser remedy than a real cue).
    if (survivorsActionable || !replacement) continue;
    rewritten.push(replacement);
  }
  const deduped = rewritten
    .filter(Boolean)
    .filter((sentence, index, values) => index === 0 || sentence !== values[index - 1]);
  return { text: deduped.join(' '), hits };
}

/**
 * PRODUCT LAW 1 — all practice happens now, in this session, with the tutor.
 */
function sanitizeHomework(reply, options = {}) {
  return applySentenceLaw(reply, HOMEWORK_RULES, options);
}

/**
 * PRODUCT LAW 2 — no instruction may require an object. See the METAPHOR
 * RULING above for why a simile without an acquisition verb is exempt.
 */
function sanitizeEquipment(reply, options = {}) {
  return applySentenceLaw(reply, EQUIPMENT_RULES, {
    ...options,
    exempt: (sentence) => (
      EQUIPMENT_SIMILE_FRAME.test(sentence) && !EQUIPMENT_ACQUISITION_VERB.test(sentence)
    ),
  });
}

/**
 * PRODUCT LAW 3 — no quality word or placement fiction reaches the learner.
 * Same remedy shape as the homework and equipment laws: drop the offending
 * sentence when the rest of the reply still tells the learner what to do,
 * otherwise substitute one code-owned body-anchored action.
 */
function sanitizeCueVocabulary(reply, options = {}) {
  return applySentenceLaw(reply, CUE_VOCABULARY_RULES, options);
}

/**
 * PRODUCT LAW 4 — the six contraindicated practices are never proposed.
 */
function sanitizeContraindicated(reply, options = {}) {
  return applySentenceLaw(reply, CONTRAINDICATED_RULES, options);
}

/**
 * PRODUCT LAW 5 — an instruction about the sound must name the body.
 */
function sanitizeCueShape(reply, options = {}) {
  return applySentenceLaw(reply, CUE_SHAPE_RULES, options);
}

// ---------------------------------------------------------------------------
// 2026-08-01 SINGLE-TAKE CAUSATION LAW. A measured win and the previous cue
// co-occurred once; that does not establish that the cue caused the change.
// Scope is deliberately narrow: only acknowledge_win turns carrying a prior cue,
// and only sentences that explicitly join a result word to causal language.
// Ordinary explanations on every other turn and non-causal "you were doing X"
// acknowledgments remain untouched.
// ---------------------------------------------------------------------------
const UNSUPPORTED_WIN_CAUSATION_RULES = [
  {
    code: 'unsupported_single_take_causation',
    pattern: {
      test(sentence) {
        // Evaluate polarity per clause rather than trying to enumerate every
        // possible cue-action subject. This lets “not because” survive while a
        // later “but because” in the same sentence still fails closed.
        const text = String(sentence || '');
        const namesResult = /\b(?:improv(?:e|ed|ement)|better|land(?:ed|ing)?|work(?:ed|ing)?|success(?:ful)?|progress|change(?:d)?|win|did it|got (?:you|us) there|paid off)\b/i.test(text);
        const directMarker = /\b(?:made (?:it|that|(?:the|that|this) (?:take|attempt|result)) (?:work|land|better|improve)|caused? (?:it|that|(?:the )?(?:improvement|change|progress|win))|(?:helped|enabled) (?:it|that|the (?:take|attempt|result)) (?:work|land|improve|succeed)|(?:produced|created|brought about) (?:the )?(?:improvement|change|progress|win)|got (?:you|us) there|(?:that|this|it)(?:'s| is| was) (?:what (?:did it|made (?:it|that) work)|why (?:it|that|the (?:take|attempt)) (?:worked|landed|improved))|(?:is|was) why (?:it|that|the (?:take|attempt)) (?:worked|landed|improved)|(?:improvement|progress|change|win) (?:came|comes) from|led to (?:the )?(?:improvement|change|progress|win)|(?:(?:that|this|the) (?:cue|hum|drill|action|exercise)|it) (?:worked|helped|paid off))\b/gi;
        const connectorMarker = /\b(?:because(?: of)?|thanks to|as a result of|due to|owing to|on account of)\b/gi;
        const predicateMarker = /\b(?:is|was) (?:(?:the )?reason(?: that)?|responsible for)\b/gi;
        const denialBeforeMarker = (prefix) => {
          // “not only/just/merely because” still affirms that cause; remove those
          // non-denial frames before deciding whether a marker is negated.
          const withoutNonDenial = prefix.replace(/\bnot (?:only|just|merely|simply)\b/gi, '');
          return /(?:\bnot\b|\bno evidence\b|\b(?:was|is|did|does|could|would|should)(?:\s+not|n['’]t)\b|\bcannot\b|\bcan['’]t\b)[^,;.!?—]*$/i.test(withoutNonDenial);
        };
        const clauses = text.split(/[,;.!?—]+|\b(?:but|however|although|yet|and)\b/i);
        for (const clause of clauses) {
          // Bare “did it” is causal when an action is the subject, but “You
          // really did it” is ordinary praise. Handle that subject distinction
          // before the broader marker scan instead of relying on lookbehind.
          for (const match of clause.matchAll(/\bdid it\b/gi)) {
            const prefix = clause.slice(0, match.index);
            const praiseSubject = /\b(?:you|we)(?:\s+(?:really|finally|actually|totally|absolutely))?\s*$/i.test(prefix);
            if (!praiseSubject && !denialBeforeMarker(prefix)) return true;
          }
          const marker = new RegExp(
            `${directMarker.source}${namesResult ? `|${connectorMarker.source}|${predicateMarker.source}` : ''}`,
            'gi',
          );
          for (const match of clause.matchAll(marker)) {
            if (!denialBeforeMarker(clause.slice(0, match.index))) return true;
          }
        }
        return false;
      },
    },
  },
];

function sanitizeUnsupportedWinCausation(reply, signal, options = {}) {
  const intent = signal?.coachingDecision?.intent || signal?.coachMove?.intent;
  const previousCueId = typeof signal?.previousCue?.id === 'string'
    ? signal.previousCue.id.trim()
    : '';
  if (intent !== 'acknowledge_win' || !previousCueId) {
    return { text: reply || '', hits: [] };
  }
  return applySentenceLaw(reply, UNSUPPORTED_WIN_CAUSATION_RULES, options);
}

function normalizeCueAcknowledgementText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasExactPreviousCueAcknowledgement(text, action) {
  const required = normalizeCueAcknowledgementText(`You were ${action}`);
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => {
      const normalized = normalizeCueAcknowledgementText(sentence);
      return normalized === required
        || normalized.startsWith(`${required} `)
        || normalized.startsWith(`${required}—`);
    });
}

/**
 * Prompt compliance is not a safety boundary. If the live model omits the
 * finite carried action, keep at most one non-instruction acknowledgement and
 * put the code-owned co-occurrence sentence first. Compliance requires the
 * explicit “You were <action>” frame, not an arbitrary lexical mention that
 * might still claim the action caused the win. Unknown cue IDs remain
 * untouched/fail-closed.
 */
function ensurePreviousCueAcknowledgement(reply, signal) {
  const intent = signal?.coachingDecision?.intent || signal?.coachMove?.intent;
  const action = intent === 'acknowledge_win' ? resolvePreviousCueAction(signal) : '';
  const text = String(reply || '').trim();
  if (!action || hasExactPreviousCueAcknowledgement(text, action)) {
    return { text, repaired: false };
  }

  const exactAcknowledgement = `You were ${action} — keep that going.`;
  const firstSentence = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .find(Boolean) || '';
  const modelAcknowledgement = firstSentence && !carriesActionableCue(firstSentence)
    ? firstSentence
    : '';
  return {
    text: modelAcknowledgement
      ? `${exactAcknowledgement} ${modelAcknowledgement}`
      : exactAcknowledgement,
    repaired: true,
  };
}

// ---------------------------------------------------------------------------
// 2026-07-28 BEGINNER-LANGUAGE LAW. The learner is a total beginner with zero
// vocal training; every word the tutor says must be self-explanatory. These
// axis nouns are internal identifiers the investigation found reaching the
// learner raw — "your resonance sat back", "keep the vocal weight" — where
// they carry no meaning at all.
//
// AXIS-NOUN RULING (decided here, mirrored in the cue-vocabulary spec §6):
// bare `resonance` / `vocal weight` are BANNED in spoken coach output, glossed
// or not. Deterministic gloss-detection is too fragile to police "glossed in
// the same sentence" (a dash, a parenthesis, a following clause all read
// differently), so the sentence is treated like any other law violation:
// dropped when the rest of the reply still carries an actionable cue, replaced
// with the code-owned plain cue otherwise. The GLOSS lives where it can be
// guaranteed: in the code-owned cue strings (cueForDueReview glosses each axis
// inline) and in the renderer prompt's plain-name rule. Jargon with a safe
// plain equivalent ("displayed line", "pitch floor", "intonation", "prosody")
// is handled by word-level rewrite in BANNED_VOCAB_RULES instead — a rewrite
// preserves the sentence where a drop would destroy it.
//
// SCOPE: model output only (sanitizeCoachReply). Unlike CUE_VOCABULARY_RULES
// this table is deliberately NOT in the content audit's rule set: code-owned
// surfaces (drill titles, cue-sheet tokens, model-facing prompt notes) may
// still name an axis as a content word where the UI gives it context; the
// spoken word is what the beginner must parse with no training and no screen.
// ---------------------------------------------------------------------------

const BEGINNER_JARGON_RULES = [
  { code: 'jargon_axis_resonance', pattern: /\bresonance\b/i },
  { code: 'jargon_axis_vocal_weight', pattern: /\bvocal weight\b/i },
];

/**
 * Beginner-language law — no raw axis nouns in spoken coach output.
 * Same remedy shape as the other sentence laws.
 */
function sanitizeBeginnerJargon(reply, options = {}) {
  return applySentenceLaw(reply, BEGINNER_JARGON_RULES, options);
}

// ---------------------------------------------------------------------------
// 2026-07-18: live banned-vocabulary guard (docs/PRACTICE-PHILOSOPHY.md,
// "de-gamification rulings" — binding). The v3 dataset gates this offline, but
// the live model can still emit gamification vocabulary at sampling temp, so
// the sanitizer is the contract: banned terms are REPLACED with calm adult
// alternatives (stripping whole sentences would be more destructive than the
// offense). CONSERVATIVE on purpose: only unambiguous gamification forms match.
// Bare "level" ("volume level"), bare "score" ("score confidence"), and bare
// "points" ("two points of focus") survive — they carry legitimate voice-work
// meanings. Each rule is word-boundary, case-insensitive.
// ---------------------------------------------------------------------------

const BANNED_VOCAB_RULES = [
  // 2026-07-28 BEGINNER-LANGUAGE law (word-level half). These jargon terms all
  // have a safe plain equivalent, so they are REWRITTEN rather than the
  // sentence being dropped — the learner keeps the instruction, minus the
  // vocabulary they could not possibly know. The axis nouns with no safe swap
  // (resonance / vocal weight) are sentence-law work: BEGINNER_JARGON_RULES.
  {
    // "displayed line" / "display line" — UI jargon, meaningless in EyesFree.
    pattern: /\bdisplay(?:ed)? line\b/gi,
    replacement: (match) => (/^D/.test(match) ? 'Practice sentence' : 'practice sentence'),
  },
  {
    // "pitch floor" -> the thing it actually measures.
    pattern: /\bpitch floor\b/gi,
    replacement: (match) => (/^P/.test(match) ? 'Low end of your pitch' : 'low end of your pitch'),
  },
  {
    pattern: /\bintonation\b/gi,
    replacement: (match) => (/^I/.test(match) ? 'Melody' : 'melody'),
  },
  {
    pattern: /\bprosody\b/gi,
    replacement: (match) => (/^P/.test(match) ? 'Melody' : 'melody'),
  },
  { pattern: /\bstreaks\b/gi, replacement: 'runs' },
  { pattern: /\bstreak\b/gi, replacement: 'run' },
  { pattern: /\bcombos\b/gi, replacement: 'sequences' },
  { pattern: /\bcombo\b/gi, replacement: 'sequence' },
  { pattern: /\bxp\b/gi, replacement: 'progress' },
  { pattern: /\bbadges\b/gi, replacement: 'milestones' },
  { pattern: /\bbadge\b/gi, replacement: 'milestone' },
  {
    pattern: /\bunlock(s|ed|ing)?\b/gi,
    replacement: (match, suffix) => {
      const s = (suffix || '').toLowerCase();
      if (s === 's') return 'opens up';
      if (s === 'ed') return 'opened up';
      if (s === 'ing') return 'opening up';
      return 'open up';
    },
  },
  { pattern: /\bquests\b/gi, replacement: 'practice goals' },
  { pattern: /\bquest\b/gi, replacement: 'practice goal' },
  {
    // level up / levels up / leveled|levelled up / leveling|levelling up / level-up
    pattern: /\blevel(s|l?ed|l?ing)?[ -]up\b/gi,
    replacement: (match, suffix) => {
      const s = (suffix || '').toLowerCase();
      if (s === 's') return 'moves forward';
      if (/ed$/.test(s)) return 'moved forward';
      if (/ing$/.test(s)) return 'moving forward';
      return 'move forward';
    },
  },
  {
    // "level 3" as a progression rank. Guarded so a measurement phrase like
    // "volume level 2" is untouched (that is a setting, not gamification).
    pattern: /(?<!\b(?:volume|noise|sound|energy|effort|pitch)\s)\blevel\s+\d+\b/gi,
    replacement: 'the next stage',
  },
  {
    // points as a reward currency: needs a reward verb — bare "points" survives.
    pattern: /\b(earn|earned|earning|score|scored|scoring|win|won|winning|collect|collected|collecting|rack up|racked up|racking up)\s+(?:\d+\s+)?points\b/gi,
    replacement: (match, verb) => {
      const base = String(verb || '').toLowerCase().replace(/\s+up$/, '');
      if (/ing$/.test(base)) return 'making real progress';
      if (/ed$/.test(base) || base === 'won') return 'made real progress';
      return 'make real progress';
    },
  },
  {
    // score as praise ("new high score!") — analyzer terms like "score
    // confidence" / "voice score" survive (no praise adjective).
    pattern: /\b(?:new\s+)?(?:high|top|best)\s+score\b/gi,
    replacement: 'best take yet',
  },
  { pattern: /\byou(?:'re| are)\s+crushing\s+it\b/gi, replacement: 'this is really landing' },
  { pattern: /\b(?:you\s+)?crushed\s+it\b/gi, replacement: 'that one really landed' },
  { pattern: /\bcrushing\s+it\b/gi, replacement: 'landing it well' },
];

/**
 * Replace banned gamification vocabulary with calm adult alternatives, and
 * collapse hype punctuation (2+ exclamation marks -> a period; the philosophy
 * bans the "great job!!" / "awesome!!" form specifically — a single calm "!"
 * survives). Returns { text, hits } where hits records each replaced span so
 * the runtime can log a structured witness line.
 */
function sanitizeBannedVocabulary(reply) {
  const hits = [];
  if (!reply || typeof reply !== 'string') {
    return { text: reply || '', hits };
  }
  let sanitized = reply;
  for (const rule of BANNED_VOCAB_RULES) {
    sanitized = sanitized.replace(rule.pattern, (...args) => {
      const match = args[0];
      const replacement = typeof rule.replacement === 'function'
        ? rule.replacement(...args)
        : rule.replacement;
      hits.push({ match, replacement });
      return replacement;
    });
  }
  // Hype punctuation: "great job!!" -> "great job." (run of 2+ collapses).
  sanitized = sanitized.replace(/!{2,}/g, (match) => {
    hits.push({ match, replacement: '.' });
    return '.';
  });
  // Only normalize spacing when a replacement actually happened, and preserve
  // newlines (collapse runs of spaces/tabs only) — the vocab guard must not
  // reflow untouched replies.
  const text = hits.length ? sanitized.replace(/[^\S\r\n]{2,}/g, ' ').trim() : sanitized;
  return { text, hits };
}

function sanitizeRepPressure(reply) {
  const hits = [];
  if (!reply || typeof reply !== 'string') {
    return { text: reply || '', hits };
  }
  let sanitized = reply;
  for (const rule of REP_PRESSURE_RULES) {
    sanitized = sanitized.replace(rule.pattern, (match, offset) => {
      hits.push(rule.code);
      const beginsSentence = !sanitized.slice(0, offset).trim() || /[.!?]\s*$/.test(sanitized.slice(0, offset));
      return beginsSentence ? 'Take another if you like' : 'take another if you like';
    });
  }
  return {
    text: hits.length ? sanitized.replace(/[^\S\r\n]{2,}/g, ' ').trim() : sanitized,
    hits,
  };
}

function sanitizeSessionControl(reply, options = {}) {
  const hits = [];
  if (!reply || typeof reply !== 'string') {
    return { text: reply || '', hits };
  }
  const replacement = Object.prototype.hasOwnProperty.call(options, 'replacement')
    ? String(options.replacement || '').trim()
    : LOW_EFFORT_CUE;
  const sentences = reply.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const rewritten = sentences.map((sentence) => {
    const hit = SESSION_CONTROL_PATTERNS.find((pattern) => pattern.test(sentence));
    if (!hit) return sentence;
    hits.push(hit.source);
    return replacement;
  });
  const deduped = rewritten
    .filter(Boolean)
    .filter((sentence, index, values) => index === 0 || sentence !== values[index - 1]);
  return { text: deduped.join(' '), hits };
}

const IMAGERY_PATTERN = /\b(?:imagine|imagery|picture|visuali[sz]e|metaphor|pretend|envision)\b|\blike a\b|\bas if\b/i;
const PRAISE_PADDING_PATTERN = /\b(?:great job|nice work|well done|awesome|amazing|you nailed it)\b[!.]?/gi;
const DIRECT_HEDGE_PATTERN = /\b(?:maybe|perhaps|a bit|slightly|sort of|kind of)\b/gi;

function splitCompleteSentences(reply) {
  const matches = String(reply || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return matches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`));
}

function spokenWordCount(reply) {
  return (String(reply || '').trim().match(/\S+/g) || []).length;
}

function resolveActionFallback(signal) {
  const action = String(signal?.policy?.coachingAction || '').trim().toLowerCase();
  if (action === 'breather' || action === 'converse') {
    return 'I’m listening.';
  }
  // 2026-07-28: the fallback names the actual sentence whenever one exists.
  return cueWithLine(SAFE_FALLBACK, signal);
}

function applyPreferenceContract(reply, signal) {
  const policy = signal?.personalization?.preferencePolicy;
  if (!policy || typeof policy !== 'object') return String(reply || '');
  const ids = new Set(Array.isArray(policy.ids) ? policy.ids.map(String) : []);
  let sentences = splitCompleteSentences(reply);

  if (ids.has('concrete-over-imagery')) {
    sentences = sentences.filter((sentence) => !IMAGERY_PATTERN.test(sentence));
  }

  let sanitized = sentences.join(' ');
  if (ids.has('direct-feedback')) {
    sanitized = sanitized
      .replace(PRAISE_PADDING_PATTERN, '')
      .replace(DIRECT_HEDGE_PATTERN, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const action = String(signal?.policy?.coachingAction || '').trim().toLowerCase();
    if (
      ACTIONABLE_COACHING_ACTIONS.has(action)
      && signal?.policy?.shouldCorrect === true
      && sanitized
      && !/\b(?:do this|instead|fix|add|reduce|raise|lower|too (?:high|low|light|heavy|dark|bright|breathy|strained))\b/i.test(sanitized)
    ) {
      sanitized = `Do this: ${sanitized}`;
    }
  } else if (ids.has('gentle-tone') && sanitized && !/\b(?:gentle|gently|softly|i hear you|no rush|that'?s okay)\b/i.test(sanitized)) {
    sanitized = `Gently, ${sanitized.charAt(0).toLowerCase()}${sanitized.slice(1)}`;
  }

  if (ids.has('fewer-corrections') || Number(policy.maxCueCount) === 1) {
    const boundedSentences = splitCompleteSentences(sanitized);
    const acknowledgment = boundedSentences.find((sentence) => (
      !(ACTIONABLE_CUE_PATTERN.test(sentence) && ACTIONABLE_VOICE_PATTERN.test(sentence))
    ));
    const cue = boundedSentences.find((sentence) => (
      ACTIONABLE_CUE_PATTERN.test(sentence) && ACTIONABLE_VOICE_PATTERN.test(sentence)
    ));
    const selected = [];
    selected.push(acknowledgment || 'I hear you.');
    if (cue && cue !== acknowledgment) selected.push(cue);
    sanitized = selected.join(' ');
  }

  return sanitized;
}

function boundSpokenReply(reply, signal) {
  const configured = Number(signal?.personalization?.preferencePolicy?.maxSpokenWords);
  const maxWords = Number.isFinite(configured)
    ? Math.max(8, Math.min(45, Math.round(configured)))
    : 45;
  const selected = [];
  let usedWords = 0;
  for (const sentence of splitCompleteSentences(reply).slice(0, 2)) {
    const sentenceWords = spokenWordCount(sentence);
    if (sentenceWords > maxWords || usedWords + sentenceWords > maxWords) break;
    selected.push(sentence);
    usedWords += sentenceWords;
  }
  if (selected.length > 0) return selected.join(' ');
  const fallback = resolveActionFallback(signal);
  return spokenWordCount(fallback) <= maxWords ? fallback : 'I’m listening.';
}

// 2026-06-25: derive the learner's coaching direction from the signal's styleTarget
// preset name. Authoritative preset->direction map is target-presets-v2.js:
// cute-feminine / bright-playful / everyday-feminine -> feminizing (MTF);
// androgynous -> neutral. Returns 'feminizing'|null (null = skip filter).
//
// 2026-07-26 MTF-ONLY: the masculinizing (FTM) direction is retired. The
// `ftm`/`masculinizing` branch and the `masc-*` preset fallback are gone, so a
// retired FTM signal yields null and the direction filter simply SKIPS — the
// same safe no-op neutral already gets. It is deliberately NOT mapped to
// 'feminizing': that would strip the learner's own cues as "cross-direction".
//
// 2026-07-27 (round 4): the last surviving masc-shaped line here — an explicit
// `if (s.includes('masc')) return null;` — is REMOVED. It was compat machinery
// for a route that does not exist, and it was behaviourally dead: a retired id
// contains no 'fem'/'cute'/'playful', so it already falls through to the same
// `return null`. A counterfactual build differed only for strings that are not
// real ids in any registry (e.g. 'masc-feminine'). Removing it is what makes a
// retired id indistinguishable from any other unrecognised string here, which
// is the property the retired-target sweep pins.
function deriveDirection(signal) {
  if (!signal || typeof signal !== 'object') return null;
  // Authoritative: learner profile direction, resolved in buildSignal (mtf ->
  // feminizing). Preferred over preset-name matching so an unknown preset
  // (e.g. 'x') or a direction/preset mismatch still filters correctly.
  const d = signal.direction;
  if (d === 'mtf' || d === 'feminizing') return 'feminizing';
  // Fallback: derive from the preset name (cute-feminine -> feminizing).
  const s = String(signal.styleTarget || '').toLowerCase();
  if (s.includes('fem') || s.includes('cute') || s.includes('playful')) return 'feminizing';
  return null; // androgynous / unknown -> no-op (safe)
}

/**
 * Build a regex (case-insensitive, whole-word) for a doNotSay phrase.
 * Single non-word characters are escaped. Phrases longer than 40 chars are
 * treated as raw substring matches (with care for regex meta-characters).
 */
function buildDoNotSayRegex(phrase) {
  const trimmed = String(phrase || '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 40) {
    // Treat as raw substring; escape regex meta-characters.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'gi');
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:${escaped})\\b`, 'gi');
}

/**
 * Remove unsafe suggestions from model output.
 */
function sanitizeUnsafeContent(reply) {
  let sanitized = reply;
  for (const pattern of UNSAFE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Remove pitch mentions when the topic is avoided.
 */
function sanitizePitchMentions(reply) {
  const sentences = reply.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const withoutPitch = sentences.filter((s) => !PITCH_PATTERN.test(s));
  if (withoutPitch.length === 0) {
    // If all sentences mention pitch, replace with safe fallback.
    // 2026-07-27 cue-vocabulary law: this fallback used to read "Make the
    // vowels smaller and brighter with lighter voice weight" — two banned
    // quality words in the sanitizer's OWN code-owned learner-facing string, so
    // the module emitted the exact thing it now forbids. MEASURED: the old
    // wording fires CUE_VOCABULARY_RULES `quality_bright` and
    // `quality_before_sound`; the replacement fires no rule in any of the three
    // 2026-07-27 laws and names two body parts with what they do.
    return 'Draw your lip corners back so the lips lie flat on your teeth, and press the sides of your tongue up against your upper back teeth.';
  }
  if (withoutPitch.length < sentences.length) {
    return withoutPitch.join(' ');
  }
  return reply;
}

/**
 * Remove coaching sentences from conversation practice mode.
 */
function sanitizeConversationPractice(reply) {
  const sentences = reply.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return reply;

  const coachingSentences = sentences.filter((s) => {
    const hasVoiceTerm = VOICE_TERM_PATTERN.test(s);
    const hasCoachingAction = COACHING_ACTION_PATTERN.test(s);
    const hasAnalyzerTerm = /\b(?:analyzer|metric|capture|recording|mic|microphone|voice score|score confidence)\b/i.test(s);
    return hasAnalyzerTerm || (hasVoiceTerm && hasCoachingAction);
  });

  if (coachingSentences.length === 0) return reply;
  if (coachingSentences.length === sentences.length) return reply;

  const kept = sentences.filter((s) => !coachingSentences.includes(s));
  return kept.length > 0 ? kept.join(' ') : reply;
}

/**
 * v2: strip doNotSay phrases from the model output. If stripping would empty
 * the reply, replace with a safe fallback.
 *
 * @param {string} reply
 * @param {string[]} doNotSay - phrases the model must not emit
 * @returns {string}
 */
function sanitizeDoNotSay(reply, doNotSay) {
  if (!Array.isArray(doNotSay) || doNotSay.length === 0) return reply;
  let sanitized = reply;
  let strippedAny = false;
  for (const phrase of doNotSay) {
    const re = buildDoNotSayRegex(phrase);
    if (!re) continue;
    const before = sanitized;
    sanitized = sanitized.replace(re, '');
    if (sanitized !== before) strippedAny = true;
  }
  sanitized = sanitized.replace(/\s{2,}/g, ' ').replace(/[.!?]\s*[.!?]+/g, '.').trim();
  if (strippedAny && !sanitized) {
    return SAFE_FALLBACK;
  }
  return sanitized;
}

/**
 * v2: strip gender-label framing. The model should use targetFit status
 * (in_band, below, too_dark, etc.), not gender labels.
 */
function sanitizeGenderLabels(reply) {
  let sanitized = reply;
  for (const pattern of GENDER_LABEL_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized.replace(/\s{2,}/g, ' ').trim();
}

/**
 * v2: strip prohibited clinical/pathological framing.
 */
function sanitizeProhibitedCues(reply) {
  let sanitized = reply;
  for (const pattern of PROHIBITED_CUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Rejected takes are a deterministic trust boundary: the model may phrase an
 * ordinary coaching decision, but it must not invent why measurement failed.
 * Return short, cause-bounded copy from categorical analyzer reasons only.
 */
function resolveCaptureRepairReply(signal) {
  if (signal?.coachMove?.intent !== 'repair_capture' || signal?.takeQuality?.usable !== false) {
    return null;
  }
  if (signal?.safety?.shouldStop || signal?.policy?.safetyState === 'stop' || signal?.policy?.safetyState === 'fatigue_or_strain') {
    return null;
  }

  const reasons = Array.isArray(signal.takeQuality.reasons)
    ? signal.takeQuality.reasons.map((reason) => String(reason || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const has = (pattern) => reasons.some((reason) => pattern.test(reason));

  if (has(/clipp|too[_ -]?loud|saturat/)) {
    return {
      cause: 'clipping',
      reply: 'The recording came in too loud. Move slightly back from the mic when you’re ready.',
    };
  }
  if (has(/low[_ -]?snr|noise|noisy|background/)) {
    return {
      cause: 'noise',
      reply: 'Background noise covered the recording. Move somewhere quieter or closer to the mic when you’re ready.',
    };
  }
  if (has(/no[_ -]?voiced|voiced (?:coverage )?\d|low[_ -]?voiced|too[_ -]?short|duration|capture (?:unusable|low|degraded)/)) {
    return {
      cause: 'not_enough_voice',
      reply: "I didn't capture enough of your voice. Move a little closer and speak clearly when you're ready.",
    };
  }
  return {
    cause: 'unclear_capture',
    reply: "I couldn't get a clear enough recording to assess. Check your mic distance and speak when you're ready.",
  };
}

/**
 * Main sanitizer entry point.
 * Applies all relevant sanitization based on the CoachingSignal policy.
 *
 * `options.witness` (optional object) is mutated with observability fields
 * (`vocabHits`, `repPressureHits`) so the runtime can log structured witness lines
 * without this module owning a logger. String-in/string-out is unchanged.
 */
function sanitizeCoachReply(reply, signal, options = {}) {
  if (!reply || typeof reply !== 'string') {
    const acknowledgement = ensurePreviousCueAcknowledgement('', signal);
    if (options?.witness && typeof options.witness === 'object') {
      options.witness.previousCueAcknowledgementRepaired = acknowledgement.repaired;
    }
    return acknowledgement.text || reply || '';
  }

  // 2026-07-28: a question ABOUT the practice line ("what is the practice
  // sentence?", "repeat the sentence") or "say that again" outranks every
  // routing decision — it is ANSWERED, never coached, on any coachingAction.
  // It also outranks capture repair: on a rejected take the question still
  // gets its answer, which itself re-invites the take. The deterministic
  // answer REPLACES the model text but still flows through the full law
  // pipeline below — the quoted line can be model-authored via card-ops, so
  // it re-crosses every law like any other text.
  const practiceLineAnswer = resolvePracticeLineAnswer(signal);
  const captureRepair = practiceLineAnswer ? null : resolveCaptureRepairReply(signal);
  if (captureRepair) {
    if (options?.witness && typeof options.witness === 'object') {
      options.witness.captureRepairCause = captureRepair.cause;
    }
    return captureRepair.reply;
  }

  let sanitized = practiceLineAnswer ? practiceLineAnswer.reply : reply.trim();
  if (practiceLineAnswer && options?.witness && typeof options.witness === 'object') {
    options.witness.practiceLineCause = practiceLineAnswer.cause;
  }
  const coachingAction = String(signal?.policy?.coachingAction || '').trim().toLowerCase();
  const nonCoachingTurn = coachingAction === 'breather' || coachingAction === 'converse';
  const sessionControlReplacement = nonCoachingTurn ? '' : LOW_EFFORT_CUE;
  // The two 2026-07-26 product laws use the same non-coaching rule: a BREATHER
  // or CONVERSE turn never becomes a technique cue merely because the model
  // proposed homework or an object. 2026-07-28: the code-owned cue names the
  // actual sentence whenever one exists (cueWithLine).
  const lawReplacement = nonCoachingTurn ? '' : cueWithLine(GENERIC_ACTIONABLE_CUE, signal);

  // Step 0 (2026-06-16 fix): strip any residual remember-ops/card-ops fenced block
  // that leaked past the upstream parser-based stripper. A MALFORMED block defeats the
  // parser (it returns null) but the raw "```remember-ops {json}" must NEVER reach the
  // learner/TTS. Fence-presence based, not parse-based; the ops are trailing.
  sanitized = sanitized.replace(/```+\s*(?:remember-ops|card-ops)[\s\S]*$/i, '').trim();

  // Step 1: Remove unsafe content (always)
  sanitized = sanitizeUnsafeContent(sanitized);

  // Step 2: Topic-specific sanitization (v1)
  const avoidTopics = signal?.policy?.avoidTopics || [];
  if (avoidTopics.includes('pitch')) {
    sanitized = sanitizePitchMentions(sanitized);
  }

  // Step 3: Mode-specific sanitization (v1)
  if (signal?.mode === 'conversation_practice' && !signal?.policy?.shouldCorrect) {
    sanitized = sanitizeConversationPractice(sanitized);
  }

  // Step 4 (v2): doNotSay enforcement
  if (Array.isArray(signal?.doNotSay) && signal.doNotSay.length > 0) {
    sanitized = sanitizeDoNotSay(sanitized, signal.doNotSay);
  }

  // Step 5 (v2): gender label stripping
  sanitized = sanitizeGenderLabels(sanitized);

  // Step 6 (v2): prohibited cue stripping
  sanitized = sanitizeProhibitedCues(sanitized);

  // Step 6.5 (2026-06-25): direction-correctness — drop any sentence carrying a
  // cross-direction technique cue (e.g. "lower your larynx" told to an MTF / feminizing
  // learner). The model can emit these at sampling temp; the sanitizer is the contract,
  // so the cue never reaches the learner. If the whole reply was cross-direction, the
  // final empty-check below substitutes a safe neutral cue.
  const _dir = deriveDirection(signal);
  if (_dir && typeof stripCrossDirectionSentences === 'function') {
    const _res = stripCrossDirectionSentences(sanitized, _dir);
    if (_res.stripped) sanitized = _res.text;
  }

  // Step 6.55 (2026-08-01): a single win may name the carried cue as something
  // the learner was doing, but must not promote one co-occurrence into a causal
  // claim. Drop only the offending sentence; the rest of the reply survives.
  const unsupportedCausationResult = sanitizeUnsupportedWinCausation(sanitized, signal, {
    replacement: '',
  });
  sanitized = unsupportedCausationResult.text;
  if (options?.witness && typeof options.witness === 'object') {
    options.witness.unsupportedCausationHits = unsupportedCausationResult.hits;
  }

  // Step 6.6: deterministic no-pressure guard. The model is allowed to offer
  // an optional take, but imperative/question-shaped "one more" language is
  // rewritten before it reaches the learner or TTS.
  const repPressureResult = sanitizeRepPressure(sanitized);
  sanitized = repPressureResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.repPressureHits = repPressureResult.hits;
  }

  // Step 6.65: the coach never owns session lifetime. Actionable coaching turns
  // may replace that wording with a low-effort technique cue. BREATHER and
  // CONVERSE turns remove it without inventing coaching.
  const sessionControlResult = sanitizeSessionControl(sanitized, {
    replacement: sessionControlReplacement,
  });
  sanitized = sessionControlResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.sessionControlHits = sessionControlResult.hits;
  }

  // Step 6.66 (2026-07-26) PRODUCT LAW 1 — HOMEWORK. All practice happens now,
  // in this session, with the tutor. Away-from-session proposals are dropped
  // when the reply still tells the learner what to do, and otherwise rewritten
  // to a code-owned now-action. BREATHER/CONVERSE turns drop without inventing
  // coaching, exactly as the session-control law does.
  const homeworkResult = sanitizeHomework(sanitized, { replacement: lawReplacement });
  sanitized = homeworkResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.homeworkHits = homeworkResult.hits;
  }

  // Step 6.67 (2026-07-26) PRODUCT LAW 2 — EQUIPMENT. Every instruction must be
  // doable this second with only the voice and body; a reply requiring an object
  // is dropped or rewritten the same way.
  const equipmentResult = sanitizeEquipment(sanitized, { replacement: lawReplacement });
  sanitized = equipmentResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.equipmentHits = equipmentResult.hits;
  }

  // Step 6.68 (2026-07-27) PRODUCT LAW 3 — BANNED CUE LEXICON. Runs BEFORE the
  // cue-shape law on purpose: a sentence carrying a quality word is dropped
  // outright, so the cue-shape law never has to decide whether "use a brighter
  // voice" contains an action. Both orders were checked and this one produces
  // one witness code per offence instead of two.
  const cueVocabularyResult = sanitizeCueVocabulary(sanitized, { replacement: lawReplacement });
  sanitized = cueVocabularyResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.cueVocabularyHits = cueVocabularyResult.hits;
  }

  // Step 6.69 (2026-07-27) PRODUCT LAW 4 — CONTRAINDICATED PRACTICES.
  const contraindicatedResult = sanitizeContraindicated(sanitized, { replacement: lawReplacement });
  sanitized = contraindicatedResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.contraindicatedHits = contraindicatedResult.hits;
  }

  // Step 6.695 (2026-07-27) PRODUCT LAW 5 — CUE SHAPE. Last of the three, so it
  // only judges sentences the first two let through.
  const cueShapeResult = sanitizeCueShape(sanitized, { replacement: lawReplacement });
  sanitized = cueShapeResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.cueShapeHits = cueShapeResult.hits;
  }

  // Step 6.696 (2026-07-28) BEGINNER-LANGUAGE LAW — no raw axis nouns (resonance,
  // vocal weight) in spoken output. After the cue-shape law so it judges only
  // sentences that survived it; the core-loop repair below re-cues if this
  // leaves the turn with nothing to do.
  const beginnerJargonResult = sanitizeBeginnerJargon(sanitized, { replacement: lawReplacement });
  sanitized = beginnerJargonResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.beginnerJargonHits = beginnerJargonResult.hits;
  }

  // Step 6.7 (2026-07-18): banned gamification vocabulary — replace with calm
  // adult alternatives (PRACTICE-PHILOSOPHY de-gamification rulings). Always on
  // for coach say-text; conservative word-boundary rules only.
  const vocabResult = sanitizeBannedVocabulary(sanitized);
  sanitized = vocabResult.text;
  if (options && typeof options === 'object' && options.witness && typeof options.witness === 'object') {
    options.witness.vocabHits = vocabResult.hits;
  }

  // Step 6.8: a turn the deterministic policy marked COACH/GENTLE/ADAPT must
  // contain an executable voice action. Run this after the model-text guards so
  // their categorical witnesses remain visible even when the final learner-facing
  // line is replaced. BREATHER and CONVERSE remain deliberately untouched.
  const coreLoopRepair = resolveCoreLoopRepairReply(sanitized, signal);
  if (coreLoopRepair) {
    sanitized = coreLoopRepair.reply;
    if (options?.witness && typeof options.witness === 'object') {
      options.witness.coreLoopRepairCause = coreLoopRepair.cause;
    }
  }

  // Step 6.9: canonical preferences are runtime contracts, not prompt hints.
  // Enforce concrete wording, tone shape, and a single correction where asked.
  sanitized = applyPreferenceContract(sanitized, signal);

  // Final safety pass: every post-filter repair and preference rewrite must
  // cross the same boundary before it can reach SSE or TTS.
  sanitized = sanitizeUnsafeContent(sanitized);
  if (avoidTopics.includes('pitch')) {
    sanitized = sanitizePitchMentions(sanitized);
  }
  if (Array.isArray(signal?.doNotSay) && signal.doNotSay.length > 0) {
    sanitized = sanitizeDoNotSay(sanitized, signal.doNotSay);
  }
  sanitized = sanitizeGenderLabels(sanitized);
  sanitized = sanitizeProhibitedCues(sanitized);
  if (_dir && typeof stripCrossDirectionSentences === 'function') {
    sanitized = stripCrossDirectionSentences(sanitized, _dir).text;
  }
  sanitized = sanitizeUnsupportedWinCausation(sanitized, signal, { replacement: '' }).text;
  sanitized = sanitizeSessionControl(sanitized, {
    replacement: sessionControlReplacement,
  }).text;
  // The product laws re-run here for the same reason session-control does: a
  // post-filter repair or a preference rewrite must not be able to reintroduce
  // homework or an object after the first pass cleared it.
  sanitized = sanitizeHomework(sanitized, { replacement: lawReplacement }).text;
  sanitized = sanitizeEquipment(sanitized, { replacement: lawReplacement }).text;
  // The 2026-07-27 cue laws re-run for the same reason: resolveCoreLoopRepairReply
  // and applyPreferenceContract both run AFTER the first pass and both can
  // insert or reshape a sentence, so without this a repaired reply could carry a
  // quality word straight to SSE/TTS.
  sanitized = sanitizeCueVocabulary(sanitized, { replacement: lawReplacement }).text;
  sanitized = sanitizeContraindicated(sanitized, { replacement: lawReplacement }).text;
  sanitized = sanitizeCueShape(sanitized, { replacement: lawReplacement }).text;
  // The beginner-language law re-runs for the same reason the cue laws do.
  sanitized = sanitizeBeginnerJargon(sanitized, { replacement: lawReplacement }).text;
  // LAST, after every repair and rewrite, so nothing downstream can put the
  // learner's name back into the spoken line.
  sanitized = stripLearnerVocative(sanitized, signal);

  if (!sanitized || sanitized.length < 2) {
    sanitized = resolveActionFallback(signal);
  }

  // Step 7: sentence-safe spoken length and cue-count bound. Never truncate a
  // word or leave the tutor cut off mid-sentence.
  sanitized = boundSpokenReply(sanitized, signal);

  // Step 7.1: the real model may ignore PreviousCueAction even when the prompt
  // is explicit. Enforce the finite-map learner-facing postcondition AFTER the
  // sentence/word clamp, because a third-sentence action or a low word budget
  // must not silently erase it. This postcondition deliberately outranks the
  // generic spoken budget for the one short, code-owned acknowledgement.
  const previousCueAcknowledgement = ensurePreviousCueAcknowledgement(sanitized, signal);
  sanitized = previousCueAcknowledgement.text;
  if (options?.witness && typeof options.witness === 'object') {
    options.witness.previousCueAcknowledgementRepaired = previousCueAcknowledgement.repaired;
  }

  // Step 8: Capitalize first letter
  if (sanitized) {
    sanitized = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
  }

  // If everything got stripped, use an action-aware finite fallback. A
  // non-coaching turn never becomes a technique cue merely because the model
  // emitted forbidden session-control language.
  if (!sanitized || sanitized.length < 2) {
    return resolveActionFallback(signal);
  }

  return sanitized;
}

module.exports = {
  sanitizeCoachReply,
  sanitizeUnsafeContent,
  stripLearnerVocative,
  sanitizePitchMentions,
  sanitizeConversationPractice,
  sanitizeDoNotSay,
  sanitizeGenderLabels,
  sanitizeProhibitedCues,
  sanitizeRepPressure,
  sanitizeSessionControl,
  sanitizeHomework,
  sanitizeEquipment,
  sanitizeCueVocabulary,
  sanitizeContraindicated,
  sanitizeCueShape,
  sanitizeUnsupportedWinCausation,
  ensurePreviousCueAcknowledgement,
  sanitizeBeginnerJargon,
  sanitizeBannedVocabulary,
  applyPreferenceContract,
  boundSpokenReply,
  resolveCoreLoopRepairReply,
  resolveCaptureRepairReply,
  resolvePracticeLineAnswer,
  cueWithLine,
  quotePracticeLine,
  buildDoNotSayRegex,
  BANNED_VOCAB_RULES,
  REP_PRESSURE_RULES,
  SESSION_CONTROL_PATTERNS,
  HOMEWORK_RULES,
  EQUIPMENT_RULES,
  CUE_VOCABULARY_RULES,
  CONTRAINDICATED_RULES,
  CUE_SHAPE_RULES,
  UNSUPPORTED_WIN_CAUSATION_RULES,
  BEGINNER_JARGON_RULES,
  CUE_BODY_REFERENT_PATTERN,
  VOICE_QUALITY_PATTERN,
  VOICE_ABSTRACT_PATTERN,
  APP_SURFACE_PATTERN,
  ACTIONABLE_VOICE_PATTERN,
  BODY_PART_TERMS,
  MOVEMENT_TERMS,
  SENSATION_TERMS,
  VOICE_QUALITY_TERMS,
  VOICE_OBJECT_TERMS,
  VOICE_ABSTRACT_TERMS,
  SAFE_FALLBACK,
  LOW_EFFORT_CUE,
  GENERIC_ACTIONABLE_CUE,
};
