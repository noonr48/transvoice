import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveVoiceOnlyCoachActivity,
  setupVoiceOnlyCoachSurface,
  VOICE_COACH_PLAYBACK_STATE_EVENT,
  VOICE_COACH_SELECTED_VOICE_FAILURE_COPY,
  VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT,
} from './coach-surface';

function mountSurface(withGraph = false): void {
  document.body.innerHTML = `
    <div id="tv-coach-surface">
      <button id="tv-coach-preset-button" data-coach-persistent-control aria-expanded="false">Choose voice</button>
      <div id="tv-coach-preset-menu" role="region" aria-label="Tutor voices" hidden>
        <div id="tv-coach-preset-list"></div>
        <button id="tv-coach-upload-open" type="button">Upload new voice sample</button>
        <form id="tv-coach-upload-form" hidden>
          <input id="tv-coach-upload-name" />
          <input id="tv-coach-upload-file" type="file" />
          <button id="tv-coach-upload-save" type="submit">Save voice</button>
          <button id="tv-coach-upload-cancel" type="button">Cancel</button>
        </form>
      </div>
      <main id="tv-coach-canvas">
        <p id="tv-coach-practice-line"></p>
        <p id="tv-coach-pronunciation"></p>
        ${withGraph ? '<div id="tv-coach-graph"></div>' : ''}
      </main>
      <p id="tv-coach-status" role="presentation" aria-live="off"></p>
      <button id="tv-coach-session-toggle" data-coach-persistent-control>Start</button>
    </div>`;
}

