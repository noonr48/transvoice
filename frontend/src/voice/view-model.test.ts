import { describe, expect, it } from 'vitest';
import {
  createDefaultVoiceDrillState,
  createDefaultVoiceStudentModelState,
  createDefaultVoiceUiState,
  isDeepTutorVoiceGuideInProgress,
} from './state';
import {
  getCurrentVoiceCueSheet,
  getVoiceActiveDrillCopyText,
  getVoiceActiveDrillStateLabel,
  getVoiceCoachControlsViewModel,
  getVoiceCoachSupportViewModel,
  getVoicePanelControlsViewModel,
  getRenderableVoicePhraseComparison,
  getVoiceCoachCopy,
  getVoiceLearnerContextDatasetText,
  getVoiceLearnerContextNotepadText,
  getVoiceLearnerContextStatusText,
  getVoiceCoachThreadViewModel,
  getVoiceCoachPanelCopy,
  getVoiceForecastText,
  getVoiceInputRuntimeEvidenceSummary,
  getVoiceInputPanelViewModel,
  getVoiceInputRuntimeViewModel,
  getVoiceInputRuntimePills,
  getVoiceReferenceMimicProgressState,
  getVoiceReferenceMimicState,
  getVoiceReferenceViewModel,
  getVoiceReviewDueText,
  getVoiceSidebarSummaryViewModel,
  getVoiceSummaryText,
  getVoiceScriptPadViewModel,
  getVoiceStageViewModel,
  getVoiceStudentConceptText,
  getVoiceStudentFocusText,
  isVoicePracticeTargetLocked,
  getVoiceTargetFitText,
  getVoicePhraseFinalDropText,
  getVoiceBaselineDeltaText,
  getPitchFitStatusLabel,
  type VoiceViewModelContext,
} from './view-model';

function createContext(overrides: Partial<VoiceViewModelContext> = {}): VoiceViewModelContext {
  return {
    voiceUiState: createDefaultVoiceUiState(),
    voiceDrillState: createDefaultVoiceDrillState(),
    voiceStudentModelState: createDefaultVoiceStudentModelState(),
    voiceDrillStatus: 'idle',
    voiceDrillError: null,
    voiceForecastStatus: 'idle',
    voiceForecastError: null,
    voiceCoachTaskStatus: 'idle',
    voiceCoachTaskError: null,
    ...overrides,
  };
}

function createPanelControlsContext(voiceUiState: ReturnType<typeof createDefaultVoiceUiState>) {
  return {
    voiceUiState,
    voiceConditioning: { useTargetProfileStyle: false, styleInstruction: '', promptText: '' },
    voiceConditioningStatusText: '',
    voicePracticeTargetLocked: false,
    currentSessionId: 'session-1',
    isConnected: true,
    voiceForecastStatus: 'idle' as const,
    voiceSessionArmed: false,
    voiceTakeProcessing: false,
    voiceTakeActive: false,
    voiceTransportStatus: 'idle' as const,
    deepTutorOwnsLineSelection: true,
    activeLine: null,
    voiceDeepTutorLessonStatus: 'idle' as const,
    shouldRebuildDeepTutorVoiceLesson: false,
    voiceCoachQuestionStatus: 'idle' as const,
    voiceAudioInputDevicesCount: 1,
    conditioningPromptFileSelected: false,
    conditioningPromptTextPresent: false,
    conditioningReferenceFileSelected: false,
  };
}

