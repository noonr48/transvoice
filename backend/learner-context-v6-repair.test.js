'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createLearnerContextService,
  LEARNER_CONTEXT_SCHEMA_VERSION,
} = require('./learner-context-service');
const { resolveVoiceTargetIdentity } = require('./voice-target-identity');

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-learner-v6-'));
  const clock = { now: 1_760_000_000_000 };
  const service = createLearnerContextService({
    storageRoot: root,
    now: () => clock.now,
    logger: { warn() {}, log() {} },
  });
  return {
    clock,
    root,
    service,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function customBinding(id, clipId, name = id) {
  const targetVoiceProfile = {
    profileId: `profile-${id}`,
    clipId,
    targetPreset: 'cute-feminine',
    direction: 'feminine',
    analysisVersion: 'voice-metrics-v2',
    pitchFloorHz: 170,
    pitchCeilingHz: 230,
    resonanceFloor: 0.35,
    resonanceCeiling: 0.65,
    weightFloor: 0.25,
    weightCeiling: 0.55,
  };
  const identity = resolveVoiceTargetIdentity({
    targetSource: 'custom-reference',
    targetPreset: targetVoiceProfile.targetPreset,
    targetProfileId: targetVoiceProfile.profileId,
    referenceClipId: clipId,
    direction: targetVoiceProfile.direction,
    analysisVersion: targetVoiceProfile.analysisVersion,
    pitchFloorHz: targetVoiceProfile.pitchFloorHz,
    pitchCeilingHz: targetVoiceProfile.pitchCeilingHz,
    resonanceFloor: targetVoiceProfile.resonanceFloor,
    resonanceCeiling: targetVoiceProfile.resonanceCeiling,
    weightFloor: targetVoiceProfile.weightFloor,
    weightCeiling: targetVoiceProfile.weightCeiling,
  });
  return {
    presetId: id,
    presetName: name,
    referenceClipId: clipId,
    targetPreset: targetVoiceProfile.targetPreset,
    targetSource: 'custom-reference',
    targetKey: identity.targetKey,
    targetProfileId: targetVoiceProfile.profileId,
    analysisVersion: targetVoiceProfile.analysisVersion,
    direction: targetVoiceProfile.direction,
    targetVoiceProfile,
  };
}

function usableAttempt(binding, attemptId, evaluation) {
  const p = binding.targetVoiceProfile;
  return {
    attemptId,
    voiceState: {
      targetPreset: binding.targetPreset,
      targetSource: binding.targetSource,
      referenceClipId: binding.referenceClipId,
      selectedCustomPresetId: binding.presetId,
      selectedCustomPresetName: binding.presetName,
      targetVoiceProfile: p,
    },
    summary: {
      transcript: 'private spoken words that must never persist',
      targetPreset: binding.targetPreset,
      referenceClipId: binding.referenceClipId,
      analysisVersion: binding.analysisVersion,
      target: {
        source: binding.targetSource,
        targetPreset: binding.targetPreset,
        targetProfileId: binding.targetProfileId,
        direction: binding.direction,
        pitchFloorHz: p.pitchFloorHz,
        pitchCeilingHz: p.pitchCeilingHz,
        resonanceFloor: p.resonanceFloor,
        resonanceCeiling: p.resonanceCeiling,
        weightFloor: p.weightFloor,
        weightCeiling: p.weightCeiling,
      },
      metrics: {
        meanPitchHz: 195,
        pitchRangeSt: 4,
        resonanceMean: 0.5,
        weightMean: 0.4,
        targetHitPct: 0.8,
        advanced: {
          measurementAvailable: true,
          scoreConfidence: 0.92,
          voicedFramePct: 0.85,
          captureReliability: 0.9,
          reliabilityFlags: [],
          measurementRejectionReasons: [],
        },
      },
    },
    evaluations: [evaluation],
  };
}

test('schema v6 keeps one canonical target binding and isolates learning by target', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const a = customBinding('preset-a', 'clip-a', 'Aster');
  const b = customBinding('preset-b', 'clip-b', 'Briar');

  h.service.setActiveVoiceTarget('learner', a);
  h.service.recordVoiceAttempt('learner', usableAttempt(a, 'attempt-a', {
    conceptId: 'forward-resonance',
    conceptName: 'Forward resonance',
    correct: false,
    misconception: 'Fell back',
  }));
  h.service.setActiveVoiceTarget('learner', b);

  let profile = h.service.readProfile('learner');
  assert.equal(profile.schemaVersion, 'sloane.learner_context.v6');
  assert.equal(LEARNER_CONTEXT_SCHEMA_VERSION, 'sloane.learner_context.v6');
  assert.equal(profile.voice.targetBinding.targetKey, b.targetKey);
  assert.deepEqual(profile.voice.conceptStats, {});
  assert.ok(profile.voice.learningByTarget[a.targetKey].conceptStats['forward-resonance']);
  assert.deepEqual(profile.voice.learningByTarget[b.targetKey].conceptStats, {});

  h.service.setActiveVoiceTarget('learner', a);
  profile = h.service.readProfile('learner');
  assert.ok(profile.voice.conceptStats['forward-resonance']);
  const snapshot = await h.service.getVoiceStudentModelSnapshot('learner');
  assert.equal(snapshot.learnerContext.targetBinding.targetKey, a.targetKey);
});