describe('voice-only Coach surface', () => {
  beforeEach(() => mountSurface());

  it('lets the visible startup graph replace practice copy in the one primary canvas', () => {
    mountSurface(true);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'need a little magic',
      getPronunciation: () => 'need a LITTLE magic',
      getSelectedPreset: () => ({ id: 'preset-a', name: 'Aster' }),
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    expect(document.getElementById('tv-coach-graph')).not.toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-practice-line')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-canvas')).toHaveAccessibleName('Voice comparison graph.');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute(
      'data-instruction-representation',
      'graph',
    );
  });

  it('renders only the current practice canvas and maps one button to Start/End', async () => {
    const startSession = vi.fn(async () => true);
    const stopSession = vi.fn(async () => undefined);
    const reportEvent = vi.fn();
    const state = {
      line: 'Meet me by the garden gate.',
      pronunciation: 'meet mee by thuh GAR-dn gayt',
      preset: { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' },
      owner: 'idle',
      inputStatus: 'waiting',
    };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => state.line,
      getPronunciation: () => state.pronunciation,
      getSelectedPreset: () => state.preset,
      getInteractionOwner: () => state.owner,
      getInputStatus: () => state.inputStatus,
      listPresets: async () => [state.preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => state.preset,
      startSession,
      stopSession,
      reportEvent,
    });

    surface.sync();
    // 2026-07-28: the verbatim sentence is ALWAYS the primary representation;
    // the styled pronunciation never replaces it (it is fallback-only).
    expect(document.getElementById('tv-coach-practice-line')).toHaveTextContent(state.line);
    expect(document.getElementById('tv-coach-practice-line')).not.toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-canvas')).toHaveAccessibleName(
      `${state.line}. Pronunciation: ${state.pronunciation}`,
    );
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute(
      'data-instruction-representation',
      'practice',
    );
    expect(document.getElementById('tv-coach-preset-button')).toHaveTextContent('Aster');
    expect(document.getElementById('tv-coach-status')).toBeEmptyDOMElement();
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-activity', 'stopped');

    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    expect(document.getElementById('tv-coach-session-toggle')).toHaveTextContent('End');
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-activity', 'ready');
    expect(reportEvent).toHaveBeenCalledWith('session-started');

    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(stopSession).toHaveBeenCalledTimes(1));
    expect(document.getElementById('tv-coach-session-toggle')).toHaveTextContent('Start');
    expect(document.getElementById('tv-coach-status')).toBeEmptyDOMElement();
    expect(reportEvent).toHaveBeenCalledWith('session-stopped');
  });

  it('stopIfActive lands the SAME stop the End button does, surface state included', async () => {
    // The navigation affordance uses this to leave a live lesson. Reaching past
    // the surface and calling the transport teardown directly stopped the audio
    // but left this module's state machine untouched — measured before the fix:
    //   button "End" | aria-pressed true | data-session-state active
    //   | data-activity ready | status "Ready — speak now"
    // ...over a closed microphone. The learner came back to a screen claiming a
    // lesson was running, and speaking did nothing.
    const stopSession = vi.fn(async () => undefined);
    const preset = { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'Meet me by the garden gate.',
      getPronunciation: () => '',
      getSelectedPreset: () => preset,
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => preset,
      startSession: async () => true,
      stopSession,
    });

    surface.sync();
    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(surface.isActive()).toBe(true));
    expect(document.getElementById('tv-coach-session-toggle')).toHaveTextContent('End');

    // It must RESOLVE only after the stop has landed. The caller hides this
    // surface the instant it returns, so an early resolve hides a live mic.
    await surface.stopIfActive();
    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(surface.isActive()).toBe(false);

    const toggle = document.getElementById('tv-coach-session-toggle');
    expect(toggle).toHaveTextContent('Start');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-activity', 'stopped');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-session-state', 'stopped');
  });

  it('stopIfActive REJECTS when the stop failed and the lesson is still live', async () => {
    // The caller hides this surface on a fulfilled promise. When stopSession
    // rejects, the reconcile loop deliberately re-arms desiredActive — intent and
    // state then agree, the loop exits, and this used to fulfil anyway. Measured
    // before the fix: stopSession rejected, isActive() stayed true, the surface
    // flipped to practice, and no teardown error was reported — a running lesson
    // and an open microphone behind an invisible screen. Rejecting is the only
    // thing that makes the caller's error path reachable.
    const stopSession = vi.fn(async () => { throw new Error('network down'); });
    const preset = { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'Meet me by the garden gate.',
      getPronunciation: () => '',
      getSelectedPreset: () => preset,
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => preset,
      startSession: async () => true,
      stopSession,
    });

    surface.sync();
    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(surface.isActive()).toBe(true));

    await expect(surface.stopIfActive()).rejects.toThrow(/did not stop/i);
    expect(stopSession).toHaveBeenCalledTimes(1);
    // Still live, and the surface says so rather than pretending otherwise.
    expect(surface.isActive()).toBe(true);
    expect(document.getElementById('tv-coach-status')).toHaveTextContent("Couldn't stop cleanly.");
  });

  it('stopIfActive is a no-op when no lesson is running', async () => {
    // Leaving an idle coach must not fire a spurious stop at the backend.
    const stopSession = vi.fn(async () => undefined);
    const preset = { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'Meet me by the garden gate.',
      getPronunciation: () => '',
      getSelectedPreset: () => preset,
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => preset,
      startSession: async () => true,
      stopSession,
    });

    surface.sync();
    await surface.stopIfActive();
    expect(stopSession).not.toHaveBeenCalled();
    expect(document.getElementById('tv-coach-session-toggle')).toHaveTextContent('Start');
  });

  it('projects the spoken-loop activity facts with truthful ready and error states', async () => {
    const state = {
      inputStatus: 'waiting',
      inputError: null as string | null,
      owner: 'coach-listening',
      preset: { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' },
    };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => null,
      getSelectedPreset: () => state.preset,
      getInteractionOwner: () => state.owner,
      getInputStatus: () => state.inputStatus,
      getInputError: () => state.inputError,
      listPresets: async () => [state.preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => state.preset,
      startSession: async () => true,
      stopSession: async () => undefined,
    });
    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now'));

    state.inputStatus = 'listening';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Hearing you');
    state.inputStatus = 'processing';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Thinking…');
    state.owner = 'coach-speaking';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Speaking');
    expect(document.getElementById('tv-coach-status')).toHaveAttribute('aria-live', 'off');
    expect(document.getElementById('tv-coach-status')).toHaveAttribute('role', 'presentation');

    state.owner = 'coach-listening';
    state.inputStatus = 'error';
    state.inputError = 'NotAllowedError: microphone permission denied';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Microphone unavailable.');
    expect(document.getElementById('tv-coach-status')).toHaveAttribute('aria-live', 'polite');
    expect(document.getElementById('tv-coach-status')).toHaveAttribute('role', 'status');

    state.inputStatus = 'waiting';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now');
    expect(document.getElementById('tv-coach-status')).toHaveAttribute('aria-live', 'off');
  });

  it('projects Thinking during generation and Speaking only after actual audio', async () => {
    const state = {
      owner: 'coach-listening',
      playing: false,
      inputStatus: 'waiting',
      preset: { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' },
    };
    const reportFailure = vi.fn();
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => null,
      getSelectedPreset: () => state.preset,
      getInteractionOwner: () => state.owner,
      getInputStatus: () => state.inputStatus,
      getTutorAudioPlaying: () => state.playing,
      listPresets: async () => [state.preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => state.preset,
      startSession: async () => true,
      stopSession: async () => undefined,
      reportFailure,
    });
    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now'));

    state.owner = 'coach-speaking';
    state.inputStatus = 'processing';
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Thinking…');
    document.dispatchEvent(new CustomEvent(VOICE_COACH_PLAYBACK_STATE_EVENT, {
      detail: { playing: true },
    }));
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Speaking');

    document.dispatchEvent(new CustomEvent(VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT));
    expect(document.getElementById('tv-coach-status')).toHaveTextContent(VOICE_COACH_SELECTED_VOICE_FAILURE_COPY);
    surface.sync();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent(VOICE_COACH_SELECTED_VOICE_FAILURE_COPY);
    expect(reportFailure).toHaveBeenCalledWith('selected-tutor-voice-unavailable');

    document.dispatchEvent(new CustomEvent(VOICE_COACH_PLAYBACK_STATE_EVENT, {
      detail: { playing: true },
    }));
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Speaking');
  });

  it('keeps an actionable error through routine sync and clears it on explicit recovery', async () => {
    const state = {
      inputStatus: 'waiting',
      owner: 'coach-listening',
      preset: { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a', kind: 'reference' },
    };
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => state.preset,
      getInteractionOwner: () => state.owner,
      getInputStatus: () => state.inputStatus,
      listPresets: async () => [state.preset],
      selectPreset: async () => undefined,
      uploadPreset: async () => state.preset,
      startSession: async () => true,
      stopSession: async () => undefined,
    });
    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now'));
    surface.setStatus('Microphone permission is needed.', 'error');
    state.inputStatus = 'processing';
    surface.sync();
    const status = document.getElementById('tv-coach-status');
    expect(status).toHaveTextContent('Microphone permission is needed.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('role', 'status');

    document.getElementById('tv-coach-session-toggle')?.click();
    await vi.waitFor(() => expect(status).toBeEmptyDOMElement());
    expect(status).toHaveAttribute('aria-live', 'off');
  });

  it('will not start until a named uploaded reference preset is selected', async () => {
    const startSession = vi.fn(async () => true);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession,
      stopSession: async () => undefined,
    });

    document.getElementById('tv-coach-session-toggle')?.click();
    await Promise.resolve();

    expect(startSession).not.toHaveBeenCalled();
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Choose a tutor voice');
    expect(document.getElementById('tv-coach-preset-menu')).not.toHaveAttribute('hidden');
  });

  it('keeps the single End control available while microphone startup is pending', async () => {
    let resolveStart!: (value: boolean) => void;
    let startSignal: AbortSignal | null = null;
    const startSession = vi.fn((signal: AbortSignal) => {
      startSignal = signal;
      return new Promise<boolean>((resolve) => { resolveStart = resolve; });
    });
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => null,
      getSelectedPreset: () => ({
        id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference',
      }),
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession,
      stopSession: async () => undefined,
    });

    const toggle = document.getElementById('tv-coach-session-toggle') as HTMLButtonElement;
    toggle.click();
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    expect(toggle).toHaveTextContent('End');
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Getting ready…');

    toggle.click();
    expect(startSignal?.aborted).toBe(true);
    resolveStart(false);
    await vi.waitFor(() => expect(toggle).toHaveTextContent('Start'));
    expect(document.getElementById('tv-coach-status')).toBeEmptyDOMElement();
  });

  it('preserves a replacement Start pressed while cancellation is unwinding', async () => {
    let resolveFirst!: (value: boolean) => void;
    let firstSignal: AbortSignal | null = null;
    const startSession = vi.fn()
      .mockImplementationOnce((signal: AbortSignal) => {
        firstSignal = signal;
        return new Promise<boolean>((resolve) => { resolveFirst = resolve; });
      })
      .mockResolvedValueOnce(true);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => null,
      getSelectedPreset: () => ({
        id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference',
      }),
      getInteractionOwner: () => 'idle',
      getInputStatus: () => 'waiting',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession,
      stopSession: async () => undefined,
    });

    const toggle = document.getElementById('tv-coach-session-toggle') as HTMLButtonElement;
    toggle.click();
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    toggle.click();
    expect(firstSignal?.aborted).toBe(true);
    toggle.click();
    resolveFirst(false);

    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(toggle).toHaveTextContent('End'));
    expect(document.getElementById('tv-coach-status')).toHaveTextContent('Ready — speak now');
  });

  it('fails closed when a cancelled start rejects instead of hiding it behind a replacement Start', async () => {
    let rejectFirst!: (error: Error) => void;
    const reportFailure = vi.fn();
    const startSession = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(true);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => null,
      getSelectedPreset: () => ({
        id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference',
      }),
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession,
      stopSession: async () => undefined,
      reportFailure,
    });

    const toggle = document.getElementById('tv-coach-session-toggle') as HTMLButtonElement;
    toggle.click();
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledOnce());
    toggle.click();
    toggle.click();
    rejectFirst(new Error('rollback failed'));

    await vi.waitFor(() => expect(toggle).toHaveTextContent('Start'));
    expect(startSession).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith('session-start-failed');
    expect(document.getElementById('tv-coach-status')).toHaveTextContent("Couldn't start listening.");

    toggle.click();
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(toggle).toHaveTextContent('End'));
  });

  it('shows one complete instruction representation without counter-scaling text', () => {
    const line = 'L'.repeat(120);
    const pronunciation = 'P'.repeat(160);
    const reportFailure = vi.fn();
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => line,
      getPronunciation: () => pronunciation,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
      reportFailure,
    });

    expect(document.getElementById('tv-coach-practice-line')).not.toHaveAttribute('hidden');
    // 2026-07-28: the verbatim line wins; the pronunciation is fallback-only.
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-instruction-state', 'ready');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-instruction-density', 'dense');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-instruction-fit', 'native');
    expect((document.getElementById('tv-coach-practice-line') as HTMLElement).style.fontSize).toBe('');
    expect((document.getElementById('tv-coach-pronunciation') as HTMLElement).style.fontSize).toBe('');
    expect((document.getElementById('tv-coach-canvas') as HTMLElement).style.gap).toBe('');
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('uses the ordinary phrase when no distinct pronunciation spelling exists', () => {
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => 'A clear line.',
      getPronunciation: () => 'A clear line.',
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    expect(document.getElementById('tv-coach-practice-line')).not.toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute(
      'data-instruction-representation',
      'practice',
    );
  });

  it('rejects oversized instruction text without rendering a clipped prefix and reports once per invalid state', () => {
    const state = { line: 'L'.repeat(121), pronunciation: 'valid' };
    const reportFailure = vi.fn();
    const surface = setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => state.line,
      getPronunciation: () => state.pronunciation,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
      reportFailure,
    });

    expect(document.getElementById('tv-coach-practice-line')).toHaveTextContent('Practice line unavailable.');
    expect(document.getElementById('tv-coach-practice-line')?.textContent).not.toContain('LLLLLLLL');
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-surface')).toHaveAttribute('data-instruction-state', 'invalid');
    surface.sync();
    expect(reportFailure).toHaveBeenCalledTimes(1);

    state.line = 'valid';
    state.pronunciation = 'P'.repeat(161);
    surface.sync();
    expect(document.getElementById('tv-coach-practice-line')).toHaveTextContent('Practice line unavailable.');
    expect(document.getElementById('tv-coach-pronunciation')).toHaveAttribute('hidden');
    expect(reportFailure).toHaveBeenCalledTimes(1);

    state.pronunciation = 'valid cue';
    surface.sync();
    state.pronunciation = 'P'.repeat(161);
    surface.sync();
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenLastCalledWith('instruction-length-invalid');
  });

  it('lists reference samples only and makes a selection the tutor voice', async () => {
    const selectPreset = vi.fn(async () => undefined);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [
        { id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference' },
        { id: 'handmade-1', name: 'Not a sample', referenceClipId: null, kind: 'handmade' },
        { id: 'archived-1', name: 'Archived', referenceClipId: 'clip-2', kind: 'reference', archived: true },
      ],
      selectPreset,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    document.getElementById('tv-coach-preset-button')?.click();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-coach-preset-id]')).toHaveLength(1));
    expect(document.activeElement).toBe(document.querySelector('[data-coach-preset-id]'));
    expect(document.getElementById('tv-coach-preset-list')).toHaveTextContent('Aster');
    expect(document.getElementById('tv-coach-preset-list')).not.toHaveTextContent('Not a sample');

    (document.querySelector('[data-coach-preset-id]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(selectPreset).toHaveBeenCalledWith('reference-1'));
    expect(document.getElementById('tv-coach-status')).toBeEmptyDOMElement();
    expect(document.getElementById('tv-coach-preset-menu')).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(document.getElementById('tv-coach-preset-button'));
  });

  it('closes the preset disclosure with Escape and restores focus', async () => {
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [
        { id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference' },
      ],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    const opener = document.getElementById('tv-coach-preset-button') as HTMLButtonElement;
    opener.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(
      document.querySelector('[data-coach-preset-id]'),
    ));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('tv-coach-preset-menu')).toHaveAttribute('hidden');
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps upload Cancel inside the open disclosure', async () => {
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    document.getElementById('tv-coach-preset-button')?.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(
      document.getElementById('tv-coach-upload-open'),
    ));
    document.getElementById('tv-coach-upload-open')?.click();
    expect(document.activeElement).toBe(document.getElementById('tv-coach-upload-name'));
    document.getElementById('tv-coach-upload-cancel')?.click();
    expect(document.getElementById('tv-coach-preset-menu')).not.toHaveAttribute('hidden');
    expect(document.activeElement).toBe(document.getElementById('tv-coach-upload-open'));
  });

  it('does not steal focus when a closed disclosure finishes loading late', async () => {
    let resolvePresets!: (value: Array<{
      id: string; name: string; referenceClipId: string; kind: string;
    }>) => void;
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: () => new Promise((resolve) => { resolvePresets = resolve; }),
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    const opener = document.getElementById('tv-coach-preset-button') as HTMLButtonElement;
    opener.click();
    opener.click();
    resolvePresets([
      { id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference' },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('tv-coach-preset-menu')).toHaveAttribute('hidden');
    expect(document.activeElement).toBe(opener);
  });

  it('does not steal focus from the upload form when the preset list resolves late', async () => {
    let resolvePresets!: (value: Array<{
      id: string; name: string; referenceClipId: string; kind: string;
    }>) => void;
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: () => new Promise((resolve) => { resolvePresets = resolve; }),
      selectPreset: async () => undefined,
      uploadPreset: async () => null,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    document.getElementById('tv-coach-preset-button')?.click();
    const uploadOpen = document.getElementById('tv-coach-upload-open') as HTMLButtonElement;
    expect(document.activeElement).toBe(uploadOpen);
    uploadOpen.click();
    const uploadName = document.getElementById('tv-coach-upload-name') as HTMLInputElement;
    uploadName.value = 'River';
    expect(document.activeElement).toBe(uploadName);
    resolvePresets([
      { id: 'reference-1', name: 'Aster', referenceClipId: 'clip-1', kind: 'reference' },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('tv-coach-preset-menu')).not.toHaveAttribute('hidden');
    expect(document.getElementById('tv-coach-upload-form')).not.toHaveAttribute('hidden');
    expect(uploadName).toHaveValue('River');
    expect(document.activeElement).toBe(uploadName);
  });

  it('uploads a sample with the learner-provided name and selects the returned preset', async () => {
    const uploaded = { id: 'new-preset', name: 'River', referenceClipId: 'new-clip', kind: 'reference' } as const;
    const uploadPreset = vi.fn(async () => uploaded);
    const selectPreset = vi.fn(async () => undefined);
    setupVoiceOnlyCoachSurface({
      doc: document,
      getPracticeLine: () => null,
      getPronunciation: () => null,
      getSelectedPreset: () => null,
      getInteractionOwner: () => 'idle',
      listPresets: async () => [],
      selectPreset,
      uploadPreset,
      startSession: async () => true,
      stopSession: async () => undefined,
    });

    document.getElementById('tv-coach-preset-button')?.click();
    document.getElementById('tv-coach-upload-open')?.click();
    const name = document.getElementById('tv-coach-upload-name') as HTMLInputElement;
    const fileInput = document.getElementById('tv-coach-upload-file') as HTMLInputElement;
    name.value = 'River';
    const file = new File(['voice'], 'sample.wav', { type: 'audio/wav' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    (document.getElementById('tv-coach-upload-form') as HTMLFormElement)
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(uploadPreset).toHaveBeenCalledWith('River', file));
    await vi.waitFor(() => {
      expect(selectPreset).toHaveBeenCalledWith('new-preset');
      expect(document.getElementById('tv-coach-preset-button')).toHaveTextContent('River');
    });
  });
});

describe('Coach page contract', () => {
  it('resolves stopped, armed, evidence, processing, and tutor audio without pipeline copy', () => {
    expect(resolveVoiceOnlyCoachActivity({
      active: false, desiredActive: false, sessionTransition: 'idle',
    })).toEqual({ key: 'stopped', label: '' });
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'waiting',
    })).toEqual({ key: 'ready', label: 'Ready — speak now' });
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'listening',
    }).label).toBe('Hearing you');
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'processing',
    }).label).toBe('Thinking…');
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle',
      inputStatus: 'processing', interactionOwner: 'coach-speaking',
    }).label).toBe('Speaking');
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'idle',
    })).toEqual({ key: 'starting', label: 'Getting ready…' });
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'error',
      inputError: 'Voice ASR returned no transcript.',
    })).toEqual({ key: 'unavailable', label: 'Voice input interrupted.' });
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'error',
      inputError: 'NotAllowedError: microphone permission denied',
    })).toEqual({ key: 'unavailable', label: 'Microphone unavailable.' });
    expect(resolveVoiceOnlyCoachActivity({
      active: true, desiredActive: true, sessionTransition: 'idle', inputStatus: 'unsupported',
    })).toEqual({ key: 'unavailable', label: 'Voice input unavailable.' });
  });

  it('is a fixed no-scroll spoken lesson with exactly two persistent controls and no messaging UI', () => {
    const html = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const surface = parsed.getElementById('tv-coach-surface');

    expect(surface).not.toBeNull();
    expect(surface?.querySelectorAll('[data-coach-persistent-control]')).toHaveLength(2);
    expect(surface?.querySelector('#tv-coach-preset-button')).not.toBeNull();
    expect(surface?.querySelector('#tv-coach-session-toggle')).not.toBeNull();
    expect(surface?.querySelectorAll('#tv-coach-canvas')).toHaveLength(1);
    expect(html).toMatch(/#tv-coach-surface\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
    expect(html).toMatch(/--coach-action-center-y:\s*66\.667dvh;/);
    expect(html).toMatch(/#tv-coach-session-toggle\s*\{[^}]*position:\s*absolute;[^}]*top:\s*var\(--coach-action-center-y\);[^}]*left:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\);/s);
    expect(html).toMatch(/#tv-coach-status\s*\{[^}]*top:\s*var\(--coach-activity-top\);[^}]*text-align:\s*center;/s);
    expect(html).toMatch(/data-activity="ready"] #tv-coach-status\s*\{[^}]*color:\s*var\(--coach-ready\);[^}]*font-size:\s*14px;/s);
    expect(html).toMatch(/data-activity="ready"] #tv-coach-status::before\s*\{[^}]*width:\s*8px;[^}]*background:\s*currentColor;/s);
    expect(html).not.toMatch(/data-activity="ready"][^}]*animation:/s);
    expect(html).not.toMatch(/#tv-coach-status\s*\{[^}]*clip:\s*rect\(0 0 0 0\);/s);
    expect(surface?.querySelector('#tv-coach-status')?.textContent).toBe('');
    expect(surface?.querySelector('#tv-coach-status')?.getAttribute('aria-live')).toBe('off');
    expect(surface?.querySelector('#tv-coach-session-toggle')?.textContent).toBe('Start');
    expect(html).not.toContain('id="tv-mode-pill"');
    expect(html).not.toContain('id="vs-studio-toggle"');
    expect(surface?.querySelector('textarea')).toBeNull();
    expect(surface?.querySelector('input[type="text"]')).toBeNull();
    expect(surface?.textContent).not.toMatch(/send|message|hear it|listen back|replay|chat|hands-free/i);
  });

  it('permits EXACTLY ONE navigation affordance, and it is not a lesson control', () => {
    // Product law 2, amended 2026-07-29. The amendment deliberately created a
    // CATEGORY rather than raising a number: the lesson pair stays pinned at two
    // by the assertion above, and this pins navigation at one. A future settings
    // or help button has to argue it is navigation, and it is not — which is the
    // whole reason this is not simply "exactly three controls".
    const html = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const surface = parsed.getElementById('tv-coach-surface');

    const navigation = surface?.querySelectorAll('[data-coach-navigation]');
    expect(navigation).toHaveLength(1);

    const toggle = surface?.querySelector('#tv-coach-nav-toggle');
    expect(toggle).not.toBeNull();
    // The two markers must never be worn by the same element, or one count
    // silently absorbs the other and both stop meaning anything.
    expect(toggle?.hasAttribute('data-coach-persistent-control')).toBe(false);
    expect(
      surface?.querySelector('[data-coach-persistent-control][data-coach-navigation]'),
    ).toBeNull();

    // It leaves the lesson; it must not read as another thing to do inside it.
    expect(toggle?.textContent?.trim()).toBe('Practice');
    // Still no scroll: the affordance shares the existing 48px topbar row.
    expect(html).toMatch(/\.tv-coach-topbar\s*\{[^}]*justify-content:\s*space-between;/s);
    // The coach surface is HIDDEN when away, never unmounted — #app under it
    // owns the transport and the boot guard keys on an element inside it.
    expect(html).toMatch(/body\[data-tv-surface="practice"\]\s*#tv-coach-surface\s*\{\s*display:\s*none;\s*\}/);
  });
});
