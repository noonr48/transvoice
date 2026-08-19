import { describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceDrillState, type VoiceLiveFrame } from '../state';
import { applyVoiceRenderOrchestration, type VoiceRenderOrchestrationState } from './orchestration';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement<T extends keyof SVGElementTagNameMap>(tag: T): SVGElementTagNameMap[T] {
  return document.createElementNS(SVG_NS, tag);
}

function createElements() {
  const lessonBoardNoteContainer = document.createElement('div');
  const voiceLessonBoardNoteEl = document.createElement('div');
  lessonBoardNoteContainer.appendChild(voiceLessonBoardNoteEl);

  return {
    voiceInputDeviceSelect: document.createElement('select'),
    voiceToggleLivePathBtn: document.createElement('button'),
    voiceToggleForecastPathBtn: document.createElement('button'),
    voiceToggleReferencePathBtn: document.createElement('button'),
    voiceRecommendedDrillsEl: document.createElement('div'),
    voiceDrillListEl: document.createElement('div'),
    voiceCueSheetMetaEl: document.createElement('div'),
    voiceCueSheetLineEl: document.createElement('div'),
    voiceCueSheetTokensEl: document.createElement('div'),
    voicePhraseQuickFeedbackEl: document.createElement('div'),
    voicePhraseCheckpointsEl: document.createElement('div'),
    voiceScriptPadLabelEl: document.createElement('div'),
    voiceActiveLineTextEl: document.createElement('div'),
    voiceActiveLinePerformanceEl: document.createElement('div'),
    voiceActiveLineMetaEl: document.createElement('div'),
    voiceActiveLineCuesEl: document.createElement('div'),
    voiceLessonBoardNoteEl,
    voiceLessonActionsEl: document.createElement('div'),
    voiceLineActionsEl: document.createElement('div'),
    voiceDeepTutorStartBtn: document.createElement('button'),
    voiceDeepTutorNextBtn: document.createElement('button'),
    voiceLinePinBtn: document.createElement('button'),
    voiceCoachThreadEl: document.createElement('div'),
    voiceReferencePathEl: createSvgElement('svg'),
    voiceReferencePolylineEl: createSvgElement('polyline'),
    voiceGraphDotEl: document.createElement('div'),
    voiceReferenceDotEl: document.createElement('div'),
    voiceForecastPathEl: createSvgElement('svg'),
    voiceForecastPolylineEl: createSvgElement('polyline'),
    voiceForecastCorridorEl: createSvgElement('polyline'),
    voiceLivePathEl: createSvgElement('svg'),
    voiceLivePolylineEl: createSvgElement('polyline'),
    lessonBoardNoteContainer,
  };
}

function createTimeline(seed = 0): VoiceLiveFrame[] {
  return [
    {
      t: seed,
      voiced: true,
      pitchHz: 180,
      pitchScore: 0.7,
      resonanceScore: 0.52,
      weightScore: 0.46,
      confidence: 0.76,
      loudnessDb: -18,
    },
    {
      t: seed + 120,
      voiced: true,
      pitchHz: 208,
      pitchScore: 0.8,
      resonanceScore: 0.61,
      weightScore: 0.58,
      confidence: 0.82,
      loudnessDb: -15,
    },
  ];
}

