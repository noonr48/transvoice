import { describe, expect, it } from 'vitest';
import {
  createDeepTutorVoiceSharedInteractionState,
  getDeepTutorVoiceLessonMode,
  getLatestVoiceCoachThreadMessage,
  isVoiceAttemptMeasurementUsable,
  normalizeVoiceDrillState,
  normalizeVoiceInputRuntimeState,
  normalizeVoiceSelfReport,
  normalizeVoiceUiState,
  resolveDeepTutorVoicePracticeIntent,
  resolveVoiceCoachMessageChannel,
} from './state';

describe('voice state', () => {
  it('preserves the selected drill kind used by take-specific calibration', () => {
    const drillState = normalizeVoiceDrillState({
      targetPreset: 'masculine',
      selectedLessonId: 'masc-vocalise-sustained',
      drills: [{
        id: 'masc-vocalise-sustained',
        kind: 'sustained',
        title: 'Steady vowel',
        focus: 'steady',
        phrase: 'ahh',
        description: 'hold',
        cues: [],
        tags: ['vocalise', 'stability'],
      }],
      selectedDrill: null,
    });

    expect(drillState.selectedDrill).toMatchObject({
      id: 'masc-vocalise-sustained',
      kind: 'sustained',
      tags: ['vocalise', 'stability'],
    });
  });

  it('uses the shared scoring floors while preserving metric-only legacy summaries', () => {
    expect(isVoiceAttemptMeasurementUsable({ targetHitPct: 0.7 })).toBe(true);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.99,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.47,
        voicedFramePct: 0.44,
        confidentFramePct: 0.49,
        captureReliability: 0.49,
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.7,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.48,
        voicedFramePct: 0.45,
        confidentFramePct: 0.5,
        captureReliability: 0.5,
      },
    })).toBe(true);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.99,
      advanced: {
        measurementAvailable: true,
        reliabilityFlags: ['no_voiced_frames'],
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.99,
      advanced: {
        measurementAvailable: true,
        measurementRejectionReasons: ['no_voiced_frames'],
        scoreConfidence: 0.9,
        voicedFramePct: 0.9,
        confidentFramePct: 0.9,
        captureReliability: 0.9,
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.99,
      advanced: {
        measurementAvailable: true,
        measurementRejectionReasons: [],
        rejectionReasons: ['no_voiced_frames'],
        scoreConfidence: 0.9,
        voicedFramePct: 0.9,
        confidentFramePct: 0.9,
        captureReliability: 0.9,
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.99,
      advanced: {
        measurementAvailable: true,
        reliabilityFlags: ['low_score_confidence'],
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.7,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.55,
        reliabilityFlags: ['low_score_confidence'],
      },
    })).toBe(true);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.7,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.8,
        voicedFramePct: 0.32,
        pitchValidFrameCount: 80,
        confidentFramePct: 0.8,
        captureReliability: 0.8,
        snrDb: 24,
        clippingPct: 0,
      },
    })).toBe(true);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.7,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.8,
        voicedFramePct: 0.8,
        pitchValidFrameCount: 80,
        confidentFramePct: 0.8,
        captureReliability: 0.8,
        snrDb: 11.99,
        clippingPct: 0,
      },
    })).toBe(false);
    expect(isVoiceAttemptMeasurementUsable({
      targetHitPct: 0.7,
      advanced: {
        measurementAvailable: true,
        measurementRejectionReasons: ['sustained_clipping'],
        scoreConfidence: 0.8,
        voicedFramePct: 0.8,
        pitchValidFrameCount: 80,
        confidentFramePct: 0.8,
        captureReliability: 0.8,
      },
    })).toBe(false);
  });

  it('infers coach thread channels from runtime and shortcut kinds', () => {
    const normalized = normalizeVoiceUiState({
      coachThread: [
        {
          id: 'coach-1',
          role: 'coach',
          kind: 'runtime-answer',
          content: 'Realtime note',
          createdAt: 1,
        },
        {
          id: 'user-1',
          role: 'user',
          kind: 'brief-action-question',
          content: 'say that again',
          createdAt: 2,
        },
      ],
    } as any);

    expect(normalized.coachThread[0]?.channel).toBe('runtime');
    expect(normalized.coachThread[1]?.channel).toBe('shortcut');
  });

  it('resolves explicit thread channels consistently with the kind contract', () => {
    expect(resolveVoiceCoachMessageChannel('legacy-answer')).toBe('legacy');
    expect(resolveVoiceCoachMessageChannel('deeptutor-lesson-advance')).toBe('deeptutor');
    expect(resolveVoiceCoachMessageChannel('brief-hold')).toBe('shortcut');
    expect(resolveVoiceCoachMessageChannel('follow-up-question')).toBe('coach');
  });

  it('returns the latest normalized coach reply from the thread', () => {
    const latest = getLatestVoiceCoachThreadMessage([
      {
        id: 'user-1',
        role: 'user',
        channel: 'coach',
        kind: 'follow-up-question',
        content: 'Can you repeat that?',
        createdAt: 1,
      },
      {
        id: 'coach-1',
        role: 'coach',
        kind: 'legacy-answer',
        content: 'Older coach reply',
        createdAt: 2,
      } as any,
      {
        id: 'coach-2',
        role: 'coach',
        kind: 'runtime-answer',
        content: 'Newest realtime coach reply',
        createdAt: 3,
      } as any,
    ], 'coach');

    expect(latest?.id).toBe('coach-2');
    expect(latest?.channel).toBe('runtime');
  });

  it('distinguishes active guided lessons from stale lesson history', () => {
    expect(getDeepTutorVoiceLessonMode({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'learning',
      lessonBoard: { title: 'Bright endings' },
    })).toBe('active');

    expect(getDeepTutorVoiceLessonMode({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'completed',
      lessonBoard: { title: 'Bright endings' },
      lastTutorMessage: 'Stay bright on the ending.',
    })).toBe('history');

    expect(getDeepTutorVoiceLessonMode(null)).toBe('none');
  });

  it('derives shared DeepTutor practice intent and ownership semantics from one contract', () => {
    expect(resolveDeepTutorVoicePracticeIntent({
      coachBrief: { immediateAction: 'practice' },
    } as any)).toBe('practice');

    expect(resolveDeepTutorVoicePracticeIntent({
      lessonBoard: {
        mimicDirective: {
          action: 'repeat',
        },
      },
    } as any)).toBe('practice');

    expect(createDeepTutorVoiceSharedInteractionState({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'learning',
      runtimeState: 'listening',
    }, {
      referenceMimicAction: 'repeat',
    })).toMatchObject({
      lessonMode: 'active',
      runtimeOwner: 'listening',
      practiceIntent: 'practice',
      hasActiveGuideSession: true,
      ownsGuidedLineChanges: true,
      acceptsRealtimeCoachTurns: true,
    });
  });

  it('clamps advanced-panel VAD tunables and applies safe defaults', () => {
    const normalized = normalizeVoiceUiState({
      advancedPanel: {
        open: true,
        vadRmsThreshold: 0.5,
        vadSilenceHoldMs: -10,
        vadNoSpeechTimeoutMs: 999999,
        vadMinSpeechMs: 20,
        audioPreferWorklet: false,
      },
    } as any);

    expect(normalized.advancedPanel.open).toBe(true);
    expect(normalized.advancedPanel.vadRmsThreshold).toBe(0.08);
    expect(normalized.advancedPanel.vadSilenceHoldMs).toBe(4500);
    expect(normalized.advancedPanel.vadNoSpeechTimeoutMs).toBe(20000);
    expect(normalized.advancedPanel.vadMinSpeechMs).toBe(150);
    expect(normalized.advancedPanel.audioPreferWorklet).toBe(false);

    const defaults = normalizeVoiceUiState({} as any).advancedPanel;
    expect(defaults.vadRmsThreshold).toBe(0.018);
    expect(defaults.vadSilenceHoldMs).toBe(4500);
    expect(defaults.vadNoSpeechTimeoutMs).toBe(12000);
    expect(defaults.vadMinSpeechMs).toBe(350);
    expect(defaults.audioPreferWorklet).toBe(true);
  });

  it('keeps nullable input-runtime durations and confidence fields nullable', () => {
    expect(normalizeVoiceInputRuntimeState({
      lastCaptureDurationMs: null,
      lastRoundTripMs: null,
      lastTranscriptConfidence: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
    })).toMatchObject({
      lastCaptureDurationMs: null,
      lastRoundTripMs: null,
      lastTranscriptConfidence: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
    });

    const uiState = normalizeVoiceUiState({
      deeptutorVoiceState: {
        latestInputEvidence: {
          transcript: 'Retain this evidence object',
          speechDurationMs: null,
          captureDurationMs: null,
          audioProcessedMs: null,
          roundTripMs: null,
          lastProcessedAt: null,
          lastEventAt: null,
          lastBargeInAt: null,
        },
      },
    } as any);
    expect(uiState.deeptutorVoiceState?.latestInputEvidence).toMatchObject({
      speechDurationMs: null,
      captureDurationMs: null,
      audioProcessedMs: null,
      roundTripMs: null,
      lastProcessedAt: null,
      lastEventAt: null,
      lastBargeInAt: null,
    });
  });

  it('normalizes optional voice self-report ratings without inventing labels', () => {
    expect(normalizeVoiceUiState({} as any).selfReportDraft).toMatchObject({
      effort: null,
      strain: null,
      perceivedDifficulty: null,
      confidence: null,
    });

    const normalized = normalizeVoiceSelfReport({
      effort: '4' as any,
      strain: 8 as any,
      perceivedDifficulty: 2.4,
      confidence: 0 as any,
      notes: '  felt stable  ',
      tags: [' easy ', '', 'carryover'],
    });

    expect(normalized).toMatchObject({
      effort: 4,
      strain: null,
      perceivedDifficulty: 2,
      confidence: null,
      notes: 'felt stable',
      tags: ['easy', 'carryover'],
    });
  });

  it('normalizes nested advanced voice analysis payloads without losing analysis versions', () => {
    const normalized = normalizeVoiceUiState({
      lastSummary: {
        voiceSessionId: 'voice-1',
        durationMs: 1400,
        analysisVersion: 'voice-metrics-v2',
        metrics: {
          meanPitchHz: 211.129,
          advanced: {
            sampleCount: 23.9,
            measurementAvailable: false,
            measurementRejectionReasons: [' no_voiced_frames '],
            pitchValidFrameCount: 0,
            hnrValidFrameCount: 0,
            hnrVoicedCoveragePct: 0,
            pitchP10Hz: 182.229,
            pitchStdSt: 2.1739,
            formantLite: {
              f2MedianHz: 1824.334,
              frontnessScore: 0.61234,
              frontnessShift: -0.0849,
            },
            quality: {
              cppsLike: 11.376,
              harmonicStrength: 7.614,
              breathyRisk: 0.3244,
              strainRisk: 0.1789,
            },
            reliabilityFlags: [' quiet_input ', '', null, 'low_score_confidence'],
          },
        },
        target: {
          source: 'custom-handmade',
          targetPreset: 'masculine',
          targetProfileId: 'grounded-custom',
          direction: 'masculine',
          pitchFloorHz: 100.126,
          pitchCeilingHz: 140.224,
          resonanceFloor: 0.1,
          resonanceCeiling: 0.3,
          weightFloor: 0.6,
          weightCeiling: 0.8,
          minTargetHitPct: 0.3,
          pitchPlacement: 'in_band',
        },
      },
      referenceAnalysis: {
        clipId: 'clip-1',
        filename: 'ref.wav',
        analysisVersion: 'voice-metrics-v2',
        metrics: {
          advanced: {
            voicedFramePct: 0.81234,
            formantLite: {
              f2MedianHz: 1911.192,
              frontnessScore: 0.6888,
            },
          },
        },
      },
      targetVoiceProfile: {
        profileId: 'profile-1',
        clipId: 'clip-1',
        analysisVersion: 'voice-metrics-v2',
        advancedBands: {
          pitchP10HzFloor: 188.332,
          phraseEndDropHzCeiling: 13.445,
          formantLite: {
            f2FloorHz: 1732.662,
            frontnessFloor: 0.5449,
          },
          quality: {
            cppsLikeFloor: 8.612,
            harmonicStrengthFloor: 5.433,
            breathyRiskCeiling: 0.4318,
            strainRiskCeiling: 0.2877,
          },
        },
      },
      phraseForecast: {
        phrase: ' Stay lifted ',
        analysisVersion: 'voice-metrics-v2',
        metrics: {
          advanced: {
            contourSimilarity: 0.61234,
          },
        },
        timeline: [],
      },
      phraseComparison: {
        phrase: 'Stay lifted',
        pathMatchScore: 0.82,
        targetZoneScore: 0.76,
        summary: 'Good match',
        checkpoints: [
          {
            label: 'ending',
            summary: 'keep it lifted',
            pathMatchScore: 0.61,
            laneMatchScore: 0.58,
            contourMatchScore: 0.67,
            corridorHoldScore: 0.71,
            detailPills: [' pitch floor ', '', null, 'stability'],
          },
        ],
      },
    } as any);

    expect(normalized.lastSummary?.analysisVersion).toBe('voice-metrics-v2');
    expect(normalized.lastSummary?.metrics?.advanced).toMatchObject({
      sampleCount: 24,
      measurementAvailable: false,
      measurementRejectionReasons: ['no_voiced_frames'],
      pitchValidFrameCount: 0,
      hnrValidFrameCount: 0,
      hnrVoicedCoveragePct: 0,
      pitchP10Hz: 182.23,
      pitchStdSt: 2.174,
      formantLite: {
        f2MedianHz: 1824.33,
        frontnessScore: 0.61234,
        frontnessShift: -0.085,
      },
      quality: {
        cppsLike: 11.38,
        harmonicStrength: 7.61,
        breathyRisk: 0.3244,
        strainRisk: 0.1789,
      },
      reliabilityFlags: ['quiet_input', 'low_score_confidence'],
    });
    expect(normalized.lastSummary?.target).toMatchObject({
      source: 'custom-handmade',
      targetProfileId: 'grounded-custom',
      direction: 'masculine',
      pitchFloorHz: 100.13,
      pitchCeilingHz: 140.22,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      pitchPlacement: 'in_band',
    });
    expect(normalized.referenceAnalysis?.analysisVersion).toBe('voice-metrics-v2');
    expect(normalized.referenceAnalysis?.metrics?.advanced).toMatchObject({
      voicedFramePct: 0.81234,
      formantLite: {
        f2MedianHz: 1911.19,
        frontnessScore: 0.6888,
      },
    });
    expect(normalized.targetVoiceProfile?.advancedBands).toMatchObject({
      pitchP10HzFloor: 188.33,
      phraseEndDropHzCeiling: 13.45,
      formantLite: {
        f2FloorHz: 1732.66,
        frontnessFloor: 0.5449,
      },
      quality: {
        cppsLikeFloor: 8.61,
        harmonicStrengthFloor: 5.43,
        breathyRiskCeiling: 0.4318,
        strainRiskCeiling: 0.2877,
      },
    });
    expect(normalized.phraseForecast?.analysisVersion).toBe('voice-metrics-v2');
    expect(normalized.phraseForecast?.metrics?.advanced?.contourSimilarity).toBe(0.61234);
    expect(normalized.phraseComparison?.checkpoints?.[0]?.detailPills).toEqual(['pitch floor', 'stability']);
  });

  it('round-trips every current Python v2 metric field without dropping explicit zeros', () => {
    const pythonPayload = {
      lastTakeTimeline: [
        {
          t: 0,
          voiced: true,
          pitchHz: 0,
          pitchScore: 0,
          resonanceScore: 0,
          weightScore: 0,
          confidence: 0,
          loudnessDb: 0,
          advanced: {
            harmonicNoiseRatioDb: 0,
          },
          analysisVersion: 'voice-metrics-v2',
        },
      ],
      lastSummary: {
        voiceSessionId: 'voice-python-v2',
        durationMs: 0,
        targetPreset: 'reference-copy',
        metrics: {
          meanPitchHz: 0,
          pitchRangeSt: 0,
          resonanceMean: 0,
          weightMean: 0,
          targetHitPct: 0,
          similarityScore: 0,
          advanced: {
            glideSmoothness: 0,
            f2RangeHz: 0,
            trillRateHz: 0,
            trillDetected: false,
            trillDurationMs: 0,
            hitPitchCeiling: false,
            analysisProfile: 'no_formants',
            quality: {
              jitterLocal: 0,
              jitterRap: 0,
              jitterPpq5: 0,
              shimmerLocal: 0,
              shimmerApq3: 0,
              shimmerApq5: 0,
            },
          },
        },
        target: {
          source: 'reference',
          targetPreset: 'reference-copy',
          referenceMeanPitchHz: 0,
          referenceResonanceMean: 0,
          referenceWeightMean: 0,
          referenceF2MedianHz: 0,
          pitchPlacement: 'in_band',
          pitchGapHz: 0,
          resonanceGap: 0,
          weightGap: 0,
        },
        analysisVersion: 'voice-metrics-v2',
      },
    };

    const normalized = normalizeVoiceUiState(JSON.parse(JSON.stringify(pythonPayload)) as any);
    const roundTripped = normalizeVoiceUiState(JSON.parse(JSON.stringify(normalized)) as any);

    expect(roundTripped.lastTakeTimeline?.[0]?.advanced).toMatchObject({
      harmonicNoiseRatioDb: 0,
    });
    expect(roundTripped.lastSummary?.metrics?.advanced).toMatchObject({
      glideSmoothness: 0,
      f2RangeHz: 0,
      trillRateHz: 0,
      trillDetected: false,
      trillDurationMs: 0,
      hitPitchCeiling: false,
      analysisProfile: 'no_formants',
      quality: {
        jitterLocal: 0,
        jitterRap: 0,
        jitterPpq5: 0,
        shimmerLocal: 0,
        shimmerApq3: 0,
        shimmerApq5: 0,
      },
    });
    expect(roundTripped.lastSummary?.target).toMatchObject({
      referenceMeanPitchHz: 0,
      referenceResonanceMean: 0,
      referenceWeightMean: 0,
      referenceF2MedianHz: 0,
      pitchGapHz: 0,
      resonanceGap: 0,
      weightGap: 0,
    });
  });

  it('keeps missing phrase-comparison evidence null while preserving explicit zero', () => {
    const normalized = normalizeVoiceUiState({
      phraseComparison: {
        phrase: 'Contract probe',
        pathMatchScore: null,
        laneMatchScore: null,
        contourMatchScore: null,
        corridorHoldScore: null,
        targetZoneScore: 0,
        analysisQuality: {
          sampleCount: null,
          voicedFramePct: null,
          confidentFramePct: null,
          meanConfidence: null,
          meanLoudnessDb: null,
          scoreConfidence: null,
          reliable: null,
          issues: [],
        },
        checkpoints: [
          {
            label: 'missing',
            pathMatchScore: null,
            laneMatchScore: null,
            contourMatchScore: null,
            corridorHoldScore: null,
            startProgress: null,
            endProgress: null,
          },
          {
            label: 'explicit zero',
            pathMatchScore: 0,
            startProgress: 0,
            endProgress: 0,
          },
        ],
      },
    } as any);

    expect(normalized.phraseComparison).toMatchObject({
      pathMatchScore: null,
      laneMatchScore: null,
      contourMatchScore: null,
      corridorHoldScore: null,
      targetZoneScore: 0,
      analysisQuality: null,
    });
    expect(normalized.phraseComparison?.checkpoints?.[0]).toMatchObject({
      label: 'missing',
      pathMatchScore: null,
      startProgress: null,
    });
    expect(normalized.phraseComparison?.checkpoints?.[1]).toMatchObject({
      label: 'explicit zero',
      pathMatchScore: 0,
      startProgress: 0,
      endProgress: 0,
    });
  });
});
