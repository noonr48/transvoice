'use strict';

/**
 * section-loop — the sentence-teardown isolation loop (phase C).
 *
 * PURPOSE. Phase B taught the coach WHICH 1-3 word fragment of a spoken line came
 * out weakest (coaching/section-scorer.js -> `signal.takeSections.worst`). It could
 * only ever mention it. This module is the pedagogy that USES it: when a fragment
 * is confidently wrong, the tutor takes it apart WITH the learner, live —
 *
 *   1. the practice card is replaced by the fragment alone (1-3 words);
 *   2. the coach announces the isolation (LLM-phrased, warm);
 *   3. the learner re-speaks just the fragment;
 *   4. the fragment is re-scored on ONE axis;
 *   5. clean -> reassemble: the whole line comes back and the coach invites it;
 *      not clean -> ONE engine-authored physical cue, and go round again;
 *   6. after at most MAX_ATTEMPTS fragment takes the loop exits WARMLY, always.
 *
 * Nobody is sent away, nothing is fetched, everything is grounded in the take that
 * just happened.
 *
 * =====================================================================
 * WHY THIS MODULE IS PURE, AND WHERE THE STATE ACTUALLY LIVES
 * =====================================================================
 * `resolveSectionLoopTurn` is a total, side-effect-free transition function:
 * (previous loop state + this turn's CoachingSignal) -> (next loop state + what the
 * turn should DO). It owns no clock it cannot be handed, no card store, no logger.
 *
 * The loop state is persisted by the runtime on `voiceState.sectionLoop`
 * (voice-session-state.js), and the CARD is swapped by the runtime through the
 * existing practice-card store (lessons/practice-cards.js). That split is
 * deliberate: signal-builder is a pure builder and must not mutate session state,
 * and voice-standalone-runtime.js is already 8.5k lines. Putting the decision here
 * means both coach paths (buffered `coachingTurn` and the streaming SSE path) reach
 * the SAME transition table instead of drifting.
 *
 * =====================================================================
 * THE WARMTH LAWS, AND EXACTLY WHERE EACH ONE IS ENFORCED
 * =====================================================================
 *   - "cap isolation at 2-3 attempts"          -> MAX_ATTEMPTS = 3, `exited_cap`.
 *   - "exit warmly on cap, never nag"          -> SECTION_LOOP_CAP_EXIT, a
 *                                                 code-owned spoken line; the loop
 *                                                 is cleared and the full line
 *                                                 returns in the same turn.
 *   - "never repeat the same cue twice"        -> `usedCueIds` (see the field note
 *                                                 below) + pickSectionCue.
 *   - "learner can always speak the full line" -> looksLikeFullLine ->
 *                                                 `exited_full_line`, silently.
 *   - "never enter during capture repair or
 *      safety states"                          -> canEnterSectionLoop, and the same
 *                                                 test applied to an ACTIVE loop as
 *                                                 `exited_safety`.
 *   - "everything grounded in the current take"-> a turn with no NEW take HOLDS: it
 *                                                 costs no attempt and issues no
 *                                                 cue (see the take-key note).
 *
 * =====================================================================
 * THREE FIELDS BEYOND THE STATED STATE SHAPE, AND WHY EACH IS LOAD-BEARING
 * =====================================================================
 * The contract shape is { phrase, tokenStart, tokenEnd, fragmentText, axis,
 * attempts, maxAttempts, enteredAt, lastCueId }. Three fields are added:
 *
 *   `usedCueIds`  — `lastCueId` alone only blocks a BACK-TO-BACK repeat. The law is
 *                   "never repeat the same cue twice" across the whole loop, and a
 *                   3-attempt loop issues 2 cues, so the set of already-spent cues
 *                   is what the law actually needs. `lastCueId` is kept because it
 *                   is the contract and is the useful one-field witness.
 *   `lastTakeKey` — identity of the take this loop last EVALUATED. Without it a
 *                   turn carrying no new take (the learner asked a question mid-
 *                   isolation) would be scored as a failed fragment attempt and
 *                   burn the cap for saying nothing. It is also what makes "no
 *                   re-enter on the same take" expressible at all.
 *   `direction`   — which side of the band the fragment fell on. Carried for the
 *                   witness and the entry prompt; the CUE TABLE is deliberately
 *                   direction-free (see the table's own note).
 *
 * Pure module: no I/O, no requires. Every entry point is total — malformed input
 * returns a no-op result, never a throw.
 */

const AXES = Object.freeze(['pitch', 'resonance', 'weight']);
const BAND_DIRECTIONS = Object.freeze(['under', 'over']);

/**
 * The isolation cap. THREE fragment takes, then a warm exit — the owner's
 * "cap isolation at 2-3 attempts", taken at its upper bound because attempt 1 is
 * often just the learner finding the fragment rather than a real try.
 */
const MAX_ATTEMPTS = 3;

/** A fragment is at most three words (mirrors section-scorer MAX_FRAGMENT_TOKENS). */
const MAX_FRAGMENT_TOKENS = 3;

/**
 * Which per-turn coaching actions may START a teardown.
 *
 * `gentle` is deliberately EXCLUDED. It fires when the learner has explicitly asked
 * to ease off ("go easy on me", "take it slow" — policy-gates isEaseOffRequest), and
 * taking their sentence apart is the opposite of easing off. `breather` and
 * `converse` are excluded for the obvious reason: neither is a correcting turn.
 */
const ISOLATION_ACTIONS = new Set(['coach', 'adapt']);

