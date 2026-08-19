import {
  buildVoiceInputRuntimeRecoveryReset,
  createDefaultVoiceCoachBackendLiveStatus,
  getVoiceInputRecoveryState as resolveVoiceInputRecoveryState,
  normalizeVoiceCoachBackendLiveStatus,
  type VoiceCoachBackendLiveStatus,
  type VoiceCoachInputProvider,
  type VoiceInputRecoveryState,
} from './input-recovery';
import type {
  VoiceCoachInputCapabilities,
  VoiceCoachSpeechProvider,
  VoiceConditioningState,
  VoiceInputRuntimeState,
} from './contracts';
import { normalizeVoiceConditioningState } from './state';

export type VoiceSpeechProviderStatus = {
  enabled: boolean;
  available: boolean | null;
  error: string | null;
};

export type VoiceInputBackendProviderStatus = {
  enabled: boolean;
  available: boolean | null;
  error: string | null;
  capabilities: VoiceCoachInputCapabilities;
  liveStatus: VoiceCoachBackendLiveStatus;
  plannedVad: boolean;
  plannedBargeIn: boolean;
};

export type VoiceRuntimeStatusState = {
  knowledgeStatusText: string;
  recoverySafetyPending: boolean;
  deepTutorVoiceRoutesEnabled: boolean | null;
  speech: {
    voxcpm: VoiceSpeechProviderStatus;
  };
  input: {
    backend: VoiceInputBackendProviderStatus;
  };
};

export type VoiceRuntimeEnvironment = {
  currentMode: string;
  currentSessionId: string | null;
  isConnected: boolean;
  browserSpeechRecognitionSupported: boolean;
  browserSpeechSynthesisSupported: boolean;
  canUseBackendCapture: boolean;
  canUseBackendRecordedFallback?: boolean;
};

type VoiceInputProviderResolutionContext = VoiceRuntimeEnvironment & {
  requestedProvider: VoiceCoachInputProvider;
};

type VoiceSpeechProviderResolutionContext = VoiceRuntimeEnvironment & {
  requestedProvider: VoiceCoachSpeechProvider;
};

type VoiceRecoveryContext = VoiceRuntimeEnvironment & {
  requestedInputProvider: VoiceCoachInputProvider;
  effectiveInputProvider?: VoiceCoachInputProvider | null;
  inputProviderFallbackActive?: boolean;
};

export type VoiceRecoverySafetyPlan = {
  shouldApply: boolean;
  disableReason: string | null;
};

type VoiceConditioningTargetProfile = {
  stylePrompt?: string | null;
} | null | undefined;

const DEFAULT_KNOWLEDGE_STATUS_TEXT = 'Checking compile…';

const DEFAULT_BACKEND_INPUT_CAPABILITIES: VoiceCoachInputCapabilities = {
  normalizedTurnContract: true,
  liveCapture: false,
  recordedCapture: false,
  automaticTurnBoundary: false,
  finalTranscript: true,
  interimTranscript: false,
  vad: false,
  bargeInCancel: false,
};

const BROWSER_INPUT_CAPABILITIES: VoiceCoachInputCapabilities = {
  normalizedTurnContract: true,
  liveCapture: true,
  recordedCapture: false,
  automaticTurnBoundary: true,
  finalTranscript: true,
  interimTranscript: true,
  vad: false,
  bargeInCancel: true,
};

export type {
  VoiceCoachInputCapabilities,
  VoiceCoachSpeechProvider,
} from './contracts';

export type {
  VoiceCoachInputProvider,
  VoiceInputRecoveryState,
} from './input-recovery';

function trimNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cloneInputCapabilities(
  capabilities: VoiceCoachInputCapabilities,
): VoiceCoachInputCapabilities {
  return { ...capabilities };
}

function cloneRuntimeStatusState(state: VoiceRuntimeStatusState): VoiceRuntimeStatusState {
  return {
    knowledgeStatusText: state.knowledgeStatusText,
    recoverySafetyPending: state.recoverySafetyPending,
    deepTutorVoiceRoutesEnabled: state.deepTutorVoiceRoutesEnabled,
    speech: {
      voxcpm: { ...state.speech.voxcpm },
    },
    input: {
      backend: {
        ...state.input.backend,
        capabilities: cloneInputCapabilities(state.input.backend.capabilities),
        liveStatus: { ...state.input.backend.liveStatus },
      },
    },
  };
}

export function createDefaultVoiceCoachInputCapabilities(): VoiceCoachInputCapabilities {
  return cloneInputCapabilities(DEFAULT_BACKEND_INPUT_CAPABILITIES);
}

