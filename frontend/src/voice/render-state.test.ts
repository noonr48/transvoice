import { describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceCoachBackendLiveStatus } from './input-recovery';
import { buildVoiceRenderState, type VoiceRenderStateContext } from './render-state';
import {
  createDefaultVoiceDrillState,
  createDefaultVoiceStudentModelState,
  createDefaultVoiceUiState,
  type VoiceCueSheet,
  type VoiceDrill,
  type VoiceLiveFrame,
} from './state';
import type { VoiceViewModelContext } from './view-model';

function createTimeline(seed = 0): VoiceLiveFrame[] {
  return [
    {
      t: seed,
      voiced: true,
      pitchHz: 180,
      pitchScore: 0.73,
      resonanceScore: 0.58,
      weightScore: 0.45,
      confidence: 0.8,
      loudnessDb: -18,
    },
    {
      t: seed + 120,
      voiced: true,
      pitchHz: 202,
      pitchScore: 0.79,
      resonanceScore: 0.63,
      weightScore: 0.52,
      confidence: 0.84,
      loudnessDb: -16,
    },
  ];
}

const CUE_SHEET: VoiceCueSheet = {
  phrase: 'Stay lifted',
  cueLine: 'Stay lifted',
  styledCueLine: 'Stay lifted',
  tokens: [
    {
      text: 'Stay',
      cue: 'Bright',
      startProgress: 0,
      endProgress: 0.5,
    },
    {
      text: 'lifted',
      cue: 'Tall',
      startProgress: 0.5,
      endProgress: 1,
    },
  ],
};

const DRILL: VoiceDrill = {
  id: 'drill-1',
  title: 'Drill 1',
  focus: 'Forward resonance',
  phrase: 'Stay lifted',
  description: 'Keep the sound narrow and bright.',
  cues: ['Forward', 'Tall'],
  tags: ['placement'],
  cueSheet: CUE_SHEET,
};

function createViewModelContext(
  overrides: Partial<VoiceViewModelContext> = {},
): VoiceViewModelContext {
  return {
    voiceUiState: createDefaultVoiceUiState(),
    voiceDrillState: createDefaultVoiceDrillState(),
    voiceStudentModelState: createDefaultVoiceStudentModelState({
      available: true,
      enabled: true,
      masteryLevel: 'intermediate',
      reviewQueueSize: 2,
    }),
    voiceDrillStatus: 'idle',
    voiceDrillError: null,
    voiceForecastStatus: 'idle',
    voiceForecastError: null,
    voiceCoachTaskStatus: 'idle',
    voiceCoachTaskError: null,
    ...overrides,
  };
}

function createContext(
  overrides: Partial<VoiceRenderStateContext> = {},
): VoiceRenderStateContext {
  return {
    isVoiceMode: true,
    currentSessionId: 'session-1',
    isConnected: true,
    streamUrl: 'ws://voice/session-1',
    viewModelContext: createViewModelContext(),
    voiceCoachQuestionStatus: 'idle',
    voiceCoachQuestionError: null,
    voiceSpeechRecognitionStatus: 'idle',
    voiceSpeechRecognitionError: null,
    voiceDeepTutorLessonStatus: 'idle',
    voiceDeepTutorLessonError: null,
    voiceTransportStatus: 'idle',
    voiceSessionArmed: false,
    voiceTakeActive: false,
    voiceTakeProcessing: false,
    voiceAudioInputDevices: [
      { deviceId: 'default', label: 'System default input', isDefault: true },
      { deviceId: 'usb-mic', label: 'USB Mic', isDefault: false },
    ],
    selectedInputDeviceId: 'usb-mic',
    voiceResolvedInputLabel: null,
    voiceAudioInputStatus: 'ready',
    voiceAudioInputError: null,
    voiceAudioInputNotice: null,
    liveFrame: null,
    liveTrace: null,
    lastTakeTrace: null,
    overlayVisibility: {
      live: true,
      forecast: true,
      reference: true,
    },
    audioInputOptionsSignature: '',
    selectionPendingId: null,
    onSelectDrill: vi.fn(async () => undefined),
    onSelectError: vi.fn(),
    referenceHydrationView: {
      hasPlayableReference: false,
      hydrationInFlight: false,
      hydrationFailed: false,
      hydrationError: null,
    },
    referencePlayerPaused: true,
    referenceFrame: null,
    voiceRuntimeStatus: {
      knowledgeStatusText: 'Knowledge ready',
      recoverySafetyPending: false,
      speech: {
        voxcpm: {
          enabled: true,
          available: true,
          error: null,
        },
      },
      input: {
        backend: {
          enabled: true,
          available: true,
          error: null,
          capabilities: {
            normalizedTurnContract: true,
            liveCapture: true,
            finalTranscript: true,
            interimTranscript: true,
            vad: true,
            bargeInCancel: true,
          },
          liveStatus: createDefaultVoiceCoachBackendLiveStatus(),
          plannedVad: true,
          plannedBargeIn: true,
        },
      },
    },
    voiceRuntimeEnvironment: {
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      browserSpeechRecognitionSupported: true,
      browserSpeechSynthesisSupported: true,
      canUseBackendCapture: true,
    },
    requestedSpeechProvider: 'browser',
    requestedInputProvider: 'backend',
    inputProviderFallbackActive: false,
    speechProviderFallbackActive: false,
    inputCapabilities: {
      normalizedTurnContract: true,
      liveCapture: true,
      finalTranscript: true,
      interimTranscript: true,
      vad: true,
      bargeInCancel: true,
    },
    inputRecovery: {
      level: 'ok',
      statusLabel: null,
      coachCopy: null,
      activeDrillCopy: null,
      providerHint: null,
      runtimePill: null,
      suggestedInputProvider: null,
      shouldDisableContinuous: false,
      disableReason: null,
    },
    handsFreeVoiceInputSupported: true,
    voiceCoachInputAvailable: true,
    voiceCoachSpeechOutputAvailable: true,
    canUseVoiceAsk: true,
    pendingCoachChannel: null,
    ownerCopy: null,
    interactionOwner: 'idle',
    voiceConditioningStatusText: 'Conditioning ready',
    shouldRebuildDeepTutorVoiceLesson: false,
    deepTutorResumeButtonText: 'Resume DeepTutor',
    conditioningPromptFileSelected: false,
    conditioningPromptTextPresent: false,
    conditioningReferenceFileSelected: false,
    ...overrides,
  };
}