// ---------------------------------------------------------------------------
// THE ENGINE-AUTHORED RETRY CUE TABLE
// ---------------------------------------------------------------------------
//
// LATENCY LAW. A retry inside the loop must not cost an LLM round-trip: the learner
// has just spoken two words and is waiting to speak them again. So every retry cue
// is picked from this closed table, deterministically. The LLM still phrases the
// ENTRY turn and the REASSEMBLY turn, where warmth and context matter and one
// round-trip is affordable.
//
// DIRECTION LAW — WHY NO CUE NAMES A DIRECTION.
// Each cue is chosen from the AXIS alone, never from which side of the band the
// fragment fell on, and each is phrased so it survives the cross-direction stripper
// (sanitizer Step 6.5) in BOTH directions. That is not timidity, it is the
// documented failure mode of this codebase: a cue that says "let those words step
// up a little" is a feminizing device, so for a learner the stripper reads as
// going the other way the whole SENTENCE is deleted and the turn collapses to an
// acknowledgment with no action in it (measured against a masculinizing learner
// before the 2026-07-26 MTF-only cut; the law is kept because the stripper still
// runs and a NEUTRAL-target learner still must not be pushed either way — see
// sanitizer.js cueForDueReview's note, and renderer-client.js's direction-neutral
// exemplar note). An engine cue that can be deleted is not an engine cue.
//
// What replaces the direction is the PHYSICAL SETUP that makes the learner's own
// band reachable: the jaw, the tongue, the soft palate, the shoulders, the neck,
// the onset, a hand on the chest or the throat. The learner already knows which way
// they are going; the card and the coach's entry line carry the target. This is
// exactly the whole-body register the owner asked for ("it's probably not mouth
// clues, either but think about body posture, or just physical way for us to get
// closer to our goal") and that renderer-client.js teaches the model.
//
// EVERY ENTRY IS PROVEN, NOT ASSERTED. section-loop.test.js runs all twelve through
// sanitizeCoachReply for a feminizing signal, a neutral signal and a
// direction-less signal and requires byte-identical output, and through the
// content-law tier (HOMEWORK_RULES + EQUIPMENT_RULES + the content-only rules).
// One candidate was caught this way and rewritten: "Unlock the jaw..." was silently
// rewritten to "Open up the jaw..." by the gamification vocabulary guard
// (BANNED_VOCAB_RULES treats `unlock` as game language), so the table says "loosen"
// and "release". Do not hand-edit a cue without re-running that test.
//
// FOUR per axis, not three: the loop issues at most two cues, and four leaves room
// to retire one without dropping below the no-repeat requirement.
const SECTION_CUES = Object.freeze({
  pitch: Object.freeze([
    Object.freeze({
      id: 'pitch_jaw_anchor',
      text: 'Let the jaw hang loose and say just those words with a soft, gentle start, so they settle where the first word of the line sat.',
    }),
    Object.freeze({
      id: 'pitch_neck_long',
      text: 'Keep the neck long and the shoulders soft, then say those words again — nothing in the jaw or throat should tighten as they go.',
    }),
    Object.freeze({
      id: 'pitch_hand_chest',
      text: 'Rest a hand on your chest and say just those words, keeping the buzz under your palm steady from the first sound to the last.',
    }),
    Object.freeze({
      id: 'pitch_tongue_floor',
      text: 'Let the tongue lie wide and easy along the floor of the mouth, and carry those words on one even line.',
    }),
  ]),
  resonance: Object.freeze([
    Object.freeze({
      id: 'res_tongue_teeth',
      text: 'Say just those words with the tongue body raised close behind the top teeth, and let the jaw stay loose while it does.',
    }),
    Object.freeze({
      id: 'res_lip_spread',
      text: 'Spread the lips into the beginning of a smile and hold that exact shape through every one of those words.',
    }),
    Object.freeze({
      id: 'res_soft_palate',
      // 2026-07-30 verifiability pass: was "Lift the soft palate the way it lifts
      // on an 'ng', then keep it lifted while you speak those words." A HELD soft
      // palate is not something the learner can detect, so the cue asked for a
      // state she cannot check — a hard C2 failure in an eyes-free product. The
      // "ng" anchor is kept (she already owns that sound); what she now holds is
      // the TONGUE position the "ng" leaves behind, which is palpable against the
      // teeth. Id unchanged — it is a rotation key, never rendered.
      text: 'Start those words from a small "ng" — the sound at the end of "sing" — and keep the tongue where the "ng" leaves it as the words come out.',
    }),
    Object.freeze({
      id: 'res_jaw_loose',
      text: 'Loosen the jaw so it hangs freely, then say those words without letting the tongue drop down with it.',
    }),
  ]),
  weight: Object.freeze([
    Object.freeze({
      id: 'wt_soft_onset',
      // The onset exemplar the renderer prompt and sanitizer cueForDueReview already
      // use, with a body part added: the register law is "a PHYSICAL ACTION of a
      // named BODY PART", and the original names the sensation without naming the
      // articulator doing it.
      text: 'Start each of those words on a tiny, gentle "uh" — the small catch just before a cough — with the jaw loose, so no air escapes ahead of the sound.',
    }),
    Object.freeze({
      id: 'wt_shoulders',
      text: 'Let the shoulders drop away from your ears and release the jaw, then speak those words with nothing extra behind them.',
    }),
    Object.freeze({
      id: 'wt_easy_effort',
      text: 'Say those words at an easier effort than you just used, keeping the lips and jaw moving exactly as much as before.',
    }),
    Object.freeze({
      id: 'wt_hand_throat',
      text: 'Rest a hand at the front of your throat and speak those words, keeping everything under your fingers still and unhurried.',
    }),
  ]),
});