describe('voice view model', () => {
  it('prefers the forecast cue sheet when the drill phrase does not match it', () => {
    const context = createContext({
      voiceUiState: createDefaultVoiceUiState({
        phraseForecast: {
          phrase: 'forecast phrase',
          cueSheet: {
            phrase: 'forecast phrase',
            cueLine: 'forecast cue',
          },
        },
      }),
      voiceDrillState: createDefaultVoiceDrillState({
        selectedLessonId: 'drill-1',
        drills: [{
          id: 'drill-1',
          title: 'Drill',
          focus: 'focus',
          phrase: 'different drill phrase',
          description: 'desc',
          cues: [],
          tags: [],
          cueSheet: {
            phrase: 'different drill phrase',
            cueLine: 'drill cue',
          },
        }],
      }),
    });

    expect(getCurrentVoiceCueSheet(context)?.cueLine).toBe('forecast cue');
  });

  it('filters renderable phrase comparisons when the active phrase has moved on', () => {
    const context = createContext({
      voiceUiState: createDefaultVoiceUiState({
        lessonId: 'drill-1',
        phraseComparison: {
          phrase: 'old phrase',
          forecastPhrase: 'old phrase',
          lessonId: 'drill-1',
          pathMatchScore: 0.8,
          targetZoneScore: 0.7,
          summary: 'Old comparison',
        },
        phraseForecast: {
          phrase: 'new phrase',
          summary: 'New forecast',
          timeline: [],
        },
      }),
    });

    expect(getRenderableVoicePhraseComparison(context)).toBeNull();
  });

  it('locks practice target mutations once a voice session is armed', () => {
    expect(isVoicePracticeTargetLocked(createDefaultVoiceUiState({ voiceSessionId: 'voice-1' }))).toBe(true);
    expect(isVoicePracticeTargetLocked(createDefaultVoiceUiState({ voiceSessionId: '   ' }))).toBe(false);
  });

  it('treats completed DeepTutor guide sessions as restartable instead of active', () => {
    expect(isDeepTutorVoiceGuideInProgress({ guideSessionId: 'guide-1', guideSessionStatus: 'learning' })).toBe(true);
    expect(isDeepTutorVoiceGuideInProgress({ guideSessionId: 'guide-1', guideSessionStatus: 'completed' })).toBe(false);
  });

  it('surfaces review queue guidance before any summary exists', () => {
    const context = createContext({
      voiceStudentModelState: createDefaultVoiceStudentModelState({
        reviewQueue: [
          { conceptId: 'c1', name: 'Pitch center', urgency: 0.7 },
          { conceptId: 'c2', name: 'Bright resonance', urgency: 0.6 },
        ],
      }),
    });

    expect(getVoiceCoachCopy(context)).toContain('Review queue ready: Pitch center • Bright resonance.');
  });

  it('prefers the latest visible coach reply over a stale DeepTutor lesson note', () => {
    const context = createContext({
      voiceUiState: createDefaultVoiceUiState({
        lastCoachMessage: 'Again, slower this time.',
        deeptutorVoiceState: {
          lastTutorMessage: 'Keep the phrase bright before moving on.',
        },
      }),
    });

    expect(getVoiceCoachCopy(context)).toBe('Again, slower this time.');
  });

  it('prefers the latest coach thread message over a flattened lastCoachMessage', () => {
    const context = createContext({
      voiceUiState: createDefaultVoiceUiState({
        lastCoachMessage: 'Older coach copy',
        coachThread: [{
          id: 'coach-1',
          role: 'coach',
          channel: 'runtime',
          kind: 'runtime-answer',
          content: 'Newest realtime coach answer',
          createdAt: Date.now(),
        }],
      }),
    });

    expect(getVoiceCoachCopy(context)).toBe('Newest realtime coach answer');
  });

  it('reports projected forecast failures directly', () => {
    const context = createContext({
      voiceForecastStatus: 'error',
      voiceForecastError: 'Trainer offline',
    });

    expect(getVoiceForecastText(context)).toBe('Projection failed: Trainer offline');
  });

  it('strips markup from student review prompts', () => {
    const studentModelState = createDefaultVoiceStudentModelState({
      reviewPrompt: '[Focus] Keep the ending lighter and brighter on repeats.',
    });

    expect(getVoiceStudentFocusText(studentModelState)).toBe(
      'Keep the ending lighter and brighter on repeats.',
    );
  });

  it('builds the visible review-due line only when something is due', () => {
    // Nothing due -> null (line stays hidden).
    expect(getVoiceReviewDueText(createDefaultVoiceStudentModelState({ available: true }))).toBeNull();
    // Errored / unavailable student model -> null, never pressure.
    expect(getVoiceReviewDueText(createDefaultVoiceStudentModelState({
      available: true,
      error: 'bridge down',
      reviewQueueSize: 3,
    }))).toBeNull();
    // Due items -> calm pencil line with up to two names.
    expect(getVoiceReviewDueText(createDefaultVoiceStudentModelState({
      available: true,
      reviewQueueSize: 1,
      reviewQueue: [{ id: 'c1', name: 'pitch glide' }] as any,
    }))).toBe('1 focus due for review today — pitch glide');
    expect(getVoiceReviewDueText(createDefaultVoiceStudentModelState({
      available: true,
      reviewQueueSize: 3,
      reviewQueue: [
        { id: 'c1', name: 'pitch glide' },
        { id: 'c2', name: 'resonance' },
        { id: 'c3', name: 'weight' },
      ] as any,
    }))).toBe('3 focuses due for review today — pitch glide • resonance');
  });

  it('surfaces standalone learner context when no mastery concepts exist yet', () => {
    const studentModelState = createDefaultVoiceStudentModelState({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        schemaVersion: 'sloane.learner_context.v1',
        query: null,
        updatedAt: 1700000000000,
        targetPreset: 'australian-bright-feminine',
        recentAttemptCount: 3,
        notepadHandoff: null,
        consentStatus: 'granted',
        eligibilityStatus: 'eligible',
        exclusions: [],
        exportEligible: true,
        error: null,
      },
    });

    expect(getVoiceStudentConceptText(studentModelState)).toBe(
      'Learner context ready • target: australian-bright-feminine • 3 recent takes • export eligible.',
    );
  });

  it('uses learner-context notepad handoff as the fallback voice focus', () => {
    const studentModelState = createDefaultVoiceStudentModelState({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        schemaVersion: 'sloane.learner_context.v1',
        query: null,
        updatedAt: 1700000000000,
        targetPreset: 'australian-bright-feminine',
        recentAttemptCount: 0,
        notepadHandoff: {
          content: 'Next pass: keep vowels smaller and lighter.',
          items: ['smaller vowels'],
          source: 'deeptutor-slow-planner',
          sessionId: 'session-1',
          updatedAt: 1700000000000,
        },
        consentStatus: 'unknown',
        eligibilityStatus: 'unknown',
        exclusions: [],
        exportEligible: false,
        error: null,
      },
    });

    expect(getVoiceStudentFocusText(studentModelState)).toBe(
      'Planner note: Next pass: keep vowels smaller and lighter.',
    );
  });

  it('renders learner-context status, dataset, and notepad copy', () => {
    const studentModelState = createDefaultVoiceStudentModelState({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        schemaVersion: 'sloane.learner_context.v1',
        query: null,
        updatedAt: 1700000000000,
        targetPreset: 'australian-bright-feminine',
        recentAttemptCount: 2,
        notepadHandoff: {
          content: 'Next pass: keep vowels smaller and lighter.',
          items: [],
          source: 'planner',
          sessionId: 'session-1',
          updatedAt: 1700000000000,
        },
        consentStatus: 'granted',
        eligibilityStatus: 'eligible',
        exclusions: [],
        exportEligible: true,
        error: null,
      },
    });

    expect(getVoiceLearnerContextStatusText(studentModelState)).toBe(
      'local-learner-context • target australian-bright-feminine • 2 recent takes',
    );
    expect(getVoiceLearnerContextDatasetText(studentModelState)).toBe(
      'Dataset export ready: consent granted, eligible, no exclusions.',
    );
    expect(getVoiceLearnerContextNotepadText(studentModelState)).toBe(
      'Planner handoff: Next pass: keep vowels smaller and lighter.',
    );
  });

  it('gates guided coach controls when standalone mode disables DeepTutor routes', () => {
    const panelControls = getVoicePanelControlsViewModel({
      voiceUiState: createDefaultVoiceUiState(),
      voiceConditioning: {
        useProfileStyle: false,
        styleInstruction: '',
        promptText: '',
        promptArtifactId: null,
        promptPreparedAt: null,
        promptStatus: 'idle',
        promptError: null,
        promptVocoder: null,
        promptVocoderStatus: null,
        promptVocoderError: null,
        promptDurationSec: null,
        referenceArtifactId: null,
        referencePreparedAt: null,
        referenceStatus: 'idle',
        referenceError: null,
        referenceVocoder: null,
        referenceVocoderStatus: null,
        referenceVocoderError: null,
        referenceDurationSec: null,
      },
      voiceConditioningStatusText: 'No conditioning yet.',
      voicePracticeTargetLocked: false,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'idle',
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      deepTutorOwnsLineSelection: true,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'idle',
      shouldRebuildDeepTutorVoiceLesson: false,
      deepTutorVoiceRoutesEnabled: false,
      voiceCoachQuestionStatus: 'idle',
      voiceAudioInputDevicesCount: 1,
      conditioningPromptFileSelected: false,
      conditioningPromptTextPresent: false,
      conditioningReferenceFileSelected: false,
    });

    expect(panelControls.deepTutorStartDisabled).toBe(true);
    expect(panelControls.deepTutorNextDisabled).toBe(true);
    expect(panelControls.deepTutorStartTitle).toContain('standalone voice runtime mode');
    expect(panelControls.deepTutorNextTitle).toContain('standalone voice runtime mode');
  });

  it('surfaces backend listening copy before the generic coach copy', () => {
    expect(getVoiceCoachPanelCopy({
      latestCoachMessage: null,
      latestCoachCopy: 'Default coach copy',
      latestCoachLabel: 'Coach',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachQuestionError: null,
      voiceSpeechRecognitionStatus: 'waiting',
      voiceSpeechRecognitionError: null,
      voiceDeepTutorLessonStatus: 'idle',
      voiceDeepTutorLessonError: null,
      requestedInputProvider: 'backend',
      inputProviderFallbackActive: false,
      backendLivePathLabel: 'provider live',
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
      inputProviderFallbackReason: null,
      inputCapabilityCopy: null,
      speechEnabled: true,
      voxcpmFallbackReason: null,
      continuousEnabled: false,
      handsFreeVoiceInputSupported: true,
      ownerCopy: null,
    })).toBe('provider live is armed. Start speaking when ready; the turn will submit after local silence is detected.');
  });

  it('builds compact runtime pills and caps them at four entries', () => {
    expect(getVoiceInputRuntimePills({
      status: 'completed',
      requestedProvider: 'backend',
      effectiveProvider: 'browser',
      captureProvider: null,
      lastTranscriptConfidence: 0.92,
      liveInterimMode: 'word',
      liveVadStrategy: 'server',
      providerModel: 'gpt-asr',
      providerEndpointing: 'auto',
      lastVadState: 'speech',
      lastSpeechDurationMs: 220,
      lastAudioProcessedMs: 410,
      lastBargeInAt: 12,
      consecutiveNoSpeechTurns: 3,
      consecutiveErrorTurns: 2,
      successfulTurns: 0,
      noSpeechTurns: 0,
      errorCount: 0,
      liveSessionId: null,
      lastSegmentId: null,
      providerStyle: null,
      transcriptSource: null,
      lastTranscript: null,
      lastCaptureStartedAt: null,
      lastSpeechDetectedAt: null,
      lastCapturedAt: null,
      lastProcessedAt: null,
      lastCaptureDurationMs: null,
      lastRoundTripMs: null,
      providerTarget: null,
      providerLanguage: null,
      lastPartialTranscript: null,
      lastPartialTranscriptAt: null,
      lastAnalysisSummary: null,
      lastAnalysisDurationMs: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
      lastError: null,
      lastEventAt: null,
      liveEngine: null,
    }, {
      sourceLabel: 'provider live',
      timeLabel: 'just now',
      runtimePill: 'fallback no speech',
    })).toEqual([
      'provider live',
      '92% conf',
      'word interim',
      'server vad',
    ]);
  });

  it('formats runtime evidence summaries from the latest partial transcript', () => {
    expect(getVoiceInputRuntimeEvidenceSummary({
      status: 'listening',
      lastPartialTranscript: 'hello there this is a partial',
      transcriptSource: 'backend-live-provider',
      liveEngine: null,
      lastSpeechDurationMs: 320,
      lastTranscript: null,
      lastAnalysisSummary: null,
      lastError: null,
      lastOutcome: 'success',
      noSpeechTurns: 0,
      lastProcessedAt: null,
      liveSessionId: null,
      requestedProvider: 'backend',
      effectiveProvider: 'backend',
      captureProvider: null,
      providerStyle: null,
      lastTranscriptConfidence: null,
      lastCaptureStartedAt: null,
      lastSpeechDetectedAt: null,
      lastCapturedAt: null,
      lastRoundTripMs: null,
      successfulTurns: 0,
      errorCount: 0,
      consecutiveNoSpeechTurns: 0,
      consecutiveErrorTurns: 0,
      lastSegmentId: null,
      liveInterimMode: null,
      liveVadStrategy: null,
      providerTarget: null,
      providerModel: null,
      providerLanguage: null,
      providerEndpointing: null,
      lastPartialTranscriptAt: null,
      lastVadState: null,
      lastBargeInAt: null,
      lastAnalysisDurationMs: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
      lastAudioProcessedMs: null,
      lastEventAt: null,
    } as any)).toBe('Heard so far: "hello there this is a partial" • provider live ASR • 320 ms speech.');
  });

  it('builds a runtime display model with provider, counts, and summary text', () => {
    const model = getVoiceInputRuntimeViewModel({
      status: 'completed',
      requestedProvider: 'backend',
      effectiveProvider: 'browser',
      captureProvider: null,
      transcriptSource: 'browser-fallback',
      providerStyle: 'provider-websocket',
      liveEngine: 'provider-websocket',
      providerModel: 'gpt-asr',
      providerLanguage: 'en',
      providerTarget: 'openai',
      providerEndpointing: 'auto',
      lastTranscript: 'That was my last turn',
      lastTranscriptConfidence: 0.88,
      lastCapturedAt: null,
      lastProcessedAt: null,
      lastCaptureStartedAt: null,
      lastSpeechDetectedAt: null,
      lastCaptureDurationMs: 420,
      lastRoundTripMs: 950,
      successfulTurns: 3,
      noSpeechTurns: 1,
      errorCount: 2,
      consecutiveNoSpeechTurns: 0,
      consecutiveErrorTurns: 0,
      liveSessionId: null,
      lastSegmentId: null,
      liveInterimMode: null,
      liveVadStrategy: null,
      lastPartialTranscript: null,
      lastPartialTranscriptAt: null,
      lastVadState: null,
      lastBargeInAt: null,
      lastAnalysisSummary: null,
      lastAnalysisDurationMs: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
      lastSpeechDurationMs: null,
      lastAudioProcessedMs: 610,
      lastError: null,
      lastEventAt: null,
      lastOutcome: 'success',
    } as any, {
      runtimePill: 'fallback active',
    });

    expect(model.statusText).toBe('Idle');
    expect(model.providerText).toContain('Backend -> Browser');
    expect(model.latencyText).toBe('cap 420ms • audio 610ms • rt 950ms');
    expect(model.countsText).toBe('3 ok • 1 no speech • 2 err');
    expect(model.copyText).toContain('browser fallback');
    expect(model.pills).toContain('88% conf');
  });

  it('builds coach control labels and titles from presentation state', () => {
    const controls = getVoiceCoachControlsViewModel({
      currentSessionId: 'session-1',
      isConnected: true,
      handsFreeEnabled: false,
      voiceCoachInputAvailable: true,
      handsFreeVoiceInputSupported: false,
      inputRecovery: {
        level: 'warning',
        statusLabel: null,
        coachCopy: null,
        activeDrillCopy: null,
        providerHint: 'Backend fallback',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      },
      voiceSpeechRecognitionStatus: 'idle',
      canUseVoiceAsk: true,
      interactionOwner: 'idle',
      deeptutorGuideActive: true,
      speechEnabled: true,
      voiceCoachSpeechOutputAvailable: true,
      requestedSpeechProvider: 'voxcpm',
      speechProviderFallbackActive: true,
      voiceCoachVoxCpmError: 'Provider offline',
      requestedInputProvider: 'backend',
      inputProviderFallbackActive: true,
      voiceCoachInputBackendError: null,
      browserSpeechRecognitionSupported: true,
      backendInputBaseTitle: 'Backend live unavailable',
      inputProviderHint: 'Switch if needed',
    });

    expect(controls.handsFreeToggle.title).toBe('Hands-free needs an input path that can end turns automatically.');
    expect(controls.questionPlaceholder).toContain('slow down');
    expect(controls.speechProviderToggle.text).toBe('Voice: VoxCPM (offline)');
    expect(controls.inputProviderToggle.text).toBe('Input: Backend (fallback)');
    expect(controls.inputProviderToggle.title).toBe('Backend live unavailable Switch if needed');
  });

  it('builds provider fallback and capability copy for the coach shell', () => {
    const support = getVoiceCoachSupportViewModel({
      currentSessionId: 'session-1',
      isConnected: true,
      requestedSpeechProvider: 'voxcpm',
      speechProviderFallbackActive: true,
      voiceCoachVoxCpmError: 'Provider offline',
      voiceCoachVoxCpmEnabled: true,
      requestedInputProvider: 'backend',
      inputProviderFallbackActive: true,
      voiceCoachInputBackendError: null,
      voiceCoachInputBackendEnabled: true,
      canUseBackendVoiceCoachCapture: false,
      browserSpeechRecognitionSupported: true,
      backendInputCapabilities: {
        liveCapture: true,
        interimTranscript: true,
        finalTranscript: true,
        vad: true,
        bargeInCancel: false,
      },
      effectiveInputCapabilities: {
        liveCapture: true,
        interimTranscript: false,
        finalTranscript: true,
        vad: false,
        bargeInCancel: false,
      },
      backendLiveStatus: {
        requestedMode: 'websocket-json',
        requestedWsUrlConfigured: true,
        requestedProviderTarget: 'openai',
        requestedModel: 'gpt-asr',
        requestedLanguage: 'en',
        actualMode: 'buffered',
        actualEngine: 'buffered',
        actualInterimMode: 'segment',
        actualVadStrategy: 'server',
        verified: true,
        fallbackReason: 'provider unavailable',
      },
    });

    expect(support.backendLivePathLabel).toBe('buffered live');
    expect(support.inputCapabilityCopy).toContain('live capture, interim transcript, final transcript, VAD');
    expect(support.inputCapabilityCopy).toContain('provider live was requested, but backend input resolved to buffered live • segment interim • server VAD (provider unavailable)');
    expect(support.inputProviderFallbackReason).toBe('Backend input is selected, but this browser cannot record audio for the server ASR path. Browser speech recognition is capturing turns instead.');
    expect(support.voxcpmFallbackReason).toBe('VoxCPM is selected for tutor speech, but it is currently unavailable (Provider offline). Browser speech is handling playback.');
    expect(support.backendInputBaseTitle).toBe('This browser cannot record audio for backend ASR capture.');
  });

  it('derives a mimic-now state from weak reference matching', () => {
    const voiceUiState = createDefaultVoiceUiState({
      referenceClipName: 'target.wav',
      lastSummary: {
        metrics: {
          targetHitPct: 0.42,
        },
      },
    });

    const state = getVoiceReferenceMimicState({
      voiceUiState,
      comparison: {
        pathMatchScore: 0.44,
        laneMatchScore: 0.52,
        contourMatchScore: 0.49,
      } as any,
    });

    expect(state.action).toBe('mimic');
    expect(state.suggestedRepeats).toBe(3);
    expect(state.metrics).toContain('Path 44%');
    expect(state.metrics).toContain('Zone 42%');
  });

  it('requests a fresh take instead of rewarding explicitly rejected measurements', () => {
    const voiceUiState = createDefaultVoiceUiState({
      referenceClipName: 'target.wav',
      lastSummary: {
        metrics: {
          meanPitchHz: 201.5,
          targetHitPct: 0.99,
          advanced: {
            measurementAvailable: false,
            pitchTargetOccupancyPct: 99,
          },
        },
      },
    });

    const state = getVoiceReferenceMimicState({
      voiceUiState,
      comparison: {
        pathMatchScore: 0.99,
        laneMatchScore: 0.99,
        contourMatchScore: 0.99,
      } as any,
    });

    expect(state).toMatchObject({
      action: 'repeat',
      statusLabel: 'Measure again',
      suggestedRepeats: 1,
      metrics: [],
    });
    expect(getVoiceSummaryText(voiceUiState)).toContain('No reliable voice measurement');
  });

  it('does not claim a reference is aligned without a finite comparison witness', () => {
    const voiceUiState = createDefaultVoiceUiState({
      referenceClipName: 'target.wav',
      lastSummary: {
        voiceSessionId: 'voice-no-comparison',
        metrics: {
          targetHitPct: null,
        },
      },
      deeptutorVoiceState: {
        lessonBoard: {
          mimicDirective: {
            action: 'hold',
            statusLabel: 'Target aligned',
            instruction: 'Keep going.',
          },
        },
      },
    } as any);

    const state = getVoiceReferenceMimicState({
      voiceUiState,
      comparison: {
        pathMatchScore: null,
        laneMatchScore: null,
        contourMatchScore: null,
      } as any,
    });

    expect(state).toMatchObject({
      action: 'ready',
      statusLabel: 'No comparison',
      suggestedRepeats: null,
      metrics: [],
    });
    expect(state.statusLabel).not.toBe('Target aligned');
  });

  it('tracks mimic progress against the active DeepTutor target key', () => {
    const progress = getVoiceReferenceMimicProgressState({
      lessonBoard: {
        mimicDirective: {
          action: 'mimic',
          targetKey: 'target-1',
          statusLabel: 'Mimic now',
          instruction: 'Replay it.',
        },
      },
      mimicProgress: {
        targetKey: 'target-1',
        completedRepeats: 1,
        targetRepeats: 2,
      },
    }, {
      action: 'mimic',
      statusLabel: 'Mimic now',
      instruction: 'Replay it.',
      suggestedRepeats: 2,
      metrics: [],
    });

    expect(progress).toEqual({
      completedRepeats: 1,
      targetRepeats: 2,
      remainingRepeats: 1,
      progressLabel: '1/2 passes',
    });
  });

  it('prefers realtime tutor listening in the active drill state label', () => {
    const label = getVoiceActiveDrillStateLabel({
      voiceUiState: createDefaultVoiceUiState({
        deeptutorVoiceState: {
          runtimeState: 'listening',
          guideSessionId: 'guide-1',
          guideSessionStatus: 'learning',
        },
      }),
      inputRecovery: {
        level: 'ok',
        statusLabel: 'Fallback armed',
        coachCopy: null,
        activeDrillCopy: null,
        providerHint: null,
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      },
      voiceDeepTutorLessonStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      voiceSessionArmed: false,
    });

    expect(label).toBe('Realtime coach listening');
  });

  it('builds mimic-progress copy before generic active drill guidance', () => {
    const copy = getVoiceActiveDrillCopyText({
      voiceUiState: createDefaultVoiceUiState(),
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
      inputRuntime: createDefaultVoiceUiState().voiceInputRuntime,
      voiceSpeechRecognitionStatus: 'idle',
      voiceSessionArmed: false,
      voiceTransportStatus: 'idle',
      backendLivePathLabel: null,
      referenceMimicState: {
        action: 'mimic',
        statusLabel: 'Mimic now',
        instruction: 'Replay the target.',
        suggestedRepeats: 2,
        metrics: [],
      },
      referenceMimicProgress: {
        completedRepeats: 1,
        targetRepeats: 2,
        remainingRepeats: 1,
        progressLabel: '1/2 passes',
      },
    });

    expect(copy).toBe('Replay the target. 1 more pass to log.');
  });

  it('builds a script-pad view model from guided lesson state', () => {
    const viewModel = getVoiceScriptPadViewModel(createContext({
      voiceUiState: createDefaultVoiceUiState({
        deeptutorVoiceState: {
          guideSessionId: 'guide-1',
          guideSessionStatus: 'learning',
          lessonBoard: {
            title: 'Bright starts',
            prompt: 'Hello there',
            performanceText: 'Lift the ending lightly.',
            focus: ['bright-onset'],
            progressLabel: '1/3',
            difficultyNote: 'Medium',
            latestNote: 'Stay buoyant on the opening word.',
          },
          currentKnowledge: {
            title: 'Openers',
            summary: 'Keep the first word bright.',
            difficulty: 'medium',
          },
        },
      }),
    }));

    expect(viewModel.labelText).toBe('Guided line');
    expect(viewModel.lineText).toBe('Hello there');
    expect(viewModel.performanceText).toBe('Lift the ending lightly.');
    expect(viewModel.metaPills).toContain('Lesson: Bright starts');
    expect(viewModel.metaPills).toContain('Progress: 1/3');
    expect(viewModel.cuePills).toContain('bright onset');
    expect(viewModel.lessonNote).toBe('Stay buoyant on the opening word.');
    expect(viewModel.showLineActions).toBe(false);
  });

  it('builds coach thread labels and pending status from presentation state', () => {
    const thread = getVoiceCoachThreadViewModel({
      coachThread: [{
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the phrase again, lighter this time.',
        createdAt: Date.now(),
      }],
      voiceCoachTaskStatus: 'running',
      voiceCoachQuestionStatus: 'idle',
      pendingCoachChannel: 'shortcut',
      hasActiveGuideSession: true,
      emptyCopy: 'Fallback copy',
    });

    expect(thread.emptyCopy).toBeNull();
    expect(thread.bubbles[0]).toMatchObject({
      role: 'coach',
      label: 'Realtime Coach',
    });
    expect(thread.pendingBubble).toMatchObject({
      label: 'Coach Shortcut',
      content: 'Reading the take and building the next note...',
    });
  });

  it('builds reference playback copy and mimic pills from hydration state', () => {
    const view = getVoiceReferenceViewModel({
      voiceUiState: createDefaultVoiceUiState({
        referenceClipName: 'target.wav',
        referenceAnalysis: {
          durationMs: 2500,
        } as any,
      }),
      referenceMimicState: {
        action: 'mimic',
        statusLabel: 'Mimic now',
        instruction: 'Replay the target.',
        suggestedRepeats: 2,
        metrics: ['Path 44%', 'Zone 42%'],
      },
      referenceMimicProgress: {
        completedRepeats: 1,
        targetRepeats: 2,
        remainingRepeats: 1,
        progressLabel: '1/2 passes',
      },
      referenceHydrationFailed: true,
      referenceHydrationError: 'missing timeline',
      referenceHydrationInFlight: false,
      hasPlayableReference: true,
      hasReferencePath: false,
      referencePlayerPaused: true,
    });

    expect(view.summaryText).toBe('target.wav • 2.5s');
    expect(view.playbackCopyText).toContain('Playback is restored, but the saved reference path could not be reloaded (missing timeline)');
    expect(view.showPlayer).toBe(true);
    expect(view.mimicPills).toEqual([
      'Mimic now',
      '2 repeats',
      '1/2 passes',
      'Path 44%',
      'Zone 42%',
    ]);
  });

  it('builds stage and graph status text from transport state', () => {
    const view = getVoiceStageViewModel({
      voiceUiState: createDefaultVoiceUiState({
        serviceStatus: 'online',
        targetPreset: 'bright',
        referenceClipName: 'target.wav',
        targetVoiceProfile: {
          sourceFilename: 'profile.wav',
        } as any,
        phraseForecast: {
          phrase: 'hello there',
        } as any,
      }),
      selectedDrill: {
        id: 'drill-1',
        title: 'Resonance lift',
        focus: 'resonance',
        phrase: 'hello there',
        description: 'desc',
        cues: [],
        tags: [],
      },
      comparison: {
        pathMatchScore: 0.82,
        laneMatchScore: 0.76,
        contourMatchScore: 0.69,
        targetZoneScore: 0.73,
      } as any,
      liveVoiceSessionId: 'voice-session-123456',
      lastSummarySessionId: 'summary-999',
      streamUrl: 'wss://voice',
      liveSession: true,
      voiceTakeActive: false,
      voiceSessionArmed: true,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'streaming',
    });

    expect(view.graphStatusText).toBe('Mic path armed voice-se');
    // P0.1b: streaming transport -> the spine is at the Practice stage.
    expect(view.sessionStage).toBe('practice');
    // P0.1c: no coach message yet -> the calm idle cue (distinct from the transport status).
    expect(view.liveCueText).toBe('Ready when you are — start a take to get live coaching.');
    expect(view.streamUrlText).toBe('wss://voice');
    expect(view.sessionText).toBe('Armed • voice-se');
    expect(view.targetText).toBe('profile.wav • built-in preset');
    expect(view.referenceText).toBe('target.wav');
    expect(view.targetVoiceText).toBe('profile.wav');
    expect(view.forecastText).toBe('hello there');
    expect(view.drillText).toBe('Resonance lift');
    expect(view.matchText).toBe('82%');
    expect(view.laneText).toBe('76%');
    expect(view.contourText).toBe('69%');
    expect(view.zoneText).toBe('73%');
    expect(view.shellMemoryStatsText).toBe('voice session live');
    expect(view.shellStageStatusText).toBe('VOICE LIVE');
    // Redesign additions: hasReference + per-stage spine hint.
    expect(view.hasReference).toBe(false); // referenceClipId not set in this fixture
    expect(view.spineHintText).toBe('Read the line; arm practice and speak.');
  });

  it('derives the Review surface from existing per-session signals', () => {
    const view = getVoiceStageViewModel({
      voiceUiState: createDefaultVoiceUiState({
        referenceClipId: 'clip-1',
        attemptArtifacts: [
          {
            createdAt: new Date('2026-06-09T10:30:00').getTime(),
            durationMs: 4200,
            clientAttemptId: 'attempt-a',
            summary: { metrics: { targetHitPct: 0.7, similarityScore: 0.6 } },
          },
          {
            createdAt: new Date('2026-06-09T10:35:00').getTime(),
            durationMs: 5100,
            clientAttemptId: 'attempt-b',
            includesRawAudio: false,
            summary: { metrics: { targetHitPct: 0.8, similarityScore: 0.65 } },
          },
        ] as any,
        lastSummary: {
          metrics: { targetHitPct: 0.8 },
          issues: ['pitch drifts low'],
          nextDrills: ['humming glide'],
        } as any,
      }),
      selectedDrill: null,
      comparison: null,
      liveVoiceSessionId: 'voice-session-abc',
      lastSummarySessionId: 'summary-1',
      streamUrl: null,
      liveSession: false,
      voiceTakeActive: false,
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
    });

    expect(view.sessionStage).toBe('review');
    expect(view.hasReference).toBe(true);
    expect(view.spineHintText).toBe('Review your takes, then start the next line.');
    expect(view.reviewSummaryText).toBe('2 takes this session • best target hit 80%');
    expect(view.reviewFocusText).toBe('Focus: pitch drifts low • Next: humming glide');
    expect(view.reviewListItems).toHaveLength(2);
    expect(view.reviewListItems[0].durationText).toBe('4s');
    expect(view.reviewListItems[0].metricText).toBe('hit 70% • sim 60%');
    expect(view.reviewListItems[1].metricText).toBe('hit 80% • sim 65%');
    // Surfacing wave: attemptId threads through for per-row Listen; explicit
    // includesRawAudio:false marks the no-audio row.
    expect(view.reviewListItems[0].attemptId).toBe('attempt-a');
    expect(view.reviewListItems[0].hasAudio).toBe(true);
    expect(view.reviewListItems[1].attemptId).toBe('attempt-b');
    expect(view.reviewListItems[1].hasAudio).toBe(false);
    expect(view.graphAriaLabel).toContain('80% in the target zone');
  });

  it('renders empty/fallback Review copy with no takes', () => {
    const view = getVoiceStageViewModel({
      voiceUiState: createDefaultVoiceUiState({ serviceStatus: 'online' }),
      selectedDrill: null,
      comparison: null,
      liveVoiceSessionId: 'voice-session-xyz',
      lastSummarySessionId: '',
      streamUrl: null,
      liveSession: false,
      voiceTakeActive: false,
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
    });

    expect(view.reviewSummaryText).toBe('No takes this session yet.');
    expect(view.reviewFocusText).toBe('Keep practicing to build a focus summary.');
    expect(view.reviewListItems).toEqual([]);
  });

  it('keeps rejected take telemetry without displaying its fabricated scores', () => {
    const rejectedMetrics = {
      meanPitchHz: 201.5,
      resonanceMean: 0.95,
      targetHitPct: 0.99,
      similarityScore: 0.98,
      advanced: {
        measurementAvailable: false,
        pitchTargetOccupancyPct: 99,
      },
    };
    const view = getVoiceStageViewModel({
      voiceUiState: createDefaultVoiceUiState({
        attemptArtifacts: [{
          createdAt: Date.now(),
          summary: { metrics: rejectedMetrics },
        }] as any,
        lastSummary: {
          metrics: rejectedMetrics,
          issues: ['No voiced speech was detected.'],
          nextDrills: ['pitch victory drill'],
        } as any,
      }),
      selectedDrill: null,
      comparison: {
        pathMatchScore: 0.99,
        laneMatchScore: 0.99,
        contourMatchScore: 0.99,
        targetZoneScore: 0.99,
      } as any,
      liveVoiceSessionId: 'voice-session-invalid',
      lastSummarySessionId: 'summary-invalid',
      streamUrl: null,
      liveSession: false,
      voiceTakeActive: false,
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
    });

    expect(view.reviewSummaryText).toBe('1 take this session');
    expect(view.reviewListItems[0].metricText).toBe('measurement unavailable');
    expect(view.reviewFocusText).toBe('Measurement unavailable — record another clear take.');
    expect(view.graphAriaLabel).toContain('latest take was not measurable');
    expect(view.graphAriaLabel).not.toContain('201');
  });

  it('keeps a one-frame low-confidence take out of scores, comparisons, and drills', () => {
    const degradedMetrics = {
      meanPitchHz: 219,
      resonanceMean: 0.91,
      weightMean: 0.08,
      targetHitPct: 0.99,
      similarityScore: 0.99,
      advanced: {
        measurementAvailable: true,
        voicedFramePct: 0.01,
        scoreConfidence: 0.04,
        captureReliability: 0.08,
      },
    };
    const voiceUiState = createDefaultVoiceUiState({
        referenceClipId: 'reference-degraded',
        referenceClipName: 'reference-degraded.wav',
        attemptArtifacts: [{
          createdAt: Date.now(),
          summary: { metrics: degradedMetrics },
        }] as any,
        lastSummary: {
          metrics: degradedMetrics,
          issues: ['Target aligned'],
          nextDrills: ['victory drill'],
        } as any,
        phraseComparison: {
          pathMatchScore: 0.99,
          laneMatchScore: 0.99,
          contourMatchScore: 0.99,
        } as any,
      });
    const view = getVoiceStageViewModel({
      voiceUiState,
      selectedDrill: null,
      comparison: {
        pathMatchScore: 0.99,
        laneMatchScore: 0.99,
        contourMatchScore: 0.99,
      } as any,
      liveVoiceSessionId: 'voice-session-degraded',
      lastSummarySessionId: 'summary-degraded',
      streamUrl: null,
      liveSession: false,
      voiceTakeActive: false,
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
    });

    expect(view.reviewSummaryText).toBe('1 take this session');
    expect(view.reviewListItems[0].metricText).toBe('measurement unavailable');
    expect(view.reviewFocusText).toBe('Measurement unavailable — record another clear take.');
    expect(view.graphAriaLabel).toContain('latest take was not measurable');
    const mimicState = getVoiceReferenceMimicState({
      voiceUiState,
      comparison: {
        pathMatchScore: 0.99,
        laneMatchScore: 0.99,
        contourMatchScore: 0.99,
      } as any,
    });
    expect(mimicState.metrics).toEqual([]);
    expect(mimicState.statusLabel).not.toMatch(/aligned/i);
  });

  it('builds sidebar summary text from session, student, and lesson state', () => {
    const view = getVoiceSidebarSummaryViewModel({
      ...createContext({
        voiceUiState: createDefaultVoiceUiState({
          targetPreset: 'bright',
          referenceClipName: 'target.wav',
          referenceAnalysis: {
            durationMs: 3200,
          } as any,
          lastError: 'trainer timeout',
          deeptutorVoiceState: {
            lessonBoard: {
              title: 'Bright starts',
            },
          },
        }),
        voiceStudentModelState: createDefaultVoiceStudentModelState({
          available: true,
          masteryLevel: 'intermediate',
          reviewQueueSize: 4,
        }),
      }),
      voiceKnowledgeStatusText: 'Knowledge ready',
      voiceTakeActive: false,
      voiceSessionArmed: true,
      liveVoiceSessionId: 'voice-session-123456',
    });

    expect(view.sidebarPresetText).toBe('bright • built-in preset');
    expect(view.serviceHealthText).toBe('Error: trainer timeout');
    expect(view.sessionStatusText).toBe('Armed • voice-se');
    expect(view.studentMasteryText).toBe('INTERMEDIATE');
    expect(view.studentReviewCountText).toBe('4 due');
    expect(view.knowledgeStatusText).toBe('Knowledge ready');
    expect(view.referenceSummaryText).toBe('target.wav • 3.2s');
    expect(view.activeDrillTitleText).toBe('Bright starts');
  });

  it('builds panel control state from runtime and connection status', () => {
    const advancedPanelDefaults = createDefaultVoiceUiState().advancedPanel;
    const view = getVoicePanelControlsViewModel({
      voiceUiState: createDefaultVoiceUiState({
        targetPreset: 'bright',
        referenceClipId: 'ref-1',
        advancedPanel: { ...advancedPanelDefaults, open: true },
      }),
      voiceConditioning: {
        useTargetProfileStyle: true,
        styleInstruction: 'light and buoyant',
        promptText: 'mirror the lift',
      },
      voiceConditioningStatusText: 'Conditioning ready',
      voicePracticeTargetLocked: true,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'loading',
      voiceSessionArmed: true,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'streaming',
      deepTutorOwnsLineSelection: true,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'loading',
      shouldRebuildDeepTutorVoiceLesson: true,
      voiceCoachQuestionStatus: 'sending',
      voiceAudioInputDevicesCount: 2,
      conditioningPromptFileSelected: true,
      conditioningPromptTextPresent: true,
      conditioningReferenceFileSelected: true,
    });

    expect(view.targetPresetDisabled).toBe(true);
    expect(view.forecastGenerateText).toBe('Projecting...');
    expect(view.forecastGenerateDisabled).toBe(true);
    expect(view.startSessionText).toBe('Cancel take');
    expect(view.startSessionDisabled).toBe(false);
    expect(view.endSessionText).toBe('Hold to Practice');
    expect(view.endSessionDisabled).toBe(false);
    expect(view.lineNextDisabled).toBe(true);
    expect(view.deepTutorStartDisabled).toBe(true);
    expect(view.deepTutorNextDisabled).toBe(true);
    expect(view.deepTutorNextTitle).toBe('Start a new guided lesson first.');
    expect(view.advancedToggleText).toBe('Hide Details');
    expect(view.advancedExpanded).toBe(true);
    expect(view.coachSendDisabled).toBe(true);
    expect(view.conditioningSaveDisabled).toBe(false);
    expect(view.conditioningPromptUploadDisabled).toBe(false);
    expect(view.conditioningReferenceUploadDisabled).toBe(false);
    expect(view.inputDeviceDisabled).toBe(true);
  });

  it('does not advertise hands-free as on when no hands-free input path works', () => {
    const controls = getVoiceCoachControlsViewModel({
      currentSessionId: 'session-1',
      isConnected: true,
      handsFreeEnabled: true,
      voiceCoachInputAvailable: false,
      handsFreeVoiceInputSupported: false,
      canUseVoiceAsk: false,
      voiceSpeechRecognitionStatus: 'idle',
      interactionOwner: 'idle',
      deeptutorGuideActive: false,
      speechEnabled: true,
      voiceCoachSpeechOutputAvailable: true,
      requestedSpeechProvider: 'browser',
      speechProviderFallbackActive: false,
      voiceCoachVoxCpmError: null,
      voiceCoachVoxCpmEnabled: false,
      requestedInputProvider: 'browser',
      inputProviderFallbackActive: false,
      voiceCoachInputBackendError: null,
      voiceCoachInputBackendEnabled: false,
      canUseBackendVoiceCoachCapture: false,
      browserSpeechRecognitionSupported: false,
      backendInputCapabilities: null,
      effectiveInputCapabilities: null,
      backendLiveStatus: null,
      inputRecovery: {
        shouldDisableContinuous: false,
        disableReason: null,
      } as never,
    });

    expect(controls.handsFreeToggle.text).toBe('Hands-Free: Unavailable');
    expect(controls.handsFreeToggle.disabled).toBe(true);
    expect(controls.voiceAskToggle.text).toBe('Voice Ask Unavailable');
  });

  it('blocks harder line progression after high strain or fatigue self-report', () => {
    const baseContext = {
      voiceUiState: createDefaultVoiceUiState({
        lastAttemptArtifact: {
          selfReport: {
            strain: 4,
            fatigue: 5,
          },
        } as any,
      }),
      voiceConditioning: {
        useTargetProfileStyle: false,
        styleInstruction: '',
        promptText: '',
      },
      voiceConditioningStatusText: '',
      voicePracticeTargetLocked: false,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'idle',
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      deepTutorOwnsLineSelection: false,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'idle',
      shouldRebuildDeepTutorVoiceLesson: false,
      voiceCoachQuestionStatus: 'idle',
      voiceAudioInputDevicesCount: 1,
      conditioningPromptFileSelected: false,
      conditioningPromptTextPresent: false,
      conditioningReferenceFileSelected: false,
    } satisfies Parameters<typeof getVoicePanelControlsViewModel>[0];
    const view = getVoicePanelControlsViewModel(baseContext);
    const deeptutorView = getVoicePanelControlsViewModel({
      ...baseContext,
      deepTutorOwnsLineSelection: true,
    });

    expect(view.lineHarderDisabled).toBe(true);
    expect(view.lineNextDisabled).toBe(false);
    expect(deeptutorView.deepTutorNextDisabled).toBe(true);
    expect(deeptutorView.deepTutorNextTitle).toBe('Reset before advancing after strain, fatigue, unstable analysis, or unreliable capture.');
    expect(view.selfReportCopyText).toContain('strain 4/5');
    expect(view.selfReportCopyText).toContain('fatigue 5/5');
  });

  it('blocks harder progression when analyzer quality is unsafe even without self-report', () => {
    const view = getVoicePanelControlsViewModel({
      voiceUiState: createDefaultVoiceUiState({
        lastSummary: {
          metrics: {
            advanced: {
              scoreConfidence: 0.31,
              voicedFramePct: 0.36,
              reliabilityFlags: ['low_score_confidence'],
            },
          },
        } as any,
      }),
      voiceConditioning: {
        useTargetProfileStyle: false,
        styleInstruction: '',
        promptText: '',
      },
      voiceConditioningStatusText: '',
      voicePracticeTargetLocked: false,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'idle',
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      deepTutorOwnsLineSelection: true,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'idle',
      shouldRebuildDeepTutorVoiceLesson: false,
      voiceCoachQuestionStatus: 'idle',
      voiceAudioInputDevicesCount: 1,
      conditioningPromptFileSelected: false,
      conditioningPromptTextPresent: false,
      conditioningReferenceFileSelected: false,
    });

    expect(view.lineHarderDisabled).toBe(true);
    expect(view.deepTutorNextDisabled).toBe(true);
    expect(view.deepTutorNextTitle).toBe('Reset before advancing after strain, fatigue, unstable analysis, or unreliable capture.');
  });

  it('uses numeric analyzer confidence before stale reliability flags', () => {
    for (const [scoreConfidence, shouldHold] of [[0.47, true], [0.50, false], [0.58, false]] as const) {
      const view = getVoicePanelControlsViewModel(createPanelControlsContext(createDefaultVoiceUiState({
        lastSummary: {
          metrics: {
            advanced: {
              measurementAvailable: true,
              scoreConfidence,
              voicedFramePct: 0.7,
              confidentFramePct: 0.7,
              captureReliability: 0.8,
              reliabilityFlags: ['low_score_confidence'],
            },
          },
        } as any,
      })));
      expect(view.deepTutorNextDisabled, `scoreConfidence=${scoreConfidence}`).toBe(shouldHold);
    }
  });

  it('mirrors two-tier and vocalise-lenient strain safety thresholds', () => {
    const controlsFor = (
      strainRisk: number,
      recentFlags: number,
      kind: string,
      breathyRisk = 0.1,
    ) => (
      getVoicePanelControlsViewModel(createPanelControlsContext(createDefaultVoiceUiState({
        strainWatch: { recentFlags, sessionMinutes: 5, takeCount: 2, strainedTotal: recentFlags },
        lastSummary: {
          metrics: {
            advanced: {
              measurementAvailable: true,
              scoreConfidence: 0.8,
              voicedFramePct: 0.8,
              confidentFramePct: 0.8,
              captureReliability: 0.8,
              quality: { strainRisk, breathyRisk },
            },
          },
        } as any,
        lastAttemptArtifact: { repContext: { kind } } as any,
      })))
    );

    expect(controlsFor(0.55, 1, 'phrase').deepTutorNextDisabled).toBe(false);
    expect(controlsFor(0.55, 2, 'phrase').deepTutorNextDisabled).toBe(true);
    expect(controlsFor(0.55, 2, 'sustained').deepTutorNextDisabled).toBe(false);
    expect(controlsFor(0.70, 1, 'sustained').deepTutorNextDisabled).toBe(true);
    expect(controlsFor(0.1, 1, 'phrase', 0.69).deepTutorNextDisabled).toBe(false);
    expect(controlsFor(0.1, 2, 'phrase', 0.69).deepTutorNextDisabled).toBe(true);
  });

  it('does not turn missing SNR or self-report fields into a false safety hold or zero score', () => {
    const view = getVoicePanelControlsViewModel({
      voiceUiState: createDefaultVoiceUiState({
        lastSummary: {
          metrics: {
            advanced: {
              measurementAvailable: true,
              snrDb: null,
              scoreConfidence: null,
              voicedFramePct: null,
              confidentFramePct: null,
              captureReliability: null,
              clippingPct: null,
              stabilityMean: null,
              quality: { strainRisk: null, breathyRisk: null },
            },
          },
        } as any,
        lastAttemptArtifact: {
          selfReport: {
            effort: null,
            strain: null,
            fatigue: null,
            perceivedDifficulty: null,
            confidence: null,
          },
        } as any,
      }),
      voiceConditioning: {
        useTargetProfileStyle: false,
        styleInstruction: '',
        promptText: '',
      },
      voiceConditioningStatusText: '',
      voicePracticeTargetLocked: false,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'idle',
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      deepTutorOwnsLineSelection: true,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'idle',
      shouldRebuildDeepTutorVoiceLesson: false,
      voiceCoachQuestionStatus: 'idle',
      voiceAudioInputDevicesCount: 1,
      conditioningPromptFileSelected: false,
      conditioningPromptTextPresent: false,
      conditioningReferenceFileSelected: false,
    });

    expect(view.deepTutorNextDisabled).toBe(false);
    expect(view.deepTutorNextTitle).toBe('');
    expect(view.selfReportEffortValue).toBe('');
    expect(view.selfReportStrainValue).toBe('');
    expect(view.selfReportFatigueValue).toBe('');
    expect(view.selfReportDifficultyValue).toBe('');
    expect(view.selfReportConfidenceValue).toBe('');
    expect(view.selfReportCopyText).not.toContain('0/5');
  });

  it('keeps handmade saves in create mode for reference drafts and still allows resetting active edits', () => {
    const view = getVoicePanelControlsViewModel({
      voiceUiState: createDefaultVoiceUiState({
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            archivedAt: null,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
        customTargetPresetDraft: {
          presetId: 'preset-1',
          name: 'Saved Voice',
          basePreset: 'cute-feminine',
          pitchFloorHz: '',
          pitchCeilingHz: '',
          resonanceFloor: '',
          resonanceCeiling: '',
          weightFloor: '',
          weightCeiling: '',
          stylePrompt: '',
          notesText: '',
        },
      }),
      voiceConditioning: {
        useTargetProfileStyle: true,
        styleInstruction: '',
        promptText: '',
      },
      voiceConditioningStatusText: 'Idle',
      voicePracticeTargetLocked: false,
      currentSessionId: 'session-1',
      isConnected: true,
      voiceForecastStatus: 'idle',
      voiceSessionArmed: false,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      deepTutorOwnsLineSelection: false,
      activeLine: null,
      voiceDeepTutorLessonStatus: 'idle',
      shouldRebuildDeepTutorVoiceLesson: false,
      voiceCoachQuestionStatus: 'idle',
      voiceAudioInputDevicesCount: 0,
      conditioningPromptFileSelected: false,
      conditioningPromptTextPresent: false,
      conditioningReferenceFileSelected: false,
    });

    expect(view.saveHandmadePresetText).toBe('Save Handmade Preset');
    expect(view.seedCustomPresetDisabled).toBe(false);
  });

  it('builds input panel copy for hidden browser device labels', () => {
    const view = getVoiceInputPanelViewModel({
      comparison: null,
      voiceTransportStatus: 'idle',
      voiceResolvedInputLabel: null,
      voiceAudioInputDevices: [
        { deviceId: 'default', label: 'System default input', isDefault: true },
        { deviceId: 'mic-1', label: 'Audio input 2', isDefault: false },
      ],
      selectedInputDeviceId: 'mic-1',
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceSessionArmed: false,
      voiceAudioInputStatus: 'ready',
      voiceAudioInputError: null,
      voiceAudioInputNotice: null,
      liveLoudnessDb: null,
      liveConfidence: null,
    });

    expect(view.selectedText).toBe('Audio input 2');
    expect(view.reliabilityText).toBe('no scored take');
    expect(view.copyText).toContain('Grant mic access once to reveal the exact browser-visible device labels');
  });

  it('builds input panel copy for a live take with a quality issue', () => {
    const view = getVoiceInputPanelViewModel({
      comparison: {
        analysisQuality: {
          meanLoudnessDb: -14.2,
          meanConfidence: 0.66,
          scoreConfidence: 0.81,
          reliable: true,
          issues: ['Input level dipped near the ending.'],
        },
      } as any,
      voiceTransportStatus: 'streaming',
      voiceResolvedInputLabel: 'MOTU M4',
      voiceAudioInputDevices: [
        { deviceId: 'default', label: 'MOTU M4', isDefault: true },
      ],
      selectedInputDeviceId: 'default',
      voiceTakeProcessing: false,
      voiceTakeActive: true,
      voiceSessionArmed: true,
      voiceAudioInputStatus: 'ready',
      voiceAudioInputError: null,
      voiceAudioInputNotice: null,
      liveLoudnessDb: -12.4,
      liveConfidence: 0.74,
    });

    expect(view.selectedText).toBe('MOTU M4');
    expect(view.levelText).toBe('-12.4 dB');
    expect(view.signalText).toBe('74% live');
    expect(view.reliabilityText).toBe('81% trusted');
    expect(view.copyText).toBe('Live take is using MOTU M4. Input level dipped near the ending.');
  });
});

