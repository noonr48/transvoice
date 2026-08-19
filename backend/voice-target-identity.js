'use strict';

const crypto = require('node:crypto');

const TARGET_KEY_VERSION = 'vt1';
const TARGET_KEY_PATTERN = /^vt1:[a-f0-9]{64}$/;
const CUSTOM_TARGET_SOURCES = new Set(['reference', 'custom', 'custom-reference', 'custom-handmade']);
const REFERENCE_TARGET_SOURCES = new Set(['reference', 'custom-reference']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, limit = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, limit) : '';
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Object.is(number, -0) ? 0 : number;
}

function canonicalizeVoiceTargetSource(value) {
  const source = normalizeText(value, 40).toLowerCase();
  if (source === 'built-in' || source === 'preset' || source === '') return 'built-in';
  if (CUSTOM_TARGET_SOURCES.has(source)) return source;
  return 'unknown';
}

// 2026-07-26 MTF-ONLY: the masculinizing (FTM) direction is retired. `ftm` /
// `masculinizing` / `masculine` no longer resolve — they yield '' so the caller
// pushes `missing_target_direction` and the identity fails CLOSED. They are
// deliberately NOT coerced to 'feminine': substituting a direction the learner
// did not choose would coach the voice the wrong way, which the house law bans.
function canonicalizeDirection(value) {
  const direction = normalizeText(value, 40).toLowerCase();
  if (direction === 'mtf' || direction === 'feminizing') return 'feminine';
  return ['feminine', 'neutral'].includes(direction) ? direction : '';
}

// Retired masculinizing target ids: `masculine`/`masc-deep`/`masc-natural`/
// `masc-warm`/`masc-bright` (the old dataset generator's set) and the bare `ftm`
// direction label.
//
// 2026-07-27 SCOPE RULING (product owner): there is no female-to-male route and
// never was; the only supported direction is male-to-female. A masculinizing
// target is therefore CORRUPT INPUT, not a legacy lane that needs graceful
// handling — the compatibility resolver that used to rewrite it to the neutral
// lane is GONE, along with the four stored sessions that motivated it.
//
// This regex survives for exactly ONE job: `directionFromPreset` must RECOGNISE
// the value in order to REJECT it. Without the test below, `masculine` would hit
// the "anything else is feminine" default and the identity would CLAIM a
// feminizing direction for it — failing open in the one place that must fail
// closed. Nothing else in the codebase reads it.
//
// 2026-07-30: EXTENDED to the two neutral presets, retired with the MTF-only
// narrowing. Same reasoning, same job — they are now corrupt input rather than a
// lane, so the identity layer must recognise them in order to reject them. The
// coverage guard caught this: `voice-retired-target-sweep.test.js` reported
// "custom identity for 'androgynous' must be invalid", because both functions
// below still named the two presets inline and handed back a real direction.
const RETIRED_PRESET_RE = /^(?:masc|ftm|androgynous$|gender-neutral$)/i;

/**
 * Preset -> the COACHING lane's direction.
 *
 * The canonical home for the "which way does this preset push the voice"
 * three-liner that had been re-derived in voice-standalone-runtime
 * (`targetDirectionFromPreset`) with its own regex; it is imported rather than
 * copied so the two cannot drift apart again.
 *
 * EVERY live preset is feminizing (MTF-only since 2026-07-30), so this is now a
 * constant for recognised input, and an unrecognised preset keeps the same
 * historical 'feminine' default because downstream band orientation needs an
 * answer. It is kept as a function, not inlined, because it is the canonical home
 * for this question — it replaced a copy in voice-standalone-runtime that had
 * drifted with its own regex, and inlining it would invite that again.
 *
 * Distinct from `directionFromPreset` below, which is the IDENTITY layer and
 * fails closed to '' instead: claiming a direction on an identity is a stronger
 * act than choosing which cue lane to coach in.
 */
function coachingDirectionFromPreset(_targetPreset) {
  return 'feminine';
}