/**
 * The warm exit. Spoken verbatim when the attempt cap is reached.
 *
 * Reads as "that had its go, now the whole thing" — never as a verdict on the
 * learner and never as a nag, which is the failure class the owner named. It also
 * carries a real action (take the line, jaw loose, shoulders soft) so the turn is
 * not an empty acknowledgment, and it is short enough to survive boundSpokenReply
 * untouched. Same proof obligation as the cue table: section-loop.test.js runs it
 * through the runtime pipeline in both directions and the content-law tier.
 */
const SECTION_LOOP_CAP_EXIT = 'Those words have had their turn — say the whole practice sentence again, keeping the jaw loose and the shoulders soft from the first word to the last.';

/**
 * Full-line detection thresholds.
 *
 * The learner may always answer an isolation by speaking the WHOLE line instead;
 * the tutor honors that rather than insisting. Two conditions, because either alone
 * misfires: a bare "longer than the fragment" fires on a two-word aside, and a bare
 * "most of the phrase" fires when the fragment is already most of a short phrase.
 *
 * COVERAGE = 0.75, measured against the real phrase lengths rather than chosen for
 * roundness. The drill packs run 3-8 words with a median of 5, and a fragment is
 * 1-3. So on the median line (5 words, 1-word fragment) the bar is 4 spoken words:
 * a genuine whole line is 5 and survives one dropped ASR word; on the longest line
 * (8 words, 3-word fragment) the bar is 6 and survives two. The value it was moved
 * UP from is 0.6, which put the bar at 3 on the median line and honored
 * "brown fox ran" — a stumble past the fragment, not the whole sentence — as though
 * the learner had chosen to take the line.
 *
 * The asymmetry is deliberate in the lenient direction. A false POSITIVE ends an
 * isolation a beat early; a false NEGATIVE scores the whole line's audio against a
 * one-word fragment's axis and then cues the learner for it — which is the "force"
 * failure the leniency law exists to prevent.
 */
const FULL_LINE_MIN_EXTRA_WORDS = 2;
const FULL_LINE_COVERAGE = 0.75;
/**
 * Fraction of the line's NON-fragment words that must actually be heard. Length
 * alone cannot distinguish the line from a spoken question of the same length —
 * "how did that sound" is four words against a five-word line and cleared every
 * count threshold. Half rather than all, so a dropped or mis-heard ASR word does not
 * cost the learner the leniency this check exists to give them.
 */
const FULL_LINE_WORD_MATCH = 0.5;

/** Statuses that mean "this axis landed inside the band on this take". */
const AXIS_CLEAN_STATUS = Object.freeze({
  pitch: 'in_band',
  resonance: 'target',
  weight: 'target',
});

/**
 * Statuses that carry NO verdict about the axis. `uncertain` is the measurement
 * refusing to speak; pitch `unstable` is a spread verdict, not an in/out-of-band
 * one, so it must not be read as either success or failure evidence.
 */
const AXIS_UNMEASURED_STATUSES = Object.freeze(new Set(['uncertain', 'unstable']));

function wordsOf(value) {
  return String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean);
}

/** Case- and punctuation-insensitive word key, so "fox," and "Fox" compare equal. */
function normalizeWord(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9']+/g, '');
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function textOf(value, maxLength) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.slice(0, maxLength);
}

/**
 * Stable identity for the take a coach turn is judging.
 *
 * Preference order, and why:
 *   `attemptId`          — the CANONICAL resolved identity that
 *                          voice-session-state normalizeVoiceAttemptArtifact
 *                          stamps on every artifact (explicit id, else the
 *                          summary's, else the artifact id, else a fingerprint of
 *                          the summary). It is the one field guaranteed present
 *                          on a normalized artifact, which is what the runtime
 *                          hands us. NOTE there is no bare `.id` on an artifact —
 *                          reading one would silently fall through to the clock.
 *   `attemptArtifactId`  — an un-normalized artifact (a hand-built test fixture,
 *                          or a payload read before normalization).
 *   `finalized:<ts>`     — the local finalize receipt landFinalizedTake stamps on
 *                          voiceState. Coarser, but it changes on every real take.
 *
 * Returns null when there is no take at all — which the caller reads as "this turn
 * has nothing new to score", NOT as "the same take again". That distinction is what
 * stops a mid-isolation question from spending an attempt.
 */
function resolveTakeKey(voiceState) {
  if (!voiceState || typeof voiceState !== 'object') return null;
  const artifact = voiceState.lastAttemptArtifact;
  for (const candidate of [artifact?.attemptId, artifact?.attemptArtifactId, artifact?.clientAttemptId]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 160);
  }
  const finalizedAt = Number(voiceState.lastTakeFinalizedAt);
  if (Number.isFinite(finalizedAt) && finalizedAt > 0) return `finalized:${finalizedAt}`;
  return null;
}

