import { describe, expect, it } from 'vitest';
import { createVoiceDomBindings } from './dom-bindings';

function appendHtml(parent: HTMLElement, tagName: string, id: string): HTMLElement {
  const element = document.createElement(tagName);
  element.id = id;
  parent.appendChild(element);
  return element;
}

function appendSvg(parent: HTMLElement, tagName: string, id: string): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  element.setAttribute('id', id);
  parent.appendChild(element);
  return element;
}

function populateVoiceDom(): { memoryStatsEl: HTMLElement; stageStatusEl: HTMLElement } {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);

  const elementTags: Array<[string, string]> = [
    ['div', 'voice-panel'],
    ['div', 'voice-lab-panel'],
    ['div', 'voice-stage-panel'],
    ['button', 'voice-advanced-toggle'],
    ['div', 'voice-advanced-content'],
    ['select', 'voice-target-preset'],
    ['input', 'voice-custom-preset-name'],
    ['select', 'voice-custom-preset-base'],
    ['input', 'voice-custom-preset-pitch-floor'],
    ['input', 'voice-custom-preset-pitch-ceiling'],
    ['input', 'voice-custom-preset-resonance-floor'],
    ['input', 'voice-custom-preset-resonance-ceiling'],
    ['input', 'voice-custom-preset-weight-floor'],
    ['input', 'voice-custom-preset-weight-ceiling'],
    ['input', 'voice-custom-preset-style-prompt'],
    ['textarea', 'voice-custom-preset-notes'],
    ['button', 'voice-save-reference-preset'],
    ['button', 'voice-remove-reference'],
    ['button', 'voice-seed-custom-preset'],
    ['button', 'voice-save-handmade-preset'],
    ['div', 'voice-custom-preset-list'],
    ['div', 'voice-service-health'],
    ['div', 'voice-session-status'],
    ['div', 'voice-sidebar-preset'],
    ['div', 'voice-student-mastery'],
    ['div', 'voice-student-review-count'],
    ['div', 'voice-knowledge-status'],
    ['div', 'voice-reference-summary'],
    ['div', 'voice-target-profile-summary'],
    ['div', 'voice-current-drill'],
    ['div', 'voice-recommended-drills'],
    ['div', 'voice-summary-overview'],
    ['div', 'voice-student-concepts'],
    ['div', 'voice-student-focus'],
    ['div', 'voice-learner-context-status'],
    ['div', 'voice-learner-context-dataset'],
    ['div', 'voice-learner-context-notepad'],
    ['div', 'voice-lab-learner-context-status'],
    ['div', 'voice-lab-learner-context-dataset'],
    ['div', 'voice-lab-learner-context-notepad'],
    ['div', 'voice-coach-copy'],
    ['div', 'voice-graph-status'],
    ['p', 'voice-live-cue'],
    ['nav', 'voice-session-spine'],
    ['div', 'voice-stream-url'],
    ['div', 'voice-drill-copy'],
    ['div', 'voice-drill-list'],
    ['div', 'voice-cue-sheet-copy'],
    ['div', 'voice-cue-sheet-meta'],
    ['div', 'voice-cue-sheet-line'],
    ['div', 'voice-cue-sheet-tokens'],
    ['div', 'voice-phrase-comparison-copy'],
    ['div', 'voice-phrase-quick-feedback'],
    ['div', 'voice-phrase-checkpoints'],
    ['select', 'voice-input-device'],
    ['div', 'voice-input-selected'],
    ['div', 'voice-input-level'],
    ['div', 'voice-input-signal'],
    ['div', 'voice-input-reliability'],
    ['div', 'voice-input-copy'],
    ['div', 'voice-input-runtime-status'],
    ['div', 'voice-input-runtime-provider'],
    ['div', 'voice-input-runtime-latency'],
    ['div', 'voice-input-runtime-counts'],
    ['div', 'voice-input-runtime-pills'],
    ['div', 'voice-input-runtime-copy'],
	    ['input', 'voice-forecast-phrase'],
	    ['button', 'voice-forecast-generate'],
	    ['select', 'voice-self-report-effort'],
	    ['select', 'voice-self-report-strain'],
	    ['select', 'voice-self-report-fatigue'],
	    ['select', 'voice-self-report-difficulty'],
	    ['select', 'voice-self-report-confidence'],
	    ['div', 'voice-self-report-copy'],
	    ['div', 'voice-target-profile-copy'],
    ['div', 'voice-forecast-copy'],
    ['div', 'voice-stage-session'],
    ['div', 'voice-stage-target'],
    ['div', 'voice-stage-reference'],
    ['div', 'voice-stage-target-voice'],
    ['div', 'voice-stage-forecast'],
    ['div', 'voice-stage-drill'],
    ['div', 'voice-stage-match'],
    ['div', 'voice-stage-lane'],
    ['div', 'voice-stage-contour'],
    ['div', 'voice-stage-zone'],
    ['div', 'voice-graph-dot'],
    ['div', 'voice-reference-dot'],
    ['button', 'voice-toggle-live-path'],
    ['button', 'voice-toggle-forecast-path'],
    ['button', 'voice-toggle-reference-path'],
    ['button', 'voice-start-session'],
    ['button', 'voice-end-session'],
    ['input', 'voice-reference-input'],
    ['audio', 'voice-reference-player'],
    ['div', 'voice-reference-mimic-meta'],
    ['div', 'voice-reference-playback-copy'],
    ['div', 'voice-script-pad-label'],
    ['div', 'voice-active-line-text'],
    ['div', 'voice-active-line-performance'],
    ['div', 'voice-active-line-meta'],
    ['div', 'voice-active-line-cues'],
    ['div', 'voice-lesson-board-note'],
    ['div', 'voice-lesson-actions'],
    ['div', 'voice-line-actions'],
    ['button', 'voice-deeptutor-start'],
    ['button', 'voice-deeptutor-next'],
    ['button', 'voice-line-regenerate'],
    ['button', 'voice-line-easier'],
    ['button', 'voice-line-harder'],
    ['button', 'voice-line-next'],
    ['button', 'voice-line-pin'],
    ['div', 'voice-active-drill-title'],
    ['div', 'voice-active-drill-copy'],
    ['div', 'voice-active-drill-state'],
    ['div', 'voice-coach-thread'],
    ['input', 'voice-coach-question'],
    ['button', 'voice-coach-live-toggle'],
    ['button', 'voice-coach-voice-toggle'],
    ['button', 'voice-coach-send'],
    ['button', 'voice-coach-speech-toggle'],
    ['button', 'voice-coach-provider-toggle'],
    ['button', 'voice-coach-input-provider-toggle'],
    ['input', 'voice-conditioning-use-profile-style'],
    ['input', 'voice-conditioning-style'],
    ['input', 'voice-conditioning-prompt-text'],
    ['input', 'voice-conditioning-prompt-file'],
    ['input', 'voice-conditioning-reference-file'],
    ['button', 'voice-conditioning-save'],
    ['button', 'voice-conditioning-prompt-upload'],
    ['button', 'voice-conditioning-reference-upload'],
    ['div', 'voice-conditioning-status'],
    ['input', 'voice-vad-rms-threshold'],
    ['input', 'voice-vad-silence-hold-ms'],
    ['input', 'voice-vad-no-speech-timeout-ms'],
    ['input', 'voice-vad-min-speech-ms'],
    ['input', 'voice-audio-prefer-worklet'],
  ];

  for (const [tagName, id] of elementTags) {
    const element = appendHtml(root, tagName, id);
    if (tagName === 'input' && (id.includes('file') || id === 'voice-reference-input')) {
      (element as HTMLInputElement).type = 'file';
    }
    if (
      tagName === 'input'
      && (id === 'voice-conditioning-use-profile-style' || id === 'voice-audio-prefer-worklet')
    ) {
      (element as HTMLInputElement).type = 'checkbox';
    }
  }

  appendSvg(root, 'svg', 'voice-reference-path');
  appendSvg(root, 'polyline', 'voice-reference-polyline');
  appendSvg(root, 'svg', 'voice-forecast-path');
  appendSvg(root, 'polyline', 'voice-forecast-corridor');
  appendSvg(root, 'polyline', 'voice-forecast-polyline');
  appendSvg(root, 'svg', 'voice-live-path');
  appendSvg(root, 'polyline', 'voice-live-polyline');

  const quickQuestion = appendHtml(root, 'button', 'voice-quick-question');
  quickQuestion.setAttribute('data-voice-coach-question', 'Try it softer');

  const memoryStatsEl = appendHtml(root, 'div', 'memory-stats');
  const stageStatusEl = appendHtml(root, 'div', 'stage-status');
  return { memoryStatsEl, stageStatusEl };
}