export function getBrowserVoiceCoachInputCapabilities(): VoiceCoachInputCapabilities {
  return cloneInputCapabilities(BROWSER_INPUT_CAPABILITIES);
}

export function createDefaultVoiceRuntimeStatusState(): VoiceRuntimeStatusState {
    return {
      knowledgeStatusText: DEFAULT_KNOWLEDGE_STATUS_TEXT,
      recoverySafetyPending: false,
      deepTutorVoiceRoutesEnabled: null,
      speech: {
      voxcpm: {
        enabled: true,
        available: null,
        error: null,
      },
    },
    input: {
      backend: {
        enabled: false,
        available: null,
        error: null,
        capabilities: createDefaultVoiceCoachInputCapabilities(),
        liveStatus: createDefaultVoiceCoachBackendLiveStatus(),
        plannedVad: false,
        plannedBargeIn: false,
      },
    },
  };
}

export function createVoiceRuntimeStatusController(
  initialState: VoiceRuntimeStatusState = createDefaultVoiceRuntimeStatusState(),
) {
  let state = cloneRuntimeStatusState(initialState);

  function getState(): VoiceRuntimeStatusState {
    return state;
  }

  function setKnowledgeStatusText(text: string): VoiceRuntimeStatusState {
    state = {
      ...state,
      knowledgeStatusText: text,
    };
    return state;
  }

  function setRecoverySafetyPending(pending: boolean): VoiceRuntimeStatusState {
    state = {
      ...state,
      recoverySafetyPending: Boolean(pending),
    };
    return state;
  }

  function applyHealthStatusPayload(payload: unknown): VoiceRuntimeStatusState {
    const deepTutorVoiceRoutesEnabled = payload
      && typeof payload === 'object'
      && typeof (payload as { deepTutorVoiceRoutesEnabled?: unknown }).deepTutorVoiceRoutesEnabled === 'boolean'
      ? (payload as { deepTutorVoiceRoutesEnabled: boolean }).deepTutorVoiceRoutesEnabled
      : state.deepTutorVoiceRoutesEnabled;
    state = {
      ...state,
      deepTutorVoiceRoutesEnabled,
    };
    return state;
  }

  function setVoxCpmStatus(options: {
    available?: boolean | null;
    error?: string | null;
  }): VoiceRuntimeStatusState {
    state = {
      ...state,
      speech: {
        ...state.speech,
        voxcpm: {
          ...state.speech.voxcpm,
          available: options.available === undefined ? state.speech.voxcpm.available : options.available,
          error: options.error === undefined ? state.speech.voxcpm.error : trimNullableString(options.error),
        },
      },
    };
    return state;
  }

  function applySpeechStatusPayload(payload: unknown): VoiceRuntimeStatusState {
    const providers = payload && typeof payload === 'object' && 'providers' in payload
      ? (payload as { providers?: { voxcpm?: unknown } }).providers
      : null;
    const voxcpmStatus = providers && typeof providers === 'object' && 'voxcpm' in providers
      ? providers.voxcpm as {
          enabled?: boolean;
          available?: boolean;
          infoError?: string | null;
          lastError?: string | null;
        } | null
      : null;

    state = {
      ...state,
      speech: {
        ...state.speech,
        voxcpm: {
          enabled: voxcpmStatus?.enabled !== false,
          available: typeof voxcpmStatus?.available === 'boolean' ? voxcpmStatus.available : null,
          error: trimNullableString(voxcpmStatus?.infoError) ?? trimNullableString(voxcpmStatus?.lastError),
        },
      },
    };
    return state;
  }

  function applyInputProviderStatusPayload(payload: unknown): VoiceRuntimeStatusState {
    const providers = payload && typeof payload === 'object' && 'providers' in payload
      ? (payload as { providers?: { backend?: unknown } }).providers
      : null;
    // Narrow mutation responses intentionally omit provider health. Absence is
    // not evidence that backend capture became unavailable; keep the last
    // verified snapshot until an endpoint explicitly returns providers.backend.
    if (!providers || typeof providers !== 'object' || !('backend' in providers)) {
      return state;
    }
    const backendStatus = providers && typeof providers === 'object' && 'backend' in providers
      ? providers.backend as {
          enabled?: boolean;
          available?: boolean;
          lastError?: string | null;
          capabilities?: {
            normalizedTurnContract?: boolean;
            liveCapture?: boolean;
            recordedCapture?: boolean;
            automaticTurnBoundary?: boolean;
            finalTranscript?: boolean;
            interimTranscript?: boolean;
            vad?: boolean;
            bargeInCancel?: boolean;
          } | null;
          plannedFeatures?: {
            vad?: boolean;
            bargeInCancel?: boolean;
          } | null;
        } | null
      : null;
    const capabilities = backendStatus?.capabilities && typeof backendStatus.capabilities === 'object'
      ? {
          normalizedTurnContract: backendStatus.capabilities.normalizedTurnContract !== false,
          liveCapture: Boolean(backendStatus.capabilities.liveCapture),
          recordedCapture: Boolean(backendStatus.capabilities.recordedCapture),
          automaticTurnBoundary: Boolean(backendStatus.capabilities.automaticTurnBoundary),
          finalTranscript: backendStatus.capabilities.finalTranscript !== false,
          interimTranscript: Boolean(backendStatus.capabilities.interimTranscript),
          vad: Boolean(backendStatus.capabilities.vad),
          bargeInCancel: Boolean(backendStatus.capabilities.bargeInCancel),
        }
      : state.input.backend.capabilities;

    state = {
      ...state,
      input: {
        ...state.input,
        backend: {
          ...state.input.backend,
          enabled: backendStatus?.enabled !== false,
          available: typeof backendStatus?.available === 'boolean' ? backendStatus.available : null,
          error: trimNullableString(backendStatus?.lastError),
          capabilities: cloneInputCapabilities(capabilities),
          liveStatus: normalizeVoiceCoachBackendLiveStatus(backendStatus),
          plannedVad: Boolean(backendStatus?.plannedFeatures?.vad),
          plannedBargeIn: Boolean(backendStatus?.plannedFeatures?.bargeInCancel),
        },
      },
    };
    return state;
  }

  function markServiceOffline(message: string): VoiceRuntimeStatusState {
    const normalizedMessage = trimNullableString(message) || 'Unavailable';
    state = {
      ...state,
      speech: {
        ...state.speech,
        voxcpm: {
          ...state.speech.voxcpm,
          available: false,
          error: normalizedMessage,
        },
      },
      input: {
        ...state.input,
        backend: {
          ...state.input.backend,
          available: false,
          error: normalizedMessage,
          liveStatus: createDefaultVoiceCoachBackendLiveStatus(),
          plannedVad: false,
          plannedBargeIn: false,
        },
      },
    };
    return state;
  }

  function getEffectiveInputProvider(
    context: VoiceInputProviderResolutionContext,
  ): VoiceCoachInputProvider | null {
    const backend = state.input.backend;
    const backendCaptureReady = backend.enabled
      && backend.available === true
      && (
        (backend.capabilities.liveCapture && context.canUseBackendCapture)
        || (
          backend.capabilities.recordedCapture
          && context.canUseBackendRecordedFallback === true
        )
      );

    if (context.requestedProvider === 'backend') {
      if (
        context.currentMode === 'voice'
        && Boolean(context.currentSessionId)
        && context.isConnected
        && backendCaptureReady
      ) {
        return 'backend';
      }
      return context.browserSpeechRecognitionSupported ? 'browser' : null;
    }
    if (context.browserSpeechRecognitionSupported) {
      return 'browser';
    }
    if (
      context.currentMode === 'voice'
      && Boolean(context.currentSessionId)
      && context.isConnected
      && backendCaptureReady
    ) {
      return 'backend';
    }
    return null;
  }

  function isInputProviderFallbackActive(
    context: VoiceInputProviderResolutionContext,
    effectiveProvider: VoiceCoachInputProvider | null = getEffectiveInputProvider(context),
  ): boolean {
    return effectiveProvider != null && effectiveProvider !== context.requestedProvider;
  }

  function getEffectiveInputCapabilities(
    context: VoiceInputProviderResolutionContext,
    effectiveProvider: VoiceCoachInputProvider | null = getEffectiveInputProvider(context),
  ): VoiceCoachInputCapabilities | null {
    if (effectiveProvider === 'backend') {
      return cloneInputCapabilities(state.input.backend.capabilities);
    }
    if (effectiveProvider === 'browser') {
      return getBrowserVoiceCoachInputCapabilities();
    }
    return null;
  }

  function getEffectiveSpeechProvider(
    context: VoiceSpeechProviderResolutionContext,
  ): VoiceCoachSpeechProvider | null {
    const voxCpmReady = context.currentMode === 'voice'
      && Boolean(context.currentSessionId)
      && context.isConnected
      && state.speech.voxcpm.enabled
      && state.speech.voxcpm.available !== false;

    if (context.requestedProvider === 'voxcpm') {
      if (voxCpmReady) {
        return 'voxcpm';
      }
      return context.browserSpeechSynthesisSupported ? 'browser' : null;
    }
    if (context.browserSpeechSynthesisSupported) {
      return 'browser';
    }
    // Android WebView commonly has no speechSynthesis implementation. Keep an
    // older saved "browser" preference usable by crossing to the app's local
    // target-voice service when it is healthy.
    return voxCpmReady ? 'voxcpm' : null;
  }

  function isSpeechProviderFallbackActive(
    context: VoiceSpeechProviderResolutionContext,
    effectiveProvider: VoiceCoachSpeechProvider | null = getEffectiveSpeechProvider(context),
  ): boolean {
    return effectiveProvider != null && effectiveProvider !== context.requestedProvider;
  }

  function getInputRecoveryState(
    runtime: VoiceInputRuntimeState,
    context: VoiceRecoveryContext,
  ): VoiceInputRecoveryState {
    const effectiveInputProvider = context.effectiveInputProvider === undefined
      ? getEffectiveInputProvider({
          ...context,
          requestedProvider: context.requestedInputProvider,
        })
      : context.effectiveInputProvider;
    const inputProviderFallbackActive = context.inputProviderFallbackActive ?? isInputProviderFallbackActive(
      {
        ...context,
        requestedProvider: context.requestedInputProvider,
      },
      effectiveInputProvider,
    );

    return resolveVoiceInputRecoveryState(runtime, {
      requestedInputProvider: context.requestedInputProvider,
      effectiveInputProvider,
      inputProviderFallbackActive,
      backendLiveStatus: state.input.backend.liveStatus,
      backendInputError: state.input.backend.error,
    });
  }

  function buildInputRuntimeRecoveryReset(
    runtime: VoiceInputRuntimeState,
    options: {
      requestedProvider?: VoiceCoachInputProvider;
      effectiveProvider?: VoiceCoachInputProvider | null;
      captureProvider?: VoiceCoachInputProvider | null;
    } = {},
  ): VoiceInputRuntimeState {
    return buildVoiceInputRuntimeRecoveryReset(runtime, options);
  }

  function planRecoverySafety(options: {
    continuousEnabled: boolean;
    recovery: VoiceInputRecoveryState;
  }): VoiceRecoverySafetyPlan {
    const shouldApply = Boolean(
      options.continuousEnabled
        && options.recovery.shouldDisableContinuous
        && !state.recoverySafetyPending,
    );

    return {
      shouldApply,
      disableReason: shouldApply ? options.recovery.disableReason ?? null : null,
    };
  }

  function getConditioningStatusText(
    conditioning: VoiceConditioningState | null | undefined,
    targetProfile?: VoiceConditioningTargetProfile,
    referenceClipId?: string | null,
    voxcpmAvailable?: boolean,
  ): string {
    const normalizedConditioning = normalizeVoiceConditioningState(conditioning);
    const hasTargetStyle = normalizedConditioning.useTargetProfileStyle
      && typeof targetProfile?.stylePrompt === 'string'
      && targetProfile.stylePrompt.trim();
    const parts = [
      hasTargetStyle ? 'target profile style' : null,
      normalizedConditioning.styleInstruction ? `style: ${normalizedConditioning.styleInstruction}` : null,
      normalizedConditioning.promptLatentsReady
        ? `prompt sample ready (${normalizedConditioning.promptAudioName || 'loaded'})`
        : null,
      normalizedConditioning.referenceLatentsReady
        ? `reference sample ready (${normalizedConditioning.referenceAudioName || 'loaded'})`
        : null,
      referenceClipId && voxcpmAvailable ? 'voice cloning ready' : null,
    ].filter((value): value is string => Boolean(value));

    return parts.length > 0
      ? parts.join(' • ')
      : 'Tutor voice is currently zero-shot. Add style text or prepare a sample to steer VoxCPM.';
  }

  return {
    getState,
    setKnowledgeStatusText,
    setRecoverySafetyPending,
    applyHealthStatusPayload,
    setVoxCpmStatus,
    applySpeechStatusPayload,
    applyInputProviderStatusPayload,
    markServiceOffline,
    getEffectiveInputProvider,
    isInputProviderFallbackActive,
    getEffectiveInputCapabilities,
    getEffectiveSpeechProvider,
    isSpeechProviderFallbackActive,
    getInputRecoveryState,
    buildInputRuntimeRecoveryReset,
    planRecoverySafety,
    getConditioningStatusText,
  };
}