/**
 * The transcript of the TAKE — what the learner actually SPOKE into the microphone.
 *
 * READ THIS BEFORE CHANGING IT. It is deliberately NOT `signal.userUtterance`, and
 * that distinction is the whole correctness of the full-line check. `userUtterance`
 * is the COACH TURN'S MESSAGE (signal-builder.js:2577 — `userUtterance: userMessage`),
 * which on the app's own post-take route is a fixed engine string:
 *
 *     voice-standalone-runtime.js startAsyncVoiceCoachTask ->
 *     'Give me one concise post-take coaching note for the latest voice attempt.'
 *
 * That is twelve words. Fed to looksLikeFullLine against a one-word fragment of a
 * five-word line it clears both thresholds, so EVERY first fragment take exited the
 * loop as `exited_full_line` — the engine cue table, the warm cap exit and the whole
 * reassembly step were unreachable on the real flow, and the witness lied about why.
 * Caught by review, reproduced, and fixed here. (A typed "how did that sound" — four
 * words — did the same on /voice/coach/runtime.)
 *
 * Sources 1-3 are TAKE-BOUND BY CONSTRUCTION — they live on the take's own record:
 *   1. the attempt artifact's summary transcript (normalized at
 *      voice-session-state.js);
 *   2. a transcript on the artifact itself;
 *   3. the last summary's transcript.
 *
 * Source 4, `voiceInputRuntime.lastTranscript`, is NOT take-bound and must never be
 * used bare. It is the same audio as the take ONLY on the live `/voice/input/turn`
 * path, where phase A dispatches the analyzer take and the ASR on the SAME segment
 * in the same turn. On the PRACTICE-TAKE path it is not: `finalizeVoiceTake` never
 * touches voiceInputRuntime (verified — zero references), the take request body
 * carries no transcript, and the trainer leaves summary/artifact transcript at None.
 * So the field simply retains whatever the LAST spoken turn said.
 *
 * That is not a theoretical gap. Reproduced: the ENTRY take (the whole line) leaves
 * its transcript on voiceInputRuntime; the first FRAGMENT take then lands with no
 * transcript of its own; reading the field bare reported "the learner spoke the
 * whole line" and exited the loop on attempt zero — the original blocker's exact
 * symptom, surviving the binding fix.
 *
 * So source 4 is accepted ONLY when its own timestamp is at or after the take's:
 * an ASR result that predates the take cannot be a transcript OF that take.
 * Timestamps are compared on ONE clock — `lastProcessedAt`/`lastCapturedAt` and
 * `lastTakeFinalizedAt` are all stamped locally — with the artifact's own
 * service-clock `finalizedAt` used only as a last resort.
 *
 * Returns null when the take carries no usable transcript. The caller must then NOT
 * honor a full line: see looksLikeFullLine's fail-closed note. The deliberate
 * asymmetry is that forgoing the full-line leniency costs the learner at most a few
 * extra fragment attempts before the cap exits warmly, whereas a false full-line
 * exit deletes the entire teardown.
 */
function resolveTakeTranscript(voiceState) {
  if (!voiceState || typeof voiceState !== 'object') return null;
  const artifact = voiceState.lastAttemptArtifact;
  const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 400) : null);

  // Sources 1-3: on the take's own record, so no time check is needed or possible.
  for (const candidate of [artifact?.summary?.transcript, artifact?.transcript, voiceState.lastSummary?.transcript]) {
    const text = clean(candidate);
    if (text) return text;
  }

  // Source 4: the live-input ASR — only when it is at least as new as the take.
  const live = clean(voiceState.voiceInputRuntime?.lastTranscript);
  if (!live) return null;
  const input = voiceState.voiceInputRuntime || {};
  const liveAt = Math.max(
    Number.isFinite(Number(input.lastProcessedAt)) ? Number(input.lastProcessedAt) : -Infinity,
    Number.isFinite(Number(input.lastCapturedAt)) ? Number(input.lastCapturedAt) : -Infinity,
  );
  const takeAtCandidates = [voiceState.lastTakeFinalizedAt, artifact?.finalizedAt, artifact?.endedAt];
  const takeAt = takeAtCandidates
    .map((value) => (Number.isFinite(Number(value)) ? Number(value) : null))
    .find((value) => value != null);
  // An untimestamped transcript, or an untimestamped take, cannot be proven to
  // belong together — fail closed rather than guess.
  if (!Number.isFinite(liveAt) || takeAt == null) return null;
  return liveAt >= takeAt ? live : null;
}

/**
 * True when the take's transcript reads as the WHOLE practice line rather than the
 * isolated fragment. Token-count based on purpose: the ASR transcript is the only
 * text this turn has, and word-for-word matching against the card would punish an
 * ordinary mis-hearing of exactly the words we asked for.
 *
 * FAIL CLOSED on an absent transcript. With nothing to measure, "keep isolating" is
 * the safe answer: the attempt cap guarantees a warm exit within MAX_ATTEMPTS either
 * way, so staying in the loop can never trap the learner — whereas honoring on no
 * evidence (which is what a truthy default would do) silently deletes the entire
 * teardown on any path without an ASR leg.
 */
function looksLikeFullLine(utterance, fragmentText, phrase) {
  const spokenWords = wordsOf(utterance);
  const fragmentList = wordsOf(fragmentText);
  const phraseList = wordsOf(phrase);
  const spoken = spokenWords.length;
  const fragmentWords = fragmentList.length;
  const phraseWords = phraseList.length;
  if (spoken === 0 || fragmentWords === 0 || phraseWords === 0) return false;
  // A fragment that IS the line cannot be answered "with the whole line instead".
  if (phraseWords <= fragmentWords) return false;
  // (1) LENGTH: enough words to be more than the fragment, and enough of the line.
  if (spoken < fragmentWords + FULL_LINE_MIN_EXTRA_WORDS) return false;
  if (spoken < Math.ceil(phraseWords * FULL_LINE_COVERAGE)) return false;

  // (2) CONTENT: the words actually have to be THE LINE'S. Length alone cannot tell
  // "the quick brown fox ran" from "how did that sound" — both are four-plus words
  // against a five-word line, and treating a spoken question as a decision to take
  // the whole line ends the isolation for the wrong reason and files a witness that
  // says something untrue. So at least half of the line's words OUTSIDE the fragment
  // must appear in what was said. Half, not all, so an ordinary ASR drop or a
  // mis-heard word does not cost the learner their leniency.
  const fragmentSet = new Set(fragmentList.map(normalizeWord));
  const outside = [...new Set(phraseList.map(normalizeWord))].filter((word) => word && !fragmentSet.has(word));
  if (outside.length === 0) return false;
  const spokenSet = new Set(spokenWords.map(normalizeWord));
  const matched = outside.filter((word) => spokenSet.has(word)).length;
  return matched >= Math.max(1, Math.ceil(outside.length * FULL_LINE_WORD_MATCH));
}