describe('voice dom bindings', () => {
  it('collects the voice DOM tree into grouped render and bootstrap bindings', () => {
    const { memoryStatsEl, stageStatusEl } = populateVoiceDom();

    const bindings = createVoiceDomBindings({
      document,
      memoryStatsEl,
      stageStatusEl,
    });

    expect(bindings.root.voiceTargetPresetSelect.id).toBe('voice-target-preset');
    expect(bindings.root.voiceReferencePlayerEl.id).toBe('voice-reference-player');
    expect(bindings.renderSummaryElements.memoryStatsEl).toBe(memoryStatsEl);
    expect(bindings.renderSummaryElements.stageStatusEl).toBe(stageStatusEl);
    expect(bindings.renderSummaryElements.voiceLearnerContextInlineStatusEl?.id).toBe('voice-lab-learner-context-status');
    expect(bindings.renderControlsElements.voiceLabPanel).toBe(bindings.root.voiceLabPanel);
    // Redesign: render-dom drives the front-door takeover via the lab panel + front-door handles.
    expect(bindings.renderSummaryElements.voiceLabPanelEl).toBe(bindings.root.voiceLabPanel);
    expect(bindings.renderSummaryElements.voiceFrontDoorEl).toBe(bindings.root.voiceFrontDoorEl);
    expect(bindings.renderSummaryElements.voiceReferencePlayerEl).toBe(bindings.root.voiceReferencePlayerEl);
    expect(bindings.renderOrchestrationElements.voiceCoachThreadEl?.id).toBe('voice-coach-thread');
    expect(bindings.bootstrapRefs.voiceCoachQuestionButtons).toHaveLength(1);
  });

  it('throws when a required voice element is missing', () => {
    document.body.innerHTML = '<div id="voice-panel"></div>';

    expect(() => createVoiceDomBindings({ document })).toThrow('Missing voice element: #voice-lab-panel');
  });
});
