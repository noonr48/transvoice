const {
  anyObjectSchema,
  isRecord,
  normalizeRecordSlice,
  nullableSchema,
} = require('./common.cjs');

const VOICE_BACKEND_PAYLOAD_SCHEMA = {
  $id: 'https://sloane.os/schema/shared-contracts/voice-backend-payload-v1',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    voiceState: nullableSchema(anyObjectSchema()),
    studentModel: nullableSchema(anyObjectSchema()),
    learnerContext: nullableSchema(anyObjectSchema()),
    deeptutorVoiceState: nullableSchema(anyObjectSchema()),
    error: { type: 'string' },
  },
  additionalProperties: true,
};

function getVoiceBackendPayloadSlices(payload) {
  const normalizedPayload = isRecord(payload) ? payload : null;
  const voiceState = normalizeRecordSlice(normalizedPayload?.voiceState);
  const deeptutorVoiceState = normalizeRecordSlice(
    normalizedPayload?.deeptutorVoiceState ?? voiceState?.deeptutorVoiceState,
  );
  const studentModel = normalizeRecordSlice(normalizedPayload?.studentModel);
  const learnerContext = normalizeRecordSlice(
    normalizedPayload?.learnerContext ?? studentModel?.learnerContext,
  );

  return {
    voiceState,
    studentModel,
    learnerContext,
    deeptutorVoiceState,
  };
}

function hasVoiceBackendPayload(payload) {
  const slices = getVoiceBackendPayloadSlices(payload);
  return Boolean(slices.voiceState || slices.studentModel || slices.learnerContext || slices.deeptutorVoiceState);
}

function createVoiceBackendPayload(payload, extras = {}) {
  const slices = getVoiceBackendPayloadSlices(payload);
  const nextPayload = isRecord(extras) ? { ...extras } : {};

  if (slices.voiceState) {
    nextPayload.voiceState = slices.voiceState;
  }
  if (slices.studentModel) {
    nextPayload.studentModel = slices.studentModel;
  }
  if (slices.learnerContext) {
    nextPayload.learnerContext = slices.learnerContext;
  }
  if (slices.deeptutorVoiceState) {
    nextPayload.deeptutorVoiceState = slices.deeptutorVoiceState;
  }

  return nextPayload;
}

function createVoiceBackendErrorPayload(payload, error, extras = {}) {
  const normalizedError = typeof error === 'string' ? error.trim() : '';
  return createVoiceBackendPayload(payload, {
    ...(isRecord(extras) ? extras : {}),
    ...(normalizedError ? { error: normalizedError } : {}),
  });
}

module.exports = {
  VOICE_BACKEND_PAYLOAD_SCHEMA,
  createVoiceBackendErrorPayload,
  createVoiceBackendPayload,
  getVoiceBackendPayloadSlices,
  hasVoiceBackendPayload,
};
