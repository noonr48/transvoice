import { createVoiceBackendErrorPayload } from './voice-backend-payload-contract';

type SharedContractRecord = Record<string, unknown>;
type SharedContractSchema = SharedContractRecord;

type DeepTutorVoiceLessonMode = 'none' | 'history' | 'active';
type DeepTutorVoiceRuntimeOwner = 'off' | 'warming' | 'listening' | 'planning' | 'evaluating' | 'paused';
type DeepTutorVoicePracticeIntent = 'coach' | 'practice';

type DeepTutorVoiceSharedInteractionState = {
  lessonMode: DeepTutorVoiceLessonMode;
  guideStatus: string;
  runtimeOwner: DeepTutorVoiceRuntimeOwner;
  practiceIntent: DeepTutorVoicePracticeIntent;
  hasActiveGuideSession: boolean;
  hasHistoricalLessonState: boolean;
  ownsGuidedLineChanges: boolean;
  ownsPhraseMapChanges: boolean;
  acceptsRealtimeCoachTurns: boolean;
};

type DeepTutorVoiceInteractionContractOptions = {
  normalizeDeepTutorVoiceState?: (value: any) => SharedContractRecord;
  isDeepTutorVoiceGuideInProgress?: (value: any) => boolean;
  referenceMimicAction?: string | null;
};

type DeepTutorOwnershipPayload = {
  voiceState?: unknown;
  deeptutorVoiceState?: SharedContractRecord | null;
  interactionState: DeepTutorVoiceSharedInteractionState;
  error?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is SharedContractRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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

export const DEEPTUTOR_INTERACTION_STATE_SCHEMA: SharedContractSchema = {
  $id: 'https://sloane.os/schema/shared-contracts/deeptutor-interaction-state-v1',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    lessonMode: { enum: ['active', 'history', 'none'] },
    guideStatus: { type: 'string' },
    runtimeOwner: { enum: ['warming', 'listening', 'planning', 'evaluating', 'paused', 'off'] },
    practiceIntent: { enum: ['practice', 'coach'] },
    hasActiveGuideSession: { type: 'boolean' },
    hasHistoricalLessonState: { type: 'boolean' },
    ownsGuidedLineChanges: { type: 'boolean' },
    ownsPhraseMapChanges: { type: 'boolean' },
    acceptsRealtimeCoachTurns: { type: 'boolean' },
  },
  required: [
    'lessonMode',
    'guideStatus',
    'runtimeOwner',
    'practiceIntent',
    'hasActiveGuideSession',
    'hasHistoricalLessonState',
    'ownsGuidedLineChanges',
    'ownsPhraseMapChanges',
    'acceptsRealtimeCoachTurns',
  ],
  additionalProperties: false,
};

export const DEEPTUTOR_OWNERSHIP_PAYLOAD_SCHEMA: SharedContractSchema = {
  $id: 'https://sloane.os/schema/shared-contracts/deeptutor-ownership-payload-v1',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    voiceState: nullableSchema(anyObjectSchema()),
    deeptutorVoiceState: nullableSchema(anyObjectSchema()),
    interactionState: DEEPTUTOR_INTERACTION_STATE_SCHEMA,
    error: { type: 'string' },
  },
  additionalProperties: true,
};

function getNormalizedState(
  value: unknown,
  adapters: DeepTutorVoiceInteractionContractOptions = {},
): SharedContractRecord {
  const normalizeDeepTutorVoiceState = typeof adapters.normalizeDeepTutorVoiceState === 'function'
    ? adapters.normalizeDeepTutorVoiceState
    : (input: unknown) => (isRecord(input) ? input : {});
  return normalizeDeepTutorVoiceState(value);
}

function isGuideInProgress(
  value: unknown,
  adapters: DeepTutorVoiceInteractionContractOptions = {},
): boolean {
  const normalizedState = getNormalizedState(value, adapters);
  if (typeof adapters.isDeepTutorVoiceGuideInProgress === 'function') {
    return adapters.isDeepTutorVoiceGuideInProgress(normalizedState);
  }

  if (!normalizedState.guideSessionId) {
    return false;
  }

  const status = normalizeText(normalizedState.guideSessionStatus || normalizedState.status).toLowerCase();
  return status !== 'completed' && status !== 'error';
}