function createState(overrides: Partial<VoiceRenderOrchestrationState> = {}): VoiceRenderOrchestrationState {
  return {
    voiceAudioInputDevices: [
      { deviceId: 'default', label: 'System default input', isDefault: true },
      { deviceId: 'usb-mic', label: 'USB Mic', isDefault: false },
    ],
    selectedInputDeviceId: 'usb-mic',
    audioInputOptionsSignature: '',
    overlayVisibility: {
      live: true,
      forecast: false,
      reference: true,
    },
    hasLivePath: true,
    hasForecastPath: false,
    hasReferencePath: false,
    recommendedDrills: [],
    selectedDrillId: null,
    drillStatus: 'idle',
    currentSessionId: 'session-1',
    isConnected: true,
    targetMutationLocked: false,
    selectionPendingId: null,
    onSelectDrill: vi.fn(async () => undefined),
    onSelectError: vi.fn(),
    drillState: createDefaultVoiceDrillState({ targetPreset: 'cute-feminine' }),
    drillError: null,
    cueSheet: null,
    comparison: null,
    comparisonMatchesCueSheet: false,
    hasForecastTimeline: false,
    scriptPad: {
      labelText: 'Lesson board',
      lineText: 'No line selected yet.',
      performanceText: 'Waiting for a line.',
      metaPills: [],
      cuePills: [],
      lessonNote: 'Waiting for a lesson.',
      showLessonNote: false,
      showLessonActions: false,
      showLineActions: false,
    },
    deepTutorResumeButtonText: 'Resume Lesson',
    deepTutorNextButtonText: 'Advance Lesson',
    linePinButtonText: 'Pin Line',
    coachThread: {
      emptyCopy: 'Coach will reply here.',
      bubbles: [],
      pendingBubble: null,
    },
    liveMetrics: null,
    referenceMetrics: null,
    referencePathTimeline: null,
    forecastPathTimeline: null,
    livePathTimeline: null,
    ...overrides,
  };
}