/**
 * Pick the next retry cue for an axis, never reusing one already spent in THIS loop.
 * Total: an unknown axis yields null, and an exhausted table falls back to the first
 * entry rather than returning nothing (a turn with no cue is worse than a repeat,
 * and MAX_ATTEMPTS makes exhaustion unreachable in practice).
 */
function pickSectionCue(axis, usedCueIds = []) {
  const pool = SECTION_CUES[axis];
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const used = new Set((Array.isArray(usedCueIds) ? usedCueIds : []).map((id) => String(id)));
  return pool.find((cue) => !used.has(cue.id)) || pool[0];
}

/**
 * Read this take's verdict for ONE axis off the signal's targetFit block.
 *
 * targetFit is the right source rather than a second run of the section scorer: a
 * fragment card is 1-3 tokens, and section-scorer's localization gate (gate 4)
 * refuses any leader spanning the whole phrase, so a fragment take can never produce
 * a confident section verdict — re-running it there would make success unreachable.
 * targetFit answers exactly the question the loop asks ("did this axis land inside
 * the band on this take?") and is computed behind the same usability gate.
 *
 * Returns { measured, clean, status }.
 */
function readAxisVerdict(signal, axis) {
  const block = signal?.targetFit?.[axis];
  const status = typeof block?.status === 'string' ? block.status : 'uncertain';
  if (signal?.takeQuality?.usable === false || AXIS_UNMEASURED_STATUSES.has(status)) {
    return { measured: false, clean: false, status };
  }
  // 2026-07-27 PITCH-PRESSURE: `in_band` alone does not mean the learner got there
  // with the larynx. Subglottal pressure raises F0 (~2-6 Hz per cmH2O), so a take can
  // land inside the band by PUSHING — loud, effortful, and the documented route to
  // strain. signal-builder attaches pitchPressure.successSuppressed when pitch is
  // in_band AND a strain warning fired AND a second correlate agreed; treating that
  // as a clean exit would end the isolation loop on the one habit most likely to
  // injure the learner. MEASURED: without this branch readAxisVerdict returns
  // clean:true for a pressed take (that is the gap this closes). Only the pitch axis
  // is affected — the witness is pitch-specific and absent on every other take.
  if (axis === 'pitch' && signal?.pitchPressure?.successSuppressed === true) {
    return { measured: true, clean: false, status };
  }
  return { measured: true, clean: status === AXIS_CLEAN_STATUS[axis], status };
}

/**
 * May a teardown START on this turn?
 * Fail-closed: every reason to refuse is named, so the witness can say why.
 */
function canEnterSectionLoop(signal) {
  if (!signal || typeof signal !== 'object') return { ok: false, reason: 'no_signal' };
  const worst = signal.takeSections?.worst;
  if (!worst || worst.confident !== true) return { ok: false, reason: 'no_confident_section' };
  if (!AXES.includes(worst.axis)) return { ok: false, reason: 'unknown_axis' };
  if (!textOf(worst.text, 120)) return { ok: false, reason: 'unnameable_fragment' };
  // Phase C isolates a spoken SENTENCE. A hum, siren, trill or ear-training take has
  // no word-fragment to take apart, and its "sections" would be arbitrary.
  const takeKind = typeof signal.takeKind === 'string' && signal.takeKind ? signal.takeKind : 'phrase';
  if (takeKind !== 'phrase') return { ok: false, reason: 'not_a_phrase_take' };
  if (signal.takeQuality?.usable === false) return { ok: false, reason: 'take_unusable' };
  const policy = signal.policy || {};
  if (policy.safetyState && policy.safetyState !== 'normal') return { ok: false, reason: 'safety_state' };
  if (signal.coachingDecision?.intent === 'repair_capture') return { ok: false, reason: 'capture_repair' };
  if (policy.shouldCorrect !== true) return { ok: false, reason: 'correction_not_permitted' };
  const action = typeof policy.coachingAction === 'string' ? policy.coachingAction : 'coach';
  if (!ISOLATION_ACTIONS.has(action)) return { ok: false, reason: `action_${action}` };
  return { ok: true, reason: null, worst };
}

/**
 * An ACTIVE loop must release the learner the moment the turn stops being a normal
 * correcting turn — a strain/fatigue verdict, a capture repair, or any breather.
 * Holding a fragment card up through a "let's do something gentle" turn is precisely
 * the nagging failure class the warmth laws exist to prevent.
 */