describe('voice render state facade', () => {
  it('assembles summary, controls, and orchestration state from one active guide snapshot', () => {
    const viewModelContext = createViewModelContext({
      voiceUiState: createDefaultVoiceUiState({
        serviceStatus: 'online',
        status: 'ready',
        voiceSessionId: 'voice-session-1',
        lessonId: 'drill-1',
        referenceClipId: 'clip-1',
        referenceClipName: 'Reference clip',
        referenceAnalysis: {
          clipId: 'clip-1',
          filename: 'Reference clip',
          durationMs: 2600,
          timeline: createTimeline(300),
          metrics: {
            targetHitPct: 0.74,
          },
        },
        phraseForecast: {
          phrase: 'Stay lifted',
          timeline: createTimeline(700),
          cueSheet: CUE_SHEET,
          summary: 'Projected phrase',
        },
        phraseComparison: {
          phrase: 'Stay lifted',
          pathMatchScore: 0.81,
          laneMatchScore: 0.77,
          contourMatchScore: 0.75,
          targetZoneScore: 0.72,
          summary: 'Solid alignment',
          analysisQuality: {
            sampleCount: 12,
            voicedFramePct: 0.83,
            confidentFramePct: 0.79,
            meanConfidence: 0.88,
            meanLoudnessDb: -18,
            scoreConfidence: 0.9,
            reliable: true,
            issues: [],
          },
        },
        activeLine: {
          id: 'line-1',
          displayText: 'Stay lifted',
          performanceText: 'Stay lifted',
          intent: 'Placement',
          difficulty: 'medium',
          targetPreset: null,
          teachingFocus: [],
          source: null,
          referenceMode: null,
          pinned: true,
          cueSheet: CUE_SHEET,
        },
        coachThread: [
          {
            id: 'coach-1',
            role: 'coach',
            kind: 'note',
            channel: 'deeptutor',
            content: 'Keep the placement forward.',
            createdAt: 1,
          },
        ],
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: true,
          speechProvider: 'browser',
          inputProvider: 'backend',
        },
        deeptutorVoiceState: {
          enabled: true,
          status: 'ready',
          runtimeState: 'listening',
          guideSessionId: 'guide-1',
          guideSessionStatus: 'active',
          memoryProject: null,
          studentId: null,
          currentIndex: 0,
          totalPoints: 3,
          knowledgePoints: [
            {
              title: 'Placement',
              summary: 'Forward resonance',
              difficulty: 'medium',
            },
          ],
          currentKnowledge: {
            title: 'Placement',
            summary: 'Forward resonance',
            difficulty: 'medium',
          },
          lessonBoard: {
            title: 'Placement 1',
            prompt: 'Stay lifted',
            performanceText: 'Bright and light',
            focus: ['Forward'],
            instruction: 'Replay the target once more.',
            difficultyNote: 'Medium',
            progressLabel: '1/3',
            latestNote: 'Keep the lift.',
            mimicDirective: {
              action: 'repeat',
              targetKey: 'mimic-1',
              statusLabel: 'One more pass',
              instruction: 'Replay the target once more.',
              suggestedRepeats: 1,
            },
          },
          mimicProgress: {
            targetKey: 'mimic-1',
            completedRepeats: 1,
            targetRepeats: 2,
            lastCompletedAt: 123,
          },
          coachBrief: null,
          latestInputEvidence: null,
          lastTutorMessage: 'Stay lifted and bright.',
          lastUserMessage: null,
          lastStartedAt: null,
          lastSyncedAt: null,
          lastError: null,
        },
      }),
      voiceDrillState: createDefaultVoiceDrillState({
        drills: [DRILL],
        selectedDrill: DRILL,
        selectedLessonId: DRILL.id,
        recommendedIds: [DRILL.id],
      }),
    });

    const bundle = buildVoiceRenderState(createContext({
      viewModelContext,
      voiceCoachQuestionStatus: 'sending',
      pendingCoachChannel: 'deeptutor',
      lastTakeTrace: createTimeline(),
      referenceHydrationView: {
        hasPlayableReference: true,
        hydrationInFlight: false,
        hydrationFailed: false,
        hydrationError: null,
      },
      interactionOwner: 'coach-listening',
    }));

    expect(bundle.summaryState.sidebarSummaryView.knowledgeStatusText).toBe('Knowledge ready');
    expect(bundle.summaryState.activeDrillStateText).toBe('Realtime coach listening');
    expect(bundle.controlsState.panelControls.lineNextDisabled).toBe(true);
    expect(bundle.controlsState.panelControls.deepTutorNextDisabled).toBe(false);
    expect(bundle.orchestrationState.selectedDrillId).toBe('drill-1');
    expect(bundle.orchestrationState.deepTutorResumeButtonText).toBe('Resume DeepTutor');
    expect(bundle.orchestrationState.linePinButtonText).toBe('Pinned');
    expect(bundle.orchestrationState.hasLivePath).toBe(true);
    expect(bundle.orchestrationState.hasForecastPath).toBe(true);
    expect(bundle.orchestrationState.hasReferencePath).toBe(true);
    expect(bundle.orchestrationState.coachThread.pendingBubble?.label).toBe('DeepTutor');
  });

  it('carries recovery fallback and hydration failures across the shared render bundle', () => {
    const bundle = buildVoiceRenderState(createContext({
      viewModelContext: createViewModelContext({
        voiceUiState: createDefaultVoiceUiState({
          referenceClipId: 'clip-2',
          referenceClipName: 'Fallback target',
          coachVoice: {
            speechEnabled: true,
            continuousEnabled: false,
            speechProvider: 'browser',
            inputProvider: 'backend',
          },
        }),
      }),
      referenceHydrationView: {
        hasPlayableReference: false,
        hydrationInFlight: false,
        hydrationFailed: true,
        hydrationError: 'analysis unavailable',
      },
      requestedInputProvider: 'backend',
      inputProviderFallbackActive: true,
      handsFreeVoiceInputSupported: false,
      inputRecovery: {
        level: 'warning',
        statusLabel: 'Browser fallback',
        coachCopy: 'Backend capture is unavailable right now.',
        activeDrillCopy: 'Browser capture only right now.',
        providerHint: 'Switch to browser capture.',
        runtimePill: 'fallback',
        suggestedInputProvider: 'browser',
        shouldDisableContinuous: true,
        disableReason: 'Backend capture degraded',
      },
      voiceRuntimeStatus: {
        knowledgeStatusText: 'Knowledge ready',
        recoverySafetyPending: false,
        speech: {
          voxcpm: {
            enabled: true,
            available: true,
            error: null,
          },
        },
        input: {
          backend: {
            enabled: true,
            available: false,
            error: 'websocket unavailable',
            capabilities: {
              normalizedTurnContract: true,
              liveCapture: false,
              finalTranscript: true,
              interimTranscript: false,
              vad: false,
              bargeInCancel: false,
            },
            liveStatus: createDefaultVoiceCoachBackendLiveStatus(),
            plannedVad: false,
            plannedBargeIn: false,
          },
        },
      },
      interactionOwner: 'idle',
    }));

    expect(bundle.summaryState.activeDrillCopyText).toBe('Browser capture only right now.');
    expect(bundle.summaryState.inputRuntimeView.pills).toContain('fallback');
    expect(bundle.summaryState.referenceView.playbackCopyText).toContain('could not be reloaded');
    expect(bundle.controlsState.coachControls.handsFreeToggle.disabled).toBe(true);
    expect(bundle.controlsState.coachControls.handsFreeToggle.title).toBe('Backend capture degraded');
  });

  it('falls back to target profile metrics when no reference analysis metrics are available', () => {
    const bundle = buildVoiceRenderState(createContext({
      viewModelContext: createViewModelContext({
        voiceUiState: createDefaultVoiceUiState({
          referenceClipId: 'clip-3',
          referenceClipName: 'Target profile only',
          targetVoiceProfile: {
            profileId: 'profile-3',
            clipId: 'clip-3',
            metrics: {
              meanPitchHz: 233,
              targetHitPct: 0.71,
            },
          },
        }),
      }),
    }));

    expect(bundle.orchestrationState.referenceMetrics).toMatchObject({
      meanPitchHz: 233,
      targetHitPct: 0.71,
    });
  });
});