function directionFromPreset(targetPreset) {
  if (RETIRED_PRESET_RE.test(String(targetPreset || ''))) return '';
  return targetPreset ? 'feminine' : '';
}

function normalizeVoiceTargetKey(value) {
  const key = normalizeText(value, 80).toLowerCase();
  return TARGET_KEY_PATTERN.test(key) ? key : null;
}

function hashIdentity(parts) {
  return `${TARGET_KEY_VERSION}:${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

function resolveVoiceTargetIdentity(input = {}) {
  const targetSource = canonicalizeVoiceTargetSource(input.targetSource ?? input.source);
  const targetPreset = normalizeText(input.targetPreset, 80);
  const targetProfileId = normalizeText(input.targetProfileId, 160) || null;
  const analysisVersion = normalizeText(input.analysisVersion, 120) || null;
  const reasons = [];

  if (targetSource === 'unknown') reasons.push('invalid_target_source');
  if (!targetPreset) reasons.push('missing_target_preset');
  // SCOPE NOTE — read this before assuming built-ins fail closed on the preset.
  // This built-in fast path returns valid:true and echoes `targetPreset` back
  // VERBATIM, so it returns BEFORE the `missing_target_direction` fail-closed
  // check at the bottom of this function. It validates the SOURCE and the
  // PRESENCE of a preset, not the preset's membership in the live enum — that
  // gate lives elsewhere, in two places:
  //   1. the gateway WRITE gates, which are what actually stop an invalid row
  //      being stored: `startVoiceSession` and `updateVoiceSessionPreset` in
  //      voice-standalone-runtime.js both check `PRESET_PROFILES` membership
  //      and throw a 400 before any persist;
  //   2. the analyzer READ gate — `normalize_target_preset` in
  //      services/voice-trainer/src/services/audio_analysis.py raises on an
  //      unknown id.
  // Correction 2026-07-27 (round 5): an earlier revision of this note said the
  // analyzer routers "map it to HTTP 400" as a blanket fact. They do not do it
  // automatically — each route needs its own `except ValueError` arm, and until
  // round 5 /sessions/{id}/end, /take and /take-oneshot had none and returned
  // HTTP 500. See the ROUTER MAPPING paragraph on `get_target_profile` for the
  // enumerated current list.
  //
  // What this path does guarantee is that it never CLAIMS a direction: the
  // built-in targetKey hashes only [version, 'built-in', targetPreset] and no
  // `direction` field is returned, so nothing downstream can read a feminizing
  // direction off an identity whose preset is not feminizing. Fail-closed on
  // direction applies to the CUSTOM path below, via `directionFromPreset`.
  if (targetSource === 'built-in' && reasons.length === 0) {
    return {
      targetKey: hashIdentity([TARGET_KEY_VERSION, 'built-in', targetPreset]),
      targetSource,
      targetPreset,
      targetProfileId: null,
      analysisVersion: null,
      valid: true,
      reasons: [],
    };
  }

  if (!CUSTOM_TARGET_SOURCES.has(targetSource)) {
    return {
      targetKey: null,
      targetSource,
      targetPreset: targetPreset || null,
      targetProfileId,
      analysisVersion,
      valid: false,
      reasons: [...new Set(reasons.length ? reasons : ['invalid_target_source'])],
    };
  }

  const referenceClipId = normalizeText(input.referenceClipId, 160) || null;
  const identityRef = targetProfileId
    ? `profile:${targetProfileId}`
    : REFERENCE_TARGET_SOURCES.has(targetSource) && referenceClipId
      ? `reference:${referenceClipId}`
      : null;
  if (!identityRef) reasons.push('missing_target_profile_identity');

  const direction = canonicalizeDirection(input.direction) || directionFromPreset(targetPreset);
  if (!direction) reasons.push('missing_target_direction');

  const bands = isRecord(input.bands) ? input.bands : input;
  const pitchFloorHz = finite(bands.pitchFloorHz);
  const pitchCeilingHz = finite(bands.pitchCeilingHz);
  const resonanceFloor = finite(bands.resonanceFloor);
  const resonanceCeiling = finite(bands.resonanceCeiling);
  const weightFloor = finite(bands.weightFloor);
  const weightCeiling = finite(bands.weightCeiling);
  const pairs = [
    ['pitch', pitchFloorHz, pitchCeilingHz, 80, 400],
    ['resonance', resonanceFloor, resonanceCeiling, 0, 1],
    ['weight', weightFloor, weightCeiling, 0, 1],
  ];
  for (const [name, floor, ceiling, minimum, maximum] of pairs) {
    if (floor == null || ceiling == null) {
      reasons.push(`missing_target_${name}_band`);
    } else if (floor < minimum || ceiling > maximum || floor >= ceiling) {
      reasons.push(`invalid_target_${name}_band`);
    }
  }

  if (reasons.length > 0) {
    return {
      targetKey: null,
      targetSource,
      targetPreset: targetPreset || null,
      targetProfileId,
      analysisVersion,
      valid: false,
      reasons: [...new Set(reasons)],
    };
  }

  return {
    targetKey: hashIdentity([
      TARGET_KEY_VERSION,
      targetSource,
      targetPreset,
      identityRef,
      direction,
      pitchFloorHz,
      pitchCeilingHz,
      resonanceFloor,
      resonanceCeiling,
      weightFloor,
      weightCeiling,
      analysisVersion || 'unversioned',
    ]),
    targetSource,
    targetPreset,
    targetProfileId,
    analysisVersion,
    valid: true,
    reasons: [],
  };
}

function resolveVoiceTargetIdentityFromAttempt(summary = {}, voiceState = {}) {
  const normalizedSummary = isRecord(summary) ? summary : {};
  const normalizedState = isRecord(voiceState) ? voiceState : {};
  const target = isRecord(normalizedSummary.target) ? normalizedSummary.target : {};
  const profile = isRecord(normalizedState.targetVoiceProfile) ? normalizedState.targetVoiceProfile : {};
  const value = (name) => finite(target[name]) ?? finite(profile[name]);
  return resolveVoiceTargetIdentity({
    targetSource: target.source ?? normalizedState.targetSource,
    targetPreset: target.targetPreset ?? normalizedSummary.targetPreset ?? normalizedState.targetPreset,
    targetProfileId: target.targetProfileId ?? profile.profileId,
    referenceClipId: normalizedSummary.referenceClipId ?? normalizedState.referenceClipId ?? profile.clipId,
    direction: target.direction ?? profile.direction ?? normalizedState.profile?.direction,
    analysisVersion: target.analysisVersion ?? profile.analysisVersion ?? normalizedSummary.analysisVersion,
    pitchFloorHz: value('pitchFloorHz'),
    pitchCeilingHz: value('pitchCeilingHz'),
    resonanceFloor: value('resonanceFloor'),
    resonanceCeiling: value('resonanceCeiling'),
    weightFloor: value('weightFloor'),
    weightCeiling: value('weightCeiling'),
  });
}

function isVoiceRecordComparableToTarget(record, identity) {
  if (!isRecord(record) || !identity?.valid || !identity.targetKey) return false;
  const rawKey = normalizeText(record.targetKey, 80);
  const recordKey = normalizeVoiceTargetKey(rawKey);
  if (rawKey) return recordKey === identity.targetKey;
  if (identity.targetSource !== 'built-in') return false;
  const recordSource = canonicalizeVoiceTargetSource(record.targetSource ?? record.source);
  return (recordSource === 'built-in')
    && normalizeText(record.targetPreset, 80) === identity.targetPreset;
}

module.exports = {
  TARGET_KEY_VERSION,
  canonicalizeDirection,
  canonicalizeVoiceTargetSource,
  coachingDirectionFromPreset,
  normalizeVoiceTargetKey,
  resolveVoiceTargetIdentity,
  resolveVoiceTargetIdentityFromAttempt,
  isVoiceRecordComparableToTarget,
};
