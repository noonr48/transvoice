import type {
  VoiceAttemptMetrics,
  VoiceCueSheet,
  VoiceCustomTargetPreset,
  VoiceDrill,
  VoiceDrillState,
  VoiceLiveFrame,
  VoicePhraseComparison,
} from '../state';
import type {
  VoiceCoachThreadViewModel,
  VoiceScriptPadViewModel,
} from '../view-model';
import { renderVoiceDrillList, renderVoiceRecommendedDrills } from './drills';
import { renderVoiceFocusLine } from './focus-line';
import {
  renderVoiceCueSheet,
  renderVoicePhraseCheckpoints,
  renderVoicePhraseQuickFeedback,
} from './phrase';
import { renderVoiceCustomPresetList } from './custom-presets';
import {
  renderVoiceForecastPath,
  renderVoiceGraphDot,
  renderVoicePolylinePath,
} from './graph';

type VoiceRenderAudioInputDevice = {
  deviceId: string;
  label: string;
  isDefault: boolean;
};

type VoiceOverlayVisibilityState = {
  live: boolean;
  forecast: boolean;
  reference: boolean;
};

type VoiceDrillSelectHandler = (drillId: string) => Promise<void>;
type VoiceDrillSelectErrorHandler = (error: unknown) => void;

export type VoiceRenderOrchestrationElements = {
  voiceInputDeviceSelect: HTMLSelectElement | null | undefined;
  voiceToggleLivePathBtn: HTMLButtonElement | null | undefined;
  voiceToggleForecastPathBtn: HTMLButtonElement | null | undefined;
  voiceToggleReferencePathBtn: HTMLButtonElement | null | undefined;
  voiceRecommendedDrillsEl: HTMLElement | null | undefined;
  voiceDrillListEl: HTMLElement | null | undefined;
  voiceCueSheetMetaEl: HTMLElement | null | undefined;
  voiceCueSheetLineEl: HTMLElement | null | undefined;
  voiceCueSheetTokensEl: HTMLElement | null | undefined;
  voicePhraseQuickFeedbackEl: HTMLElement | null | undefined;
  voicePhraseCheckpointsEl: HTMLElement | null | undefined;
  voiceScriptPadLabelEl: HTMLElement;
  voiceActiveLineTextEl: HTMLElement;
  voiceActiveLinePerformanceEl: HTMLElement;
  voiceActiveLineMetaEl: HTMLElement;
  voiceActiveLineCuesEl: HTMLElement;
  voiceLessonBoardNoteEl: HTMLElement;
  voiceLessonActionsEl: HTMLElement;
  voiceLineActionsEl: HTMLElement;
  voiceDeepTutorStartBtn: HTMLButtonElement;
  voiceDeepTutorNextBtn: HTMLButtonElement;
  voiceLinePinBtn: HTMLButtonElement;
  voiceCoachThreadEl: HTMLElement | null | undefined;
  voiceReferencePathEl: SVGSVGElement | null | undefined;
  voiceReferencePolylineEl: SVGPolylineElement | null | undefined;
  voiceGraphDotEl: HTMLElement | null | undefined;
  voiceReferenceDotEl: HTMLElement | null | undefined;
  voiceCustomPresetListEl: HTMLElement | null | undefined;
  voiceForecastPathEl: SVGSVGElement | null | undefined;
  voiceForecastPolylineEl: SVGPolylineElement | null | undefined;
  voiceForecastCorridorEl: SVGPolylineElement | null | undefined;
  voiceLivePathEl: SVGSVGElement | null | undefined;
  voiceLivePolylineEl: SVGPolylineElement | null | undefined;
};

export type VoiceRenderOrchestrationState = {
  voiceAudioInputDevices: VoiceRenderAudioInputDevice[];
  selectedInputDeviceId: string | null;
  audioInputOptionsSignature: string;
  overlayVisibility: VoiceOverlayVisibilityState;
  hasLivePath: boolean;
  hasForecastPath: boolean;
  hasReferencePath: boolean;
  recommendedDrills: VoiceDrill[];
  selectedDrillId: string | null;
  drillStatus: 'idle' | 'loading' | 'error';
  currentSessionId: string | null;
  isConnected: boolean;
  targetMutationLocked: boolean;
  selectionPendingId: string | null;
  onSelectDrill: VoiceDrillSelectHandler;
  onSelectError: VoiceDrillSelectErrorHandler;
  drillState: VoiceDrillState;
  drillError: string | null;
  cueSheet: VoiceCueSheet | null;
  comparison: VoicePhraseComparison | null | undefined;
  comparisonMatchesCueSheet: boolean;
  hasForecastTimeline: boolean;
  customTargetPresets: VoiceCustomTargetPreset[];
  selectedCustomPresetId: string | null;
  targetSource: string;
  scriptPad: VoiceScriptPadViewModel;
  deepTutorResumeButtonText: string;
  deepTutorNextButtonText: string;
  linePinButtonText: string;
  coachThread: VoiceCoachThreadViewModel;
  liveMetrics: Partial<VoiceAttemptMetrics> | null;
  referenceMetrics: Partial<VoiceAttemptMetrics> | null;
  referencePathTimeline: VoiceLiveFrame[] | null | undefined;
  forecastPathTimeline: VoiceLiveFrame[] | null | undefined;
  livePathTimeline: VoiceLiveFrame[] | null | undefined;
};