describe('Phase 1.4 target-fit UX labels', () => {

  it('returns target-fit label from pitchTargetOccupancyPct when available', () => {
    const state = {
      lastSummary: {
        metrics: {
          targetHitPct: 0.42,
          advanced: { pitchTargetOccupancyPct: 88 },
        },
      },
    } as any;
    const text = getVoiceTargetFitText(state);
    expect(text).toMatch(/strong/);
    expect(text).toMatch(/88%/);
  });

  it('returns mixed target-fit label at 55-79% occupancy', () => {
    const state = {
      lastSummary: { metrics: { advanced: { pitchTargetOccupancyPct: 60 } } },
    } as any;
    expect(getVoiceTargetFitText(state)).toMatch(/mixed/);
  });

  it('returns drifting target-fit label below 55%', () => {
    const state = {
      lastSummary: { metrics: { advanced: { pitchTargetOccupancyPct: 30 } } },
    } as any;
    expect(getVoiceTargetFitText(state)).toMatch(/drifting/);
  });

  it('returns empty string when no occupancy is available', () => {
    const state = { lastSummary: { metrics: {} } } as any;
    expect(getVoiceTargetFitText(state)).toBe('');
  });

  it('suppresses target-fit and derived pitch copy when measurement was rejected', () => {
    const state = {
      lastSummary: {
        metrics: {
          meanPitchHz: 201.5,
          advanced: {
            measurementAvailable: false,
            pitchTargetOccupancyPct: 99,
            phraseFinalDropSemitones: 1.5,
          },
        },
      },
    } as any;

    expect(getVoiceTargetFitText(state)).toBe('');
    expect(getVoicePhraseFinalDropText(state)).toBe('');
    expect(getVoiceBaselineDeltaText(state, { meanPitchHz: 180 } as any)).toBe('');
  });

  it('describes phrase-final drop in semitones', () => {
    const state1 = { lastSummary: { metrics: { advanced: { phraseFinalDropSemitones: -4.2 } } } } as any;
    expect(getVoicePhraseFinalDropText(state1)).toMatch(/dropped about 4.2 semitones/);

    const state2 = { lastSummary: { metrics: { advanced: { phraseFinalDropSemitones: 0.3 } } } } as any;
    expect(getVoicePhraseFinalDropText(state2)).toMatch(/stable/);

    const state3 = { lastSummary: { metrics: { advanced: { phraseFinalDropSemitones: 1.5 } } } } as any;
    expect(getVoicePhraseFinalDropText(state3)).toMatch(/lifted/);
  });

  it('returns baseline-delta text only when baseline + last take are present', () => {
    const baseline = { meanPitchHz: 200, frozen: true };
    const stateWithDelta = {
      lastSummary: { metrics: { meanPitchHz: 215 } },
    } as any;
    expect(getVoiceBaselineDeltaText(stateWithDelta, baseline)).toMatch(/15 Hz up/);

    const stateAtBaseline = {
      lastSummary: { metrics: { meanPitchHz: 200 } },
    } as any;
    expect(getVoiceBaselineDeltaText(stateAtBaseline, baseline)).toMatch(/right at your baseline/);

    const stateNoBaseline = { lastSummary: { metrics: { meanPitchHz: 215 } } } as any;
    expect(getVoiceBaselineDeltaText(stateNoBaseline, null)).toBe('');
  });

  it('labels discrete pitch status', () => {
    expect(getPitchFitStatusLabel('in_band')).toBe('in band');
    expect(getPitchFitStatusLabel('below')).toBe('below band');
    expect(getPitchFitStatusLabel('above')).toBe('above band');
    expect(getPitchFitStatusLabel('unstable')).toBe('unstable');
    expect(getPitchFitStatusLabel('uncertain')).toBe('measuring…');
    expect(getPitchFitStatusLabel(null)).toBe('measuring…');
  });
});
