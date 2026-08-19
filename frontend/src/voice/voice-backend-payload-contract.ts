type SharedContractRecord = Record<string, unknown>;
type SharedContractSchema = SharedContractRecord;
type VoiceBackendPayloadSlice = SharedContractRecord;

type VoiceBackendPayload = {
  voiceState?: VoiceBackendPayloadSlice | null;
  studentModel?: VoiceBackendPayloadSlice | null;
  learnerContext?: VoiceBackendPayloadSlice | null;
  deeptutorVoiceState?: VoiceBackendPayloadSlice | null;
  turnId?: string | null;
  error?: string;
  [key: string]: unknown;
};

type VoiceBackendPayloadSlices = {
  voiceState: VoiceBackendPayloadSlice | null;
  studentModel: VoiceBackendPayloadSlice | null;
  learnerContext: VoiceBackendPayloadSlice | null;
  deeptutorVoiceState: VoiceBackendPayloadSlice | null;
};

function isRecord(value: unknown): value is SharedContractRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecordSlice(value: unknown): SharedContractRecord | null {
  return isRecord(value) ? value : null;
}

function nullableSchema(schema: SharedContractSchema): SharedContractSchema {
  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}

function anyObjectSchema(): SharedContractSchema {
  return {
    type: 'object',
    additionalProperties: true,
  };
}

export const VOICE_BACKEND_PAYLOAD_SCHEMA: SharedContractSchema = {
  $id: 'https://sloane.os/schema/shared-contracts/voice-backend-payload-v1',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    voiceState: nullableSchema(anyObjectSchema()),
    studentModel: nullableSchema(anyObjectSchema()),
    learnerContext: nullableSchema(anyObjectSchema()),
    deeptutorVoiceState: nullableSchema(anyObjectSchema()),
    turnId: { type: ['string', 'null'] },
    error: { type: 'string' },
  },
  additionalProperties: true,
};

export function getVoiceBackendPayloadSlices(payload: unknown): VoiceBackendPayloadSlices {
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

export function hasVoiceBackendPayload(payload: unknown): payload is VoiceBackendPayload {
  const slices = getVoiceBackendPayloadSlices(payload);
  return Boolean(slices.voiceState || slices.studentModel || slices.learnerContext || slices.deeptutorVoiceState);
}

export function createVoiceBackendPayload<T extends SharedContractRecord>(
  payload?: VoiceBackendPayload | null | undefined,
  extras?: T | null | undefined,
): T & VoiceBackendPayload {
  const slices = getVoiceBackendPayloadSlices(payload);
  const nextPayload: SharedContractRecord = isRecord(extras) ? { ...extras } : {};

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

  return nextPayload as T & VoiceBackendPayload;
}

export function createVoiceBackendErrorPayload<T extends SharedContractRecord>(
  payload: VoiceBackendPayload | null | undefined,
  error: string | null | undefined,
  extras?: T | null | undefined,
): T & VoiceBackendPayload & { error?: string } {
  const normalizedError = typeof error === 'string' ? error.trim() : '';
  return createVoiceBackendPayload(payload, {
    ...(isRecord(extras) ? extras : {}),
    ...(normalizedError ? { error: normalizedError } : {}),
  }) as T & VoiceBackendPayload & { error?: string };
}