function replacePills(container: HTMLElement, pills: string[]): void {
  container.replaceChildren();
  for (const pillText of pills) {
    const pill = document.createElement('span');
    pill.className = 'voice-pill';
    pill.textContent = pillText;
    container.appendChild(pill);
  }
}

function renderVoiceAudioInputOptions(
  selectEl: HTMLSelectElement | null | undefined,
  devices: VoiceRenderAudioInputDevice[],
  selectedDeviceId: string | null,
  signature: string,
): string {
  if (!selectEl) {
    return signature;
  }

  const nextSignature = JSON.stringify(devices.map((device) => [
    device.deviceId,
    device.label,
    Boolean(device.isDefault),
  ]));

  if (nextSignature !== signature) {
    selectEl.replaceChildren();
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label;
      selectEl.appendChild(option);
    }
  }

  const nextValue = selectedDeviceId || 'default';
  if (selectEl.value !== nextValue) {
    selectEl.value = nextValue;
  }

  return nextSignature;
}

function setVoiceOverlayToggleState(
  button: HTMLButtonElement | null | undefined,
  active: boolean,
  available: boolean,
): void {
  if (!button) return;
  button.classList.toggle('active', active);
  button.disabled = !available;
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function renderVoiceScriptPadDom(
  elements: Pick<
    VoiceRenderOrchestrationElements,
    | 'voiceScriptPadLabelEl'
    | 'voiceActiveLineTextEl'
    | 'voiceActiveLinePerformanceEl'
    | 'voiceActiveLineMetaEl'
    | 'voiceActiveLineCuesEl'
    | 'voiceLessonBoardNoteEl'
    | 'voiceLessonActionsEl'
    | 'voiceLineActionsEl'
    | 'voiceDeepTutorStartBtn'
    | 'voiceDeepTutorNextBtn'
    | 'voiceLinePinBtn'
  >,
  state: Pick<
    VoiceRenderOrchestrationState,
    | 'scriptPad'
    | 'cueSheet'
    | 'deepTutorResumeButtonText'
    | 'deepTutorNextButtonText'
    | 'linePinButtonText'
  >,
): void {
  elements.voiceScriptPadLabelEl.textContent = state.scriptPad.labelText;
  // Approach B: the focus line carries target-pronunciation emphasis inline.
  renderVoiceFocusLine(elements.voiceActiveLineTextEl, state.scriptPad.lineText, state.cueSheet);
  elements.voiceActiveLinePerformanceEl.textContent = state.scriptPad.performanceText;
  replacePills(elements.voiceActiveLineMetaEl, state.scriptPad.metaPills);
  replacePills(elements.voiceActiveLineCuesEl, state.scriptPad.cuePills);

  elements.voiceLessonBoardNoteEl.parentElement?.classList.toggle('hidden', !state.scriptPad.showLessonNote);
  elements.voiceLessonBoardNoteEl.textContent = state.scriptPad.lessonNote;
  elements.voiceLessonActionsEl.classList.toggle('hidden', !state.scriptPad.showLessonActions);
  elements.voiceLineActionsEl.classList.toggle('hidden', !state.scriptPad.showLineActions);
  elements.voiceDeepTutorStartBtn.textContent = state.deepTutorResumeButtonText;
  elements.voiceDeepTutorNextBtn.textContent = state.deepTutorNextButtonText;
  elements.voiceLinePinBtn.textContent = state.linePinButtonText;
}

function renderVoiceCoachThreadDom(
  threadEl: HTMLElement | null | undefined,
  threadView: VoiceCoachThreadViewModel,
): void {
  if (!threadEl) return;
  threadEl.replaceChildren();

  if (threadView.emptyCopy) {
    const empty = document.createElement('div');
    empty.className = 'voice-coach-empty';
    empty.textContent = threadView.emptyCopy;
    threadEl.appendChild(empty);
  }

  for (const message of threadView.bubbles) {
    const bubble = document.createElement('div');
    bubble.className = `voice-coach-bubble ${message.role}`;

    const label = document.createElement('span');
    label.className = 'voice-coach-bubble-label';
    label.textContent = message.label;

    const content = document.createElement('p');
    content.textContent = message.content;

    bubble.append(label, content);
    threadEl.appendChild(bubble);
  }

  if (threadView.pendingBubble) {
    const pending = document.createElement('div');
    pending.className = 'voice-coach-bubble coach';

    const label = document.createElement('span');
    label.className = 'voice-coach-bubble-label';
    label.textContent = threadView.pendingBubble.label;

    const content = document.createElement('p');
    content.textContent = threadView.pendingBubble.content;

    pending.append(label, content);
    threadEl.appendChild(pending);
  }
}

export function applyVoiceRenderOrchestration(
  elements: VoiceRenderOrchestrationElements,
  state: VoiceRenderOrchestrationState,
): string {
  const nextAudioInputOptionsSignature = renderVoiceAudioInputOptions(
    elements.voiceInputDeviceSelect,
    state.voiceAudioInputDevices,
    state.selectedInputDeviceId,
    state.audioInputOptionsSignature,
  );

  setVoiceOverlayToggleState(
    elements.voiceToggleLivePathBtn,
    state.overlayVisibility.live,
    state.hasLivePath,
  );
  setVoiceOverlayToggleState(
    elements.voiceToggleForecastPathBtn,
    state.overlayVisibility.forecast,
    state.hasForecastPath,
  );
  setVoiceOverlayToggleState(
    elements.voiceToggleReferencePathBtn,
    state.overlayVisibility.reference,
    state.hasReferencePath,
  );

  renderVoiceRecommendedDrills({
    element: elements.voiceRecommendedDrillsEl,
    drills: state.recommendedDrills,
    selectedDrillId: state.selectedDrillId,
    drillStatus: state.drillStatus,
    currentSessionId: state.currentSessionId,
    isConnected: state.isConnected,
    targetMutationLocked: state.targetMutationLocked,
    selectionPendingId: state.selectionPendingId,
    onSelectDrill: state.onSelectDrill,
    onSelectError: state.onSelectError,
  });

  renderVoiceDrillList({
    element: elements.voiceDrillListEl,
    drillState: state.drillState,
    drillStatus: state.drillStatus,
    drillError: state.drillError,
    selectedDrillId: state.selectedDrillId,
    currentSessionId: state.currentSessionId,
    isConnected: state.isConnected,
    targetMutationLocked: state.targetMutationLocked,
    selectionPendingId: state.selectionPendingId,
    onSelectDrill: state.onSelectDrill,
    onSelectError: state.onSelectError,
  });

  renderVoiceCueSheet({
    metaEl: elements.voiceCueSheetMetaEl,
    lineEl: elements.voiceCueSheetLineEl,
    tokensEl: elements.voiceCueSheetTokensEl,
    cueSheet: state.cueSheet,
    comparison: state.comparison,
    comparisonMatchesCueSheet: state.comparisonMatchesCueSheet,
  });

  renderVoicePhraseQuickFeedback({
    element: elements.voicePhraseQuickFeedbackEl,
    comparison: state.comparison,
    hasForecastTimeline: state.hasForecastTimeline,
  });

  renderVoicePhraseCheckpoints({
    element: elements.voicePhraseCheckpointsEl,
    comparison: state.comparison,
    hasForecastTimeline: state.hasForecastTimeline,
  });
  renderVoiceCustomPresetList({
    element: elements.voiceCustomPresetListEl,
    presets: state.customTargetPresets,
    selectedPresetId: state.selectedCustomPresetId,
    targetSource: state.targetSource,
  });

  renderVoiceScriptPadDom(elements, state);
  renderVoiceCoachThreadDom(elements.voiceCoachThreadEl, state.coachThread);

  renderVoicePolylinePath({
    svgEl: elements.voiceReferencePathEl,
    polylineEl: elements.voiceReferencePolylineEl,
    timeline: state.overlayVisibility.reference ? state.referencePathTimeline : null,
  });

  renderVoiceGraphDot({
    element: elements.voiceGraphDotEl,
    metrics: state.liveMetrics,
    isReference: false,
  });

  renderVoiceGraphDot({
    element: elements.voiceReferenceDotEl,
    metrics: state.referenceMetrics,
    isReference: true,
  });

  renderVoiceForecastPath({
    svgEl: elements.voiceForecastPathEl,
    polylineEl: elements.voiceForecastPolylineEl,
    corridorEl: elements.voiceForecastCorridorEl,
    timeline: state.overlayVisibility.forecast ? state.forecastPathTimeline : null,
  });

  renderVoicePolylinePath({
    svgEl: elements.voiceLivePathEl,
    polylineEl: elements.voiceLivePolylineEl,
    timeline: state.overlayVisibility.live ? state.livePathTimeline : null,
  });

  return nextAudioInputOptionsSignature;
}
