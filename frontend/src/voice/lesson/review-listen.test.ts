import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceUiState } from '../state';
import { createVoiceLessonController } from './controller';

// Crossing proof (surfacing wave): a Review-row Listen click travels through the
// lesson controller's delegated listener into the EXISTING replay machinery —
// replay.open resolves the row's attemptId into the attempt-audio URL.

class MockAudio {
  static instances: MockAudio[] = [];
  preload = '';
  src = '';
  duration = 0;
  currentTime = 0;
  handlers: Record<string, () => void> = {};
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener = vi.fn((event: string, handler: () => void) => {
    this.handlers[event] = handler;
  });
  removeEventListener = vi.fn();
  constructor() {
    MockAudio.instances.push(this);
  }
}

function mountReviewListenDom(): void {
  document.body.innerHTML = `
    <button type="button" id="voice-lesson-intent-listen">Listen back</button>
    <button type="button" id="voice-lesson-replay-offer">Replay offer</button>
    <div id="voice-review-list">
      <div class="voice-review-row">
        <span class="voice-review-row-time">10:30</span>
        <button type="button" class="voice-review-row-listen" data-attempt-id="take-7">Listen</button>
      </div>
      <div class="voice-review-row">
        <span class="voice-review-row-time">10:35</span>
        <button type="button" class="voice-review-row-listen" data-attempt-id="take-8" disabled title="no audio kept for this take">Listen</button>
      </div>
    </div>
    <div id="voice-lesson-replay-overlay" class="hidden" aria-hidden="true">
      <p id="voice-lesson-replay-status"></p>
      <svg id="voice-lesson-replay-trail" class="hidden"><polyline id="voice-lesson-replay-trail-line"></polyline></svg>
      <div id="voice-lesson-replay-dot" class="hidden"></div>
      <button type="button" id="voice-lesson-replay-close">✕</button>
    </div>
  `;
}

function createController(
  attemptAudioUrl: (attemptId: string) => string,
  uiState = createDefaultVoiceUiState(),
) {
  return createVoiceLessonController({
    doc: document,
    getUiState: () => uiState,
    getSessionId: () => 'session-1',
    fetchActiveCard: vi.fn(async () => ({ success: true, card: null })),
    advanceCard: vi.fn(async () => ({ success: true, card: null })),
    attemptAudioUrl,
    submitCoachQuestion: vi.fn(),
    onTakeStartRetry: vi.fn(),
    onNextCard: vi.fn(),
    getLatestCoachText: () => null,
    addLog: vi.fn(),
  });
}

describe('voice review-row listen crossing', () => {
  beforeEach(() => {
    MockAudio.instances = [];
    vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
    mountReviewListenDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('opens the replay with the clicked row attemptId and resolves its audio url', () => {
    const attemptAudioUrl = vi.fn((attemptId: string) => `http://kernel.test/voice/attempts/${attemptId}/audio`);
    const controller = createController(attemptAudioUrl);
    controller.start();
    const effect = vi.fn();
    window.addEventListener('tv-control-effect', effect, { once: true });

    const listenButton = document.querySelector<HTMLButtonElement>('.voice-review-row-listen[data-attempt-id="take-7"]');
    expect(listenButton).not.toBeNull();
    listenButton!.click();

    // The replay overlay opened and the audio source is the ROW's attempt.
    const overlay = document.getElementById('voice-lesson-replay-overlay');
    expect(overlay?.classList.contains('hidden')).toBe(false);
    expect(attemptAudioUrl).toHaveBeenCalledWith('take-7');
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].src).toBe('http://kernel.test/voice/attempts/take-7/audio');
    expect(MockAudio.instances[0].play).toHaveBeenCalled();
    expect(effect).toHaveBeenCalledWith(expect.objectContaining({
      detail: { control: 'voice-review-row-listen', effect: 'replay-opened', status: 'succeeded' },
    }));

    controller.dispose();
  });

  it.each([
    ['voice-lesson-intent-listen', 'voice-lesson-intent-listen'],
    ['voice-lesson-replay-offer', 'voice-lesson-replay-offer'],
  ])('attributes replay semantics to the activating %s control', (buttonId, control) => {
    const controller = createController(() => '');
    controller.start();
    const effect = vi.fn();
    window.addEventListener('tv-control-effect', effect, { once: true });
    document.getElementById(buttonId)!.click();
    expect(effect).toHaveBeenCalledWith(expect.objectContaining({
      detail: { control, effect: 'replay-opened', status: 'succeeded' },
    }));
    controller.dispose();
  });

  it('replays the clicked attempt with its OWN retained timeline when present', () => {
    const frame = {
      pitchHz: 220,
      resonanceScore: 0.6,
      weightScore: 0.3,
      confidence: 0.8,
      voiced: true,
    };
    const uiState = createDefaultVoiceUiState({
      // The clicked attempt kept its own frames; the session-level last-take
      // timeline is EMPTY, so a painted dot proves the artifact frames won.
      attemptArtifacts: [
        { clientAttemptId: 'take-7', timeline: [frame, { ...frame, pitchHz: 240 }] },
      ] as never,
      lastTakeTimeline: [],
    });
    const controller = createController(
      (attemptId: string) => `http://kernel.test/voice/attempts/${attemptId}/audio`,
      uiState,
    );
    controller.start();

    document.querySelector<HTMLButtonElement>('.voice-review-row-listen[data-attempt-id="take-7"]')!.click();
    const audio = MockAudio.instances[0];
    audio.duration = 2;
    audio.handlers.loadedmetadata?.();

    // paintFrame(frames, 0) ran against the artifact's frames -> dot visible.
    const dot = document.getElementById('voice-lesson-replay-dot') as HTMLElement;
    expect(dot.classList.contains('hidden')).toBe(false);
    expect(dot.style.getPropertyValue('--voice-dot-left')).not.toBe('');

    controller.dispose();
  });

  it('uses the retained artifact identity for audio while matching by client attempt', () => {
    const attemptAudioUrl = vi.fn((attemptId: string) => `http://kernel.test/voice/attempts/${attemptId}/audio`);
    const uiState = createDefaultVoiceUiState({
      lastAttemptArtifact: {
        clientAttemptId: 'take-client-1',
        attemptArtifactId: 'take-artifact-1',
      },
      attemptArtifacts: [{
        clientAttemptId: 'take-client-1',
        attemptArtifactId: 'take-artifact-1',
      }],
    });
    const controller = createController(attemptAudioUrl, uiState);
    controller.start();

    document.getElementById('voice-lesson-intent-listen')!.click();

    expect(attemptAudioUrl).toHaveBeenCalledWith('take-artifact-1');
    expect(MockAudio.instances[0].src).toContain('/take-artifact-1/audio');
    controller.dispose();
  });

  it('ignores clicks on disabled no-audio rows', () => {
    const attemptAudioUrl = vi.fn((attemptId: string) => `http://kernel.test/voice/attempts/${attemptId}/audio`);
    const controller = createController(attemptAudioUrl);
    controller.start();

    const disabledButton = document.querySelector<HTMLButtonElement>('.voice-review-row-listen[data-attempt-id="take-8"]');
    expect(disabledButton).not.toBeNull();
    disabledButton!.click();

    expect(attemptAudioUrl).not.toHaveBeenCalled();
    expect(document.getElementById('voice-lesson-replay-overlay')?.classList.contains('hidden')).toBe(true);

    controller.dispose();
  });
});