export function getDeepTutorVoiceLessonMode(
  value: unknown,
  options: DeepTutorVoiceInteractionContractOptions = {},
): DeepTutorVoiceLessonMode {
  const normalizedState = getNormalizedState(value, options);
  if (isGuideInProgress(normalizedState, options)) {
    return 'active';
  }

  return (
    normalizedState.enabled
    || normalizedState.guideSessionId
    || normalizedState.currentKnowledge
    || normalizedState.lessonBoard
    || normalizedState.coachBrief
    || normalizedState.lastTutorMessage
    || normalizedState.lastUserMessage
  )
    ? 'history'
    : 'none';
}

export function resolveDeepTutorVoiceRuntimeOwner(
  value: unknown,
  options: DeepTutorVoiceInteractionContractOptions = {},
): DeepTutorVoiceRuntimeOwner {
  const normalizedState = getNormalizedState(value, options);
  const runtimeOwner = normalizeText(normalizedState.runtimeState).toLowerCase();
  if (['warming', 'listening', 'planning', 'evaluating', 'paused'].includes(runtimeOwner)) {
    return runtimeOwner as DeepTutorVoiceRuntimeOwner;
  }

  const guideStatus = normalizeText(normalizedState.guideSessionStatus || normalizedState.status).toLowerCase();
  if (guideStatus === 'error' || normalizedState.lastError) {
    return 'paused';
  }
  if (guideStatus === 'initialized' || guideStatus === 'warming') {
    return 'warming';
  }
  if (guideStatus === 'completed') {
    return 'planning';
  }
  if (isGuideInProgress(normalizedState, options)) {
    return 'listening';
  }
  return 'off';
}

export function resolveDeepTutorVoicePracticeIntent(
  value: unknown,
  options: DeepTutorVoiceInteractionContractOptions = {},
): DeepTutorVoicePracticeIntent {
  const normalizedState = getNormalizedState(value, options);
  const referenceMimicAction = normalizeText(options.referenceMimicAction).toLowerCase();
  if (referenceMimicAction === 'mimic' || referenceMimicAction === 'repeat') {
    return 'practice';
  }

  if (normalizedState.coachBrief && isRecord(normalizedState.coachBrief) && normalizedState.coachBrief.immediateAction === 'practice') {
    return 'practice';
  }

  const lessonBoard = isRecord(normalizedState.lessonBoard) ? normalizedState.lessonBoard : null;
  const mimicDirective = isRecord(lessonBoard?.mimicDirective) ? lessonBoard.mimicDirective : null;
  const directiveAction = normalizeText(mimicDirective?.action).toLowerCase();
  if (directiveAction === 'mimic' || directiveAction === 'repeat') {
    return 'practice';
  }
  return 'coach';
}

export function createDeepTutorVoiceSharedInteractionState(
  value: unknown,
  options: DeepTutorVoiceInteractionContractOptions = {},
): DeepTutorVoiceSharedInteractionState {
  const normalizedState = getNormalizedState(value, options);
  const lessonMode = getDeepTutorVoiceLessonMode(normalizedState, options);
  const hasActiveGuideSession = isGuideInProgress(normalizedState, options);

  return {
    lessonMode,
    guideStatus: normalizeText(normalizedState.guideSessionStatus || normalizedState.status).toLowerCase() || 'idle',
    runtimeOwner: resolveDeepTutorVoiceRuntimeOwner(normalizedState, options),
    practiceIntent: resolveDeepTutorVoicePracticeIntent(normalizedState, options),
    hasActiveGuideSession,
    hasHistoricalLessonState: lessonMode !== 'none',
    ownsGuidedLineChanges: hasActiveGuideSession,
    ownsPhraseMapChanges: hasActiveGuideSession,
    acceptsRealtimeCoachTurns: hasActiveGuideSession,
  };
}

export function buildDeepTutorVoiceOwnershipPayload(
  session: {
    voiceState?: unknown;
    deeptutorVoiceState?: unknown;
  } | null | undefined,
  error: string | null | undefined,
  options: DeepTutorVoiceInteractionContractOptions = {},
): DeepTutorOwnershipPayload {
  const deeptutorVoiceState = getNormalizedState(session?.deeptutorVoiceState, options);
  const voiceState = isRecord(session?.voiceState) ? session.voiceState : null;
  return createVoiceBackendErrorPayload(
    {
      voiceState,
      deeptutorVoiceState,
    },
    error,
    {
      interactionState: createDeepTutorVoiceSharedInteractionState(deeptutorVoiceState, options),
    },
  ) as DeepTutorOwnershipPayload;
}
