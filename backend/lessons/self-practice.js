'use strict';

/**
 * SELF-PRACTICE MENU (2026-07-29)
 *
 * The owner's ruling: "let's make that a separate self practice mode from the
 * tutor. when the tutor is there, the user is there to speak and communicate
 * with the tutor." Self-practice is for "like 2 mintues free before heading out
 * the houre or waiting for the bus" — its job is to "simply remind them of the
 * exercises they can do".
 *
 * SO THIS MODULE ANSWERS EXACTLY ONE QUESTION: which sounds can this learner do,
 * right now, where they are standing? It deliberately does NOT:
 *   - require any tutor or session state (that is the whole point of the mode)
 *   - score, grade, or judge anything (the surface may add a silent meter later;
 *     whether it does is an open owner decision, and nothing here presumes it)
 *   - offer any drill needing a prop (`needsNothing` is enforced, not assumed)
 *   - offer anything with words in it — under the two-mode split the tutor owns
 *     every rung from the syllable up
 *
 * WHERE THE CONTENT COMES FROM. Nothing is authored here. The five zero-prop
 * vocalises already exist in backend/voice-drills.js with `needsNothing: true`
 * as a machine-checkable guarantee, per-preset cue registers, and a `tier`
 * marking which sessions may surface them. This module filters and reshapes;
 * inventing a sixth exercise here would put coaching content outside the pack
 * that the register laws are enforced against.
 */

const { getVoiceDrillPack, listVoiceDrillPresetKeys } = require('../voice-drills');

/**
 * Kinds that are a pure SOUND. Mirrors sound-landed.js and
 * sentence-progression.js — a drill outside this set has words in it and
 * belongs to the tutor.
 */
const SELF_PRACTICE_KINDS = new Set([
  'siren',
  'hum_sovt',
  'sustained',
  'resonance_play',
  'trill',
]);

/**
 * THE AXIS IS LOUDNESS, NOT LOCATION. Owner ruling 2026-07-29: "just make sure
 * the practices don't need to be too loud", after correctly objecting that a
 * siren "breaks that boundary" because "one of the most difficult things a
 * person has to face is dealing with loud vocalisations. they are shy and
 * uncomfortable of their own voice."
 *
 * AN EARLIER VERSION OF THIS MODULE GOT THE MODEL WRONG. It gated on WHERE the
 * learner was (bus stop vs home) and treated "needs no equipment" as if it were
 * the same thing as "low friction". It is not: a siren needs nothing and is
 * still among the most exposing things you can ask a self-conscious person to
 * do, at home as much as at a bus stop. Location was only ever a proxy for
 * loudness, and a bad one — it made the AT-HOME default the loudest list.
 *
 * SO: quiet is the default, everywhere. A practice must have a way to be done
 * quietly to be offered at all. Being loud is something the learner opts into
 * on a day they feel like it, never something the app hands them.
 */
const DEFAULT_ALLOW_LOUD = false;

/**
 * A drill is quiet-capable when its own tier says so. `tier: 'both'` means the
 * pack author marked it workable quietly; `'full'` means it needs full voice.
 * The `private` tag is honoured as a second, independent veto so a drill can be
 * excluded from public practice without changing its tier.
 */
function isQuietCapable(drill) {
  const tier = typeof drill.tier === 'string' ? drill.tier : '';
  if (tier === 'full') return false;
  if (Array.isArray(drill.tags) && drill.tags.includes('private')) return false;
  return tier === 'both' || tier === 'quiet';
}

/**
 * The menu entry. Deliberately small: a name, what it is for, the sound itself,
 * and ONE cue. The full cue list is the tutor's register — a two-minute reminder
 * that opens with three paragraphs is not a reminder.
 */
/**
 * ONE cue, and the QUIET one unless the learner asked to be loud.
 *
 * A drill's `cues[0]` is its primary framing — and for the siren that framing is
 * FULL VOICE: "come down until it is full again". The packs already author the
 * quiet adaptation ("Keeping it quiet? Make it three small steps on a tiny hum")
 * and mark it with `quietCueIndex`. The repo's own vocalise contract test
 * asserts the siren "carries the small three-step version" precisely because
 * that cue is what MAKES it quiet-capable.
 *
 * The quiet cue is now the DEFAULT rather than the public-place special case:
 * someone practising at home who is shy of their own voice needs the tiny
 * version just as much as someone at a bus stop does.
 */
function pickCue(drill, allowLoud) {
  const cues = Array.isArray(drill.cues) ? drill.cues : [];
  if (!cues.length) return null;
  if (!allowLoud && Number.isInteger(drill.quietCueIndex)) {
    const quiet = cues[drill.quietCueIndex];
    if (typeof quiet === 'string' && quiet.trim()) return quiet;
  }
  return cues[0];
}

/**
 * Whether a drill may appear in the menu at all. Exported so a test can present
 * a drill that LACKS the zero-prop guarantee — every real vocalise carries it,
 * so a test that only inspects the shipped pack cannot prove the flag is read.
 */
function isOfferable(drill, allowLoud) {
  if (!drill || !SELF_PRACTICE_KINDS.has(drill.kind)) return false;
  // The zero-prop guarantee is ENFORCED, not trusted. Strict `=== true`: a
  // truthy-but-not-true value is a data mistake, not consent to send someone
  // hunting for a straw.
  if (drill.needsNothing !== true) return false;
  // A practice with NO quiet path is not self-practice. Small-voice/big-voice
  // needs the big half to be the exercise; a lip trill is a brrr. Both are real
  // work — they belong in a session the learner chose to start, not in the list
  // that is supposed to cost nothing to open.
  return allowLoud === true || isQuietCapable(drill);
}

function toMenuEntry(drill, allowLoud) {
  return {
    id: drill.id,
    kind: drill.kind,
    title: drill.title,
    focus: drill.focus,
    // The sound to make, e.g. 'mmm—ooo, up and over, down and home'.
    phrase: drill.phrase,
    cue: pickCue(drill, allowLoud),
    difficulty: drill.difficulty || null,
    quietCapable: isQuietCapable(drill),
  };
}

/**
 * The self-practice menu for a preset.
 *
 * @param {object} args
 * @param {string} args.presetKey   the learner's selected voice preset
 * @param {boolean} [args.allowLoud] opt in to full-voice work. Default FALSE.
 * @returns {Array<object>} menu entries; empty when the preset is unknown
 */
function listSelfPracticeDrills({ presetKey, allowLoud } = {}) {
  // Strict `=== true`. Anything else — omitted, null, '', 'yes', 1 — stays
  // quiet. Loud is opted into explicitly or not at all; a confused caller must
  // never be the reason someone is handed a lip trill.
  const loud = allowLoud === true ? true : DEFAULT_ALLOW_LOUD;

  // NO SILENT PRESET FALLBACK. getVoiceDrillPack defaults an unknown preset to
  // cute-feminine so the tutor is never left with nothing — sensible there, and
  // wrong here. An unrecognised preset means the caller is confused, and a menu
  // the learner opened deliberately should show nothing rather than quietly
  // substitute a target they did not pick. Showing nothing is obviously broken
  // and therefore recoverable; showing the wrong target is not.
  if (!listVoiceDrillPresetKeys().includes(presetKey)) return [];

  const pack = getVoiceDrillPack(presetKey);
  if (!Array.isArray(pack)) return [];

  return pack
    .filter((drill) => isOfferable(drill, loud))
    .map((drill) => toMenuEntry(drill, loud));
}

module.exports = {
  listSelfPracticeDrills,
  isQuietCapable,
  isOfferable,
  SELF_PRACTICE_KINDS,
};