function mustAbortSectionLoop(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const policy = signal.policy || {};
  if (policy.safetyState && policy.safetyState !== 'normal') return 'safety_state';
  if (signal.coachingDecision?.intent === 'repair_capture') return 'capture_repair';
  if (policy.coachingAction === 'breather') return 'breather';
  // `gentle` fires when the learner has explicitly asked to ease off. ISOLATION_ACTIONS
  // already refuses to OPEN a loop on that turn, for the stated reason that taking
  // their sentence apart is the opposite of easing off — so continuing to hold one
  // open breaks the same law. Keeping the asymmetry would mean an ease-off request
  // mid-isolation left the fragment card up and told the model to stay on those
  // words, which is the nag this whole gate exists to prevent. (Review finding.)
  if (policy.coachingAction === 'gentle') return 'ease_off_request';
  return null;
}

/**
 * Why this turn is NOT a fragment attempt — or null when it is one.
 *
 * HOLD is not a weaker abort. It means "nothing about the isolation changed": the
 * loop survives, the fragment card stays up, NO attempt is spent, no cue is spoken,
 * and the model answers the turn normally with the ISOLATING context line.
 *
 * WHY THIS EXISTS AT ALL. The original code held only on "no new take", on the
 * assumption that a turn the learner did not take could be told apart by the take
 * key. On the LIVE coach path that assumption is false: phase A makes every
 * finalized spoken segment an analyzer take, so the take key advances on a spoken
 * QUESTION exactly as it does on a spoken fragment. Reproduced before this fix — an
 * active loop plus "what does that mean" scored the question as a fragment attempt:
 * the learner's question went unanswered, an engine cue was spoken at them instead,
 * attempts went 0 -> 1, and the witness filed `state: retry` with
 * `measurement_usable: true` for an attempt that never happened. Two questions would
 * have eaten the cap.
 *
 * The three reasons, and why each is a hold rather than an exit:
 *   'no_new_take'    — nothing was spoken into this turn at all.
 *   'conversation'   — the app already decided this turn is not a correcting turn
 *                      (CONVERSE, or shouldCorrect false for any other reason). The
 *                      learner asked something; answer it. They have not abandoned
 *                      the fragment, so neither do we.
 *   'not_a_phrase_take' — a hum, siren, trill or ear-training take has no word
 *                      fragment in it. Scoring it as the fragment attempt would
 *                      spend the cap on audio that was never the fragment, and could
 *                      false-exit the loop as a success on unrelated evidence.
 *
 * Safety, capture repair, breather and ease-off are NOT here: those genuinely end
 * the isolation, and mustAbortSectionLoop owns them.
 */
function resolveHoldReason(signal, loop, takeKey) {
  if (!takeKey || takeKey === loop?.lastTakeKey) return 'no_new_take';
  const policy = signal?.policy || {};
  if (policy.coachingAction === 'converse' || policy.shouldCorrect !== true) return 'conversation';
  const takeKind = typeof signal?.takeKind === 'string' && signal.takeKind ? signal.takeKind : 'phrase';
  if (takeKind !== 'phrase') return 'not_a_phrase_take';
  return null;
}

function buildFragmentTokens(fragmentText) {
  return wordsOf(fragmentText).slice(0, MAX_FRAGMENT_TOKENS).map((word) => textOf(word, 40));
}

/**
 * The card spec for the isolated fragment.
 *
 * Tokens are supplied explicitly rather than left to the cue-sheet tokenizer: the
 * fragment must render as exactly the words the scorer blamed, at full emphasis,
 * with no cue-sheet re-interpretation of a three-word stub. Every token carries
 * emphasis 3 because the whole card IS the weak span — there is no unemphasized
 * remainder to contrast with.
 *
 * `source: 'section-loop'` is a backend provenance tag. The frontend's card
 * normalizer keeps only 'tutor'/'fallback' and maps anything else to null
 * (frontend/src/voice/lesson/card.ts), so the strip renders the fragment normally
 * and the fallback auto-speak path stays off — which is what we want here, since the
 * coach's own entry line already names the words.
 */
function buildFragmentCardSpec(sectionLoop, { targetPreset = 'cute-feminine' } = {}) {
  if (!sectionLoop || typeof sectionLoop !== 'object') return null;
  const tokens = Array.isArray(sectionLoop.fragmentTokens) && sectionLoop.fragmentTokens.length > 0
    ? sectionLoop.fragmentTokens
    : buildFragmentTokens(sectionLoop.fragmentText);
  if (tokens.length === 0) return null;
  return {
    phrase: tokens.join(' '),
    focus: { axis: sectionLoop.axis, direction: '', statement: '' },
    difficulty: 'easy',
    source: 'section-loop',
    kind: 'drill',
    tokens: tokens.map((text) => ({ text, emphasis: 3, focusHint: '' })),
    targetPreset,
  };
}

function noopResult(sectionLoop, lastTakeKey) {
  return {
    active: Boolean(sectionLoop),
    sectionLoop: sectionLoop || null,
    lastTakeKey: lastTakeKey || null,
    transition: null,
    hold: Boolean(sectionLoop),
    signalPatch: null,
    deterministicReply: null,
    cardAction: null,
    witness: null,
  };
}