describe('voice render orchestration', () => {
  it('syncs audio input options and overlay toggle state', () => {
    const elements = createElements();

    const signature = applyVoiceRenderOrchestration(elements, createState({
      hasReferencePath: false,
      livePathTimeline: createTimeline(),
    }));

    expect(signature).not.toBe('');
    expect(elements.voiceInputDeviceSelect.options).toHaveLength(2);
    expect(elements.voiceInputDeviceSelect.value).toBe('usb-mic');
    expect(elements.voiceToggleLivePathBtn.classList.contains('active')).toBe(true);
    expect(elements.voiceToggleLivePathBtn.disabled).toBe(false);
    expect(elements.voiceToggleForecastPathBtn.disabled).toBe(true);
    expect(elements.voiceToggleReferencePathBtn.disabled).toBe(true);
    expect(elements.voiceToggleLivePathBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the script pad and coach thread view models', () => {
    const elements = createElements();

    applyVoiceRenderOrchestration(elements, createState({
      scriptPad: {
        labelText: 'Active lesson',
        lineText: 'Make the vowel brighter.',
        performanceText: 'Last take: 82% lane match',
        metaPills: ['Guide active', 'Phrase loaded'],
        cuePills: ['Jaw easy', 'Lift soft palate'],
        lessonNote: 'Stay out of the throat.',
        showLessonNote: true,
        showLessonActions: true,
        showLineActions: true,
      },
      deepTutorResumeButtonText: 'Resume DeepTutor',
      deepTutorNextButtonText: 'Advancing...',
      linePinButtonText: 'Pinned',
      coachThread: {
        emptyCopy: null,
        bubbles: [
          { role: 'user', label: 'You', content: 'Why did that drift?' },
          { role: 'coach', label: 'Coach', content: 'Your placement fell back.' },
        ],
        pendingBubble: { role: 'coach', label: 'Coach', content: 'Thinking...' },
      },
    }));

    expect(elements.voiceScriptPadLabelEl.textContent).toBe('Active lesson');
    expect(elements.voiceActiveLineTextEl.textContent).toBe('Make the vowel brighter.');
    expect(elements.voiceActiveLineMetaEl.children).toHaveLength(2);
    expect(elements.voiceActiveLineCuesEl.children).toHaveLength(2);
    expect(elements.lessonBoardNoteContainer.classList.contains('hidden')).toBe(false);
    expect(elements.voiceLessonActionsEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceLineActionsEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceDeepTutorStartBtn.textContent).toBe('Resume DeepTutor');
    expect(elements.voiceDeepTutorNextBtn.textContent).toBe('Advancing...');
    expect(elements.voiceLinePinBtn.textContent).toBe('Pinned');
    expect(elements.voiceCoachThreadEl.children).toHaveLength(3);
  });

  it('renders drill, phrase, and graph layers through the orchestration boundary', () => {
    const elements = createElements();
    const livePathTimeline = createTimeline();
    const referencePathTimeline = createTimeline(500);
    const forecastPathTimeline = createTimeline(900);

    applyVoiceRenderOrchestration(elements, createState({
      overlayVisibility: {
        live: true,
        forecast: true,
        reference: true,
      },
      hasLivePath: true,
      hasForecastPath: true,
      hasReferencePath: true,
      recommendedDrills: [{
        id: 'drill-1',
        title: 'Drill 1',
        focus: 'Forward resonance',
        phrase: 'Stay lifted',
        description: 'Keep the path narrow.',
        cues: ['Forward', 'Tall'],
        tags: [],
        cueSheet: null,
      }],
      selectedDrillId: 'drill-1',
      drillState: createDefaultVoiceDrillState({
        targetPreset: 'cute-feminine',
        drills: [{
          id: 'drill-1',
          title: 'Drill 1',
          focus: 'Forward resonance',
          phrase: 'Stay lifted',
          description: 'Keep the path narrow.',
          cues: ['Forward', 'Tall'],
          tags: [],
          cueSheet: null,
        }],
        recommendedIds: ['drill-1'],
      }),
      cueSheet: {
        phrase: 'Stay lifted',
        cueLine: 'Stay lifted',
        styledCueLine: 'Stay lifted now',
        phraseIntent: 'Guided',
        tokens: [
          {
            text: 'Stay',
            cue: 'Bright',
            startProgress: 0,
            endProgress: 0.45,
          },
          {
            text: 'lifted',
            cue: 'Tall',
            startProgress: 0.45,
            endProgress: 1,
          },
        ],
      },
      comparison: {
        phrase: 'Stay lifted',
        pathMatchScore: 0.78,
        laneMatchScore: 0.74,
        contourMatchScore: 0.69,
        corridorHoldScore: 0.71,
        targetZoneScore: 0.73,
        quickFeedback: ['Placement held.', 'Keep the second word taller.'],
        checkpoints: [{
          label: 'Word 1',
          summary: 'Strong opening path.',
          pathMatchScore: 0.82,
          laneMatchScore: 0.8,
          contourMatchScore: 0.74,
          corridorHoldScore: 0.78,
          startProgress: 0,
          endProgress: 0.5,
        }],
        summary: 'Good phrase match.',
      },
      comparisonMatchesCueSheet: true,
      hasForecastTimeline: true,
      liveMetrics: {
        meanPitchHz: 198,
        resonanceMean: 0.58,
        weightMean: 0.55,
        targetHitPct: 0.81,
      },
      referenceMetrics: {
        meanPitchHz: 205,
        resonanceMean: 0.64,
        weightMean: 0.42,
        targetHitPct: 0.77,
      },
      referencePathTimeline,
      forecastPathTimeline,
      livePathTimeline,
    }));

    expect(elements.voiceRecommendedDrillsEl.querySelectorAll('button')).toHaveLength(1);
    expect(elements.voiceDrillListEl.querySelectorAll('button')).toHaveLength(1);
    expect(elements.voicePhraseQuickFeedbackEl.children).toHaveLength(2);
    expect(elements.voicePhraseCheckpointsEl.children).toHaveLength(1);
    expect(elements.voiceCueSheetTokensEl.querySelectorAll('.voice-cue-token')).toHaveLength(2);
    expect(elements.voiceReferencePolylineEl.getAttribute('points')).not.toBe('');
    expect(elements.voiceForecastPolylineEl.getAttribute('points')).not.toBe('');
    expect(elements.voiceForecastCorridorEl.getAttribute('points')).toBe(
      elements.voiceForecastPolylineEl.getAttribute('points'),
    );
    expect(elements.voiceLivePolylineEl.getAttribute('points')).not.toBe('');
    expect(elements.voiceGraphDotEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceReferenceDotEl.classList.contains('hidden')).toBe(false);
  });
});