test('attempt persistence excludes spoken transcripts', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const binding = customBinding('preset-private', 'clip-private');
  h.service.setActiveVoiceTarget('learner', binding);
  h.service.recordVoiceAttempt('learner', usableAttempt(binding, 'attempt-private', {
    conceptId: 'pitch-path',
    conceptName: 'Pitch path',
    correct: true,
  }));

  const profileText = fs.readFileSync(h.service.getProfilePath('learner'), 'utf8');
  const eventsText = fs.readFileSync(h.service.getEventsPath('learner'), 'utf8');
  assert.doesNotMatch(profileText, /private spoken words/);
  assert.doesNotMatch(eventsText, /private spoken words/);
  assert.equal(Object.hasOwn(h.service.readProfile('learner').voice.recentAttempts[0], 'transcriptPreview'), false);
});

test('scheduled reviews become due when the snapshot is read without a new attempt', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const binding = customBinding('preset-review', 'clip-review');
  h.service.setActiveVoiceTarget('learner', binding);
  h.service.recordVoiceAttempt('learner', usableAttempt(binding, 'attempt-pass', {
    conceptId: 'easy-onset',
    conceptName: 'Easy onset',
    correct: true,
  }));

  let snapshot = await h.service.getVoiceStudentModelSnapshot('learner');
  assert.equal(snapshot.reviewQueue.some((item) => item.conceptId === 'easy-onset'), false);

  h.clock.now += 2 * 24 * 60 * 60 * 1000;
  snapshot = await h.service.getVoiceStudentModelSnapshot('learner');
  assert.equal(snapshot.reviewQueue.some((item) => item.conceptId === 'easy-onset'), true);
});

test('a corrupt profile is quarantined and recovered from its previous valid generation', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.service.updateLearnerProfile('learner', { displayName: 'First valid generation' });
  h.service.updateLearnerProfile('learner', { displayName: 'Newest generation' });
  const profilePath = h.service.getProfilePath('learner');
  fs.writeFileSync(profilePath, '{ broken json', 'utf8');

  const recovered = h.service.readProfile('learner');
  assert.equal(recovered.profile.displayName, 'First valid generation');
  const health = h.service.getStorageHealth();
  assert.equal(health.status, 'recovered');
  assert.equal(health.recoveries > 0, true);
  assert.equal(fs.readdirSync(path.dirname(profilePath)).some((name) => name.includes('.corrupt.')), true);
});

test('unrecoverable corruption blocks writes until explicit deletion clears it', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const profilePath = h.service.getProfilePath('learner');
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, '{ broken json', 'utf8');

  assert.throws(() => h.service.readProfile('learner'), /corrupt/i);
  assert.throws(() => h.service.updateLearnerProfile('learner', { displayName: 'Must not overwrite' }), /corrupt/i);
  const receipt = h.service.deleteLearnerData('learner');
  assert.equal(receipt.success, true);
  assert.equal(receipt.studentId, 'learner');
  assert.equal(h.service.readProfile('learner').profile.displayName, '');
});

