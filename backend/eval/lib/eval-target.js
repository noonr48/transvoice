'use strict';

const { resolveVoiceTargetIdentity } = require('../../voice-target-identity');

function createEvalTargetBinding(studentId) {
  const safeId = String(studentId || 'learner').replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
  const referenceClipId = `eval-reference-${safeId}`;
  const presetId = `eval-preset-${safeId}`;
  const targetVoiceProfile = {
    profileId: `eval-profile-${safeId}`,
    clipId: referenceClipId,
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
    referenceClipId,
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
    presetId,
    presetName: `Eval sample ${safeId}`,
    referenceClipId,
    targetPreset: targetVoiceProfile.targetPreset,
    targetSource: 'custom-reference',
    targetKey: identity.targetKey,
    targetProfileId: targetVoiceProfile.profileId,
    analysisVersion: targetVoiceProfile.analysisVersion,
    direction: targetVoiceProfile.direction,
    targetVoiceProfile,
  };
}

function bindEvalTargetToSession(runtime, sessionId, binding) {
  const session = runtime.sessions.get(sessionId);
  if (!session) throw new Error(`Evaluation session ${sessionId} is missing.`);
  session.voiceState = runtime.voiceStateRuntime.updateSessionVoiceState(session, {
    targetPreset: binding.targetPreset,
    targetSource: binding.targetSource,
    selectedCustomPresetId: binding.presetId,
    selectedCustomPresetName: binding.presetName,
    referenceClipId: binding.referenceClipId,
    referenceClipName: `${binding.presetId}.wav`,
    targetVoiceProfile: binding.targetVoiceProfile,
    targetBinding: binding,
  });
  return session;
}

function buildEvalReviewAttempt(binding, concept, sessionId) {
  const p = binding.targetVoiceProfile;
  return {
    sessionId,
    attemptId: `${sessionId}-review-seed`,
    voiceState: {
      targetPreset: binding.targetPreset,
      targetSource: binding.targetSource,
      referenceClipId: binding.referenceClipId,
      selectedCustomPresetId: binding.presetId,
      selectedCustomPresetName: binding.presetName,
      targetVoiceProfile: p,
    },
    summary: {
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
    evaluations: [{
      conceptId: concept.conceptId,
      conceptName: concept.conceptName,
      correct: false,
      misconception: `still working on ${concept.conceptName}`,
    }],
  };
}

module.exports = {
  bindEvalTargetToSession,
  buildEvalReviewAttempt,
  createEvalTargetBinding,
};