/**
 * THE TRANSITION FUNCTION.
 *
 * @param {object}  input
 * @param {object|null} input.sectionLoop  previous voiceState.sectionLoop
 * @param {string|null} input.lastTakeKey  voiceState.sectionLoopLastTakeKey — the
 *                                         take that closed the previous loop, so it
 *                                         cannot immediately re-open one
 * @param {object}  input.signal           the CoachingSignal built for THIS turn
 * @param {string|null} input.takeKey      identity of the take this turn judges
 *                                         (resolveTakeKey)
 * @param {string|null} input.takeTranscript  what the learner SPOKE on this take
 *                                         (resolveTakeTranscript). NOT the coach
 *                                         turn's message — see that function's note.
 *                                         Absent ⇒ no full-line honor this turn.
 * @param {string}  input.phrase           the FULL practice line, for reassembly
 * @param {number} [input.now]             injectable clock
 *
 * @returns {{
 *   active: boolean, sectionLoop: object|null, lastTakeKey: string|null,
 *   transition: string|null, hold: boolean, signalPatch: object|null,
 *   deterministicReply: string|null, cardAction: 'isolate'|'restore'|null,
 *   witness: object|null
 * }}
 *
 * `deterministicReply` non-null means DO NOT CALL THE MODEL this turn — the reply is
 * already written. `cardAction` tells the runtime to swap the card to the fragment
 * or put the whole line back. `transition` non-null means emit one witness line.
 */