test('reset clears all learned state while preserving the learner-selected target binding', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const binding = customBinding('preset-reset', 'clip-reset');
  h.service.setActiveVoiceTarget('learner', binding);
  h.service.updateLearnerProfile('learner', {
    displayName: 'Mara',
    avoid: ['imagery'],
    whatWorked: ['forward smile cue'],
  });
  h.service.updateNotepadHandoff('learner', { content: 'private note', items: ['one'] });
  h.service.addMoment('learner', { kind: 'milestone', text: 'A milestone' });
  h.service.addCoachPreference('learner', { id: 'slower-pace' });
  h.service.recordVoiceAttempt('learner', usableAttempt(binding, 'attempt-reset', {
    conceptId: 'resonance',
    conceptName: 'Resonance',
    correct: false,
  }));

  h.service.resetLearnerMemory('learner');
  const profile = h.service.readProfile('learner');
  assert.equal(profile.profile.displayName, 'Mara');
  assert.equal(profile.voice.targetBinding.targetKey, binding.targetKey);
  assert.deepEqual(profile.voice.recentAttempts, []);
  assert.deepEqual(profile.voice.baseline, {});
  assert.deepEqual(profile.voice.targetHistory, []);
  assert.deepEqual(profile.voice.learningByTarget[binding.targetKey].conceptStats, {});
  assert.deepEqual(profile.voice.coachPreferences, []);
  assert.deepEqual(profile.voice.moments, []);
  assert.equal(profile.voice.notepadHandoff, null);
});

test('coaching preferences persist only as canonical IDs', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.service.addCoachPreference('learner', { id: 'slower-pace' });
  h.service.addCoachPreference('learner', { text: 'an arbitrary model invention' });
  const preferences = h.service.readProfile('learner').voice.coachPreferences;
  assert.deepEqual(preferences.map((preference) => preference.id), ['slower-pace']);
  assert.match(preferences[0].text, /slower coaching pace/i);
});

test('event ledger rotates at a bounded size with a verifiable hash chain', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-learner-events-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createLearnerContextService({
    storageRoot: root,
    eventMaxBytes: 4096,
    logger: { warn() {}, log() {} },
  });
  for (let index = 0; index < 18; index += 1) {
    service.appendEvent('learner', 'rotation_probe', {
      index,
      categoricalPadding: 'x'.repeat(620),
    });
  }
  const eventsPath = service.getEventsPath('learner');
  const previousPath = `${eventsPath}.previous`;
  const summaryPath = `${eventsPath}.summary.json`;
  assert.equal(fs.existsSync(previousPath), true);
  assert.equal(fs.existsSync(summaryPath), true);
  assert.ok(fs.statSync(eventsPath).size <= 4096);
  assert.ok(fs.statSync(previousPath).size <= 4096);
  const previous = fs.readFileSync(previousPath);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.sha256, crypto.createHash('sha256').update(previous).digest('hex'));
  assert.match(summary.previousSha256, /^[a-f0-9]{64}$/);
});

test('one oversized event is replaced by a bounded categorical hash witness', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-learner-large-event-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createLearnerContextService({
    storageRoot: root,
    eventMaxBytes: 4096,
    logger: { warn() {}, log() {} },
  });

  service.appendEvent('learner', 'oversized_probe', {
    categoricalPadding: 'x'.repeat(12_000),
  });

  const eventsPath = service.getEventsPath('learner');
  assert.ok(fs.statSync(eventsPath).size <= 4096);
  const event = JSON.parse(fs.readFileSync(eventsPath, 'utf8').trim());
  assert.equal(event.type, 'event_payload_oversize');
  assert.equal(event.payload.originalType, 'oversized_probe');
  assert.ok(event.payload.originalBytes > 4096);
  assert.match(event.payload.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(event.payload, 'categoricalPadding'), false);
});

test('deleting one dotted learner key never sweeps another learner prefix match', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.service.updateLearnerProfile('learner', { displayName: 'Delete me' });
  h.service.updateLearnerProfile('learner.json.other', { displayName: 'Keep me' });

  const receipt = h.service.deleteLearnerData('learner');

  assert.equal(receipt.success, true);
  assert.equal(receipt.remainingArtifactCount, 0);
  assert.equal(fs.existsSync(h.service.getProfilePath('learner')), false);
  assert.equal(h.service.readProfile('learner.json.other').profile.displayName, 'Keep me');
  assert.equal(fs.existsSync(h.service.getProfilePath('learner.json.other')), true);
});

test('duplicate structured-memory mirroring stays disabled unless explicitly enabled', (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  assert.equal(h.service.getStorageHealth().structuredMemoryEnabled, false);
});