function resolveSectionLoopTurn({
  sectionLoop = null,
  lastTakeKey = null,
  signal = null,
  takeKey = null,
  takeTranscript = null,
  phrase = '',
  now = undefined,
  // Whether the practice strip's active card still belongs to this loop
  // (source 'section-loop', or no active card at all — the same invariant
  // restoreStashedCard enforces). Callers with card-store access compute it;
  // `true` (the default) preserves pure-function behavior for callers without.
  stripOwned = true,
} = {}) {
  const nowValue = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const active = Boolean(sectionLoop && typeof sectionLoop === 'object');

  // ---------------------------------------------------------------- ACTIVE LOOP
  if (active) {
    const loop = sectionLoop;

    // (a) Safety / capture / breather -> release, warmly and silently. No cue is
    // spoken: the turn is ALREADY about to be a gentle or repair turn, and stacking
    // a second instruction on top of it is the nag.
    const abort = mustAbortSectionLoop(signal);
    if (abort) {
      return {
        active: false,
        sectionLoop: null,
        lastTakeKey: takeKey || lastTakeKey || null,
        transition: 'exited_safety',
        hold: false,
        signalPatch: null,
        deterministicReply: null,
        cardAction: 'restore',
        witness: {
          state: 'exited_safety',
          attempts: loop.attempts || 0,
          maxAttempts: loop.maxAttempts || MAX_ATTEMPTS,
          axis: loop.axis || null,
          fragment: loop.fragmentText || null,
          usable: null,
          cueId: null,
          reason: abort,
        },
      };
    }

    // (a2) The strip was taken over mid-loop — a model card-op (create/advance)
    // or any other author replaced the fragment card while the loop was active.
    // Drilling words that are no longer on screen is the half-performed
    // isolation the entry guard exists to refuse, so the loop closes and the
    // NEWER card wins: no restore (mirrors restoreStashedCard's ownership
    // invariant), no cue, attempts frozen. Reviewer-reproduced 2026-07-26.
    if (stripOwned === false) {
      return {
        active: false,
        sectionLoop: null,
        lastTakeKey: takeKey || lastTakeKey || null,
        transition: 'exited_card_takeover',
        hold: false,
        signalPatch: null,
        deterministicReply: null,
        cardAction: null,
        witness: {
          state: 'exited_card_takeover',
          attempts: loop.attempts || 0,
          maxAttempts: loop.maxAttempts || MAX_ATTEMPTS,
          axis: loop.axis || null,
          fragment: loop.fragmentText || null,
          usable: null,
          cueId: null,
          reason: 'card_takeover',
        },
      };
    }

    // (b) This turn is not a fragment attempt — see resolveHoldReason. The loop
    // survives untouched, the fragment card stays up, no attempt is spent, and the
    // model answers normally with the ISOLATING line for context.
    const holdReason = resolveHoldReason(signal, loop, takeKey);
    if (holdReason) {
      return {
        active: true,
        sectionLoop: loop,
        lastTakeKey: lastTakeKey || null,
        transition: null,
        hold: true,
        holdReason,
        signalPatch: {
          isolating: true,
          fragment: loop.fragmentText,
          axis: loop.axis,
          attempts: loop.attempts || 0,
        },
        deterministicReply: null,
        cardAction: null,
        witness: null,
      };
    }

    // (c) The learner answered with the WHOLE line. Honor it: clear the loop
    // silently, put the line back, and let this turn be scored as an ordinary take.
    // No cue, no comment, no "I asked for the fragment" — leniency, never force.
    //
    // Measured against the TAKE'S TRANSCRIPT, never against the coach turn's message
    // — see resolveTakeTranscript's note for the defect that distinction fixes.
    if (looksLikeFullLine(takeTranscript, loop.fragmentText, loop.phrase || phrase)) {
      return {
        active: false,
        sectionLoop: null,
        lastTakeKey: takeKey,
        transition: 'exited_full_line',
        hold: false,
        signalPatch: null,
        deterministicReply: null,
        cardAction: 'restore',
        witness: {
          state: 'exited_full_line',
          attempts: loop.attempts || 0,
          maxAttempts: loop.maxAttempts || MAX_ATTEMPTS,
          axis: loop.axis || null,
          fragment: loop.fragmentText || null,
          usable: null,
          cueId: null,
          reason: 'learner_spoke_full_line',
        },
      };
    }

    // (d) A genuine fragment take. Score ONE axis.
    const verdict = readAxisVerdict(signal, loop.axis);
    const attempts = clampInt(loop.attempts, 0, MAX_ATTEMPTS, 0) + 1;
    const maxAttempts = clampInt(loop.maxAttempts, 1, MAX_ATTEMPTS, MAX_ATTEMPTS);

    // Success needs MEASURED evidence. An unusable take can never exit the loop as a
    // win — it only ever spends an attempt.
    if (verdict.measured && verdict.clean) {
      return {
        active: false,
        sectionLoop: null,
        lastTakeKey: takeKey,
        transition: 'exited_success',
        hold: false,
        signalPatch: {
          reassembling: true,
          fragment: loop.fragmentText,
          axis: loop.axis,
          phrase: loop.phrase || phrase || '',
          attempts,
        },
        deterministicReply: null,
        cardAction: 'restore',
        witness: {
          state: 'exited_success',
          attempts,
          maxAttempts,
          axis: loop.axis,
          fragment: loop.fragmentText,
          usable: true,
          cueId: null,
          reason: verdict.status,
        },
      };
    }

    // Cap reached — warm exit, deterministic line, whole line back on the card.
    if (attempts >= maxAttempts) {
      return {
        active: false,
        sectionLoop: null,
        lastTakeKey: takeKey,
        transition: 'exited_cap',
        hold: false,
        signalPatch: null,
        deterministicReply: SECTION_LOOP_CAP_EXIT,
        cardAction: 'restore',
        witness: {
          state: 'exited_cap',
          attempts,
          maxAttempts,
          axis: loop.axis,
          fragment: loop.fragmentText,
          usable: verdict.measured,
          cueId: null,
          reason: verdict.measured ? verdict.status : 'measurement_unusable',
        },
      };
    }

    // Another go: ONE engine-authored cue, never one already spent in this loop.
    const cue = pickSectionCue(loop.axis, loop.usedCueIds);
    const usedCueIds = [...new Set([...(Array.isArray(loop.usedCueIds) ? loop.usedCueIds : []), ...(cue ? [cue.id] : [])])];
    return {
      active: true,
      sectionLoop: {
        ...loop,
        attempts,
        lastCueId: cue ? cue.id : (loop.lastCueId || null),
        usedCueIds,
        lastTakeKey: takeKey,
      },
      lastTakeKey: lastTakeKey || null,
      transition: 'retry',
      hold: false,
      signalPatch: {
        isolating: true,
        fragment: loop.fragmentText,
        axis: loop.axis,
        attempts,
      },
      deterministicReply: cue ? cue.text : null,
      cardAction: null,
      witness: {
        state: 'retry',
        attempts,
        maxAttempts,
        axis: loop.axis,
        fragment: loop.fragmentText,
        usable: verdict.measured,
        cueId: cue ? cue.id : null,
        reason: verdict.measured ? verdict.status : 'measurement_unusable',
      },
    };
  }

  // ------------------------------------------------------------------- NO LOOP
  const gate = canEnterSectionLoop(signal);
  if (!gate.ok) return noopResult(null, lastTakeKey);

  // Never re-open on the take that just closed a loop. Without this the reassembly
  // turn's own signal — which still carries the entry take's confident section —
  // would immediately isolate the same fragment again, and the take's timeline would
  // then be sliced by the WRONG card's tokens.
  if (!takeKey || (lastTakeKey && takeKey === lastTakeKey)) {
    return noopResult(null, lastTakeKey);
  }

  const worst = gate.worst;
  const fragmentText = textOf(worst.text, 120);
  const fragmentTokens = buildFragmentTokens(fragmentText);
  if (fragmentTokens.length === 0) return noopResult(null, lastTakeKey);

  const nextLoop = {
    phrase: textOf(phrase || signal?.practiceLine || '', 120),
    tokenStart: clampInt(worst.tokenStart, 0, 999, 0),
    tokenEnd: clampInt(worst.tokenEnd, 0, 999, 0),
    fragmentText: fragmentTokens.join(' '),
    fragmentTokens,
    axis: worst.axis,
    direction: BAND_DIRECTIONS.includes(worst.direction) ? worst.direction : null,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    enteredAt: nowValue,
    lastCueId: null,
    usedCueIds: [],
    lastTakeKey: takeKey,
  };

  return {
    active: true,
    sectionLoop: nextLoop,
    lastTakeKey: lastTakeKey || null,
    transition: 'entered',
    hold: false,
    // The ENTRY turn is LLM-phrased: warmth, the learner's own words, and the
    // reason all belong to the model. Only the retries are deterministic.
    signalPatch: {
      entering: true,
      fragment: nextLoop.fragmentText,
      axis: nextLoop.axis,
      direction: nextLoop.direction,
    },
    deterministicReply: null,
    cardAction: 'isolate',
    witness: {
      state: 'entered',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      axis: nextLoop.axis,
      fragment: nextLoop.fragmentText,
      usable: true,
      cueId: null,
      reason: null,
    },
  };
}

module.exports = {
  resolveSectionLoopTurn,
  canEnterSectionLoop,
  mustAbortSectionLoop,
  buildFragmentCardSpec,
  buildFragmentTokens,
  pickSectionCue,
  looksLikeFullLine,
  readAxisVerdict,
  resolveTakeKey,
  resolveTakeTranscript,
  SECTION_CUES,
  SECTION_LOOP_CAP_EXIT,
  MAX_ATTEMPTS,
  MAX_FRAGMENT_TOKENS,
  ISOLATION_ACTIONS,
  AXIS_CLEAN_STATUS,
  FULL_LINE_MIN_EXTRA_WORDS,
  FULL_LINE_COVERAGE,
  FULL_LINE_WORD_MATCH,
  SECTION_LOOP_AXES: AXES,
};
