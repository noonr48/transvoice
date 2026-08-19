import { describe, expect, it, vi } from 'vitest';
import {
  bindVoiceFrontDoor,
  renderVoiceFrontDoorReportCard,
  shouldShowVoiceFrontDoor,
  updateVoiceFrontDoorVisibility,
  VOICE_PRESET_ESCAPE_LABEL,
  type VoiceFrontDoorElements,
} from './front-door';

function createElements(): VoiceFrontDoorElements {
  const voiceFrontDoorInputEl = document.createElement('input');
  voiceFrontDoorInputEl.type = 'file';
  return {
    voiceFrontDoorEl: document.createElement('section'),
    voiceFrontDoorInputEl,
    voiceFrontDoorSkipEl: document.createElement('button'),
  };
}

describe('voice-copy front door', () => {
  it('routes an uploaded file through the reference path and clears the input', () => {
    const els = createElements();
    const onVoiceReferenceSelected = vi.fn();
    bindVoiceFrontDoor(els, { onVoiceReferenceSelected, onUsePresetFallback: vi.fn() });

    const file = new File(['x'], 'target.wav', { type: 'audio/wav' });
    Object.defineProperty(els.voiceFrontDoorInputEl, 'files', { value: [file], configurable: true });
    els.voiceFrontDoorInputEl!.dispatchEvent(new Event('change'));

    expect(onVoiceReferenceSelected).toHaveBeenCalledWith(file);
    expect(els.voiceFrontDoorInputEl!.value).toBe('');
  });

  it('uses the preset fallback when the user has no sample', () => {
    const els = createElements();
    const onVoiceReferenceSelected = vi.fn();
    const onUsePresetFallback = vi.fn();
    bindVoiceFrontDoor(els, { onVoiceReferenceSelected, onUsePresetFallback });

    els.voiceFrontDoorSkipEl!.dispatchEvent(new Event('click'));

    expect(onUsePresetFallback).toHaveBeenCalledTimes(1);
    expect(onVoiceReferenceSelected).not.toHaveBeenCalled();
  });

  it('shows the front door until a reference is loaded, then hides it', () => {
    const els = createElements();
    expect(updateVoiceFrontDoorVisibility(els, 'warmup', false)).toBe(true);
    expect(els.voiceFrontDoorEl!.classList.contains('hidden')).toBe(false);

    expect(updateVoiceFrontDoorVisibility(els, 'target', false)).toBe(true);
    expect(els.voiceFrontDoorEl!.classList.contains('hidden')).toBe(false);

    expect(updateVoiceFrontDoorVisibility(els, 'target', true)).toBe(false);
    expect(els.voiceFrontDoorEl!.classList.contains('hidden')).toBe(true);

    expect(updateVoiceFrontDoorVisibility(els, 'practice', true)).toBe(false);
    expect(els.voiceFrontDoorEl!.classList.contains('hidden')).toBe(true);
  });

  it('stays hidden for good once the preset fallback dismisses it', () => {
    const els = createElements();
    // warmup would normally show the door, but the durable dismissed flag wins.
    expect(updateVoiceFrontDoorVisibility(els, 'warmup', false, true)).toBe(false);
    expect(els.voiceFrontDoorEl!.classList.contains('hidden')).toBe(true);
  });

  it('shouldShowVoiceFrontDoor centralises the visibility rule', () => {
    expect(shouldShowVoiceFrontDoor('warmup', false)).toBe(true);
    expect(shouldShowVoiceFrontDoor('target', false)).toBe(true);
    expect(shouldShowVoiceFrontDoor('target', true)).toBe(false);
    expect(shouldShowVoiceFrontDoor('practice', false)).toBe(false);
    expect(shouldShowVoiceFrontDoor('review', false)).toBe(false);
    expect(shouldShowVoiceFrontDoor('warmup', false, true)).toBe(false);
  });

  it('never throws when the front-door section is absent (optional handles)', () => {
    const absent: VoiceFrontDoorElements = {
      voiceFrontDoorEl: null,
      voiceFrontDoorInputEl: null,
      voiceFrontDoorSkipEl: null,
    };
    expect(() =>
      bindVoiceFrontDoor(absent, { onVoiceReferenceSelected: vi.fn(), onUsePresetFallback: vi.fn() }),
    ).not.toThrow();
    expect(() => updateVoiceFrontDoorVisibility(absent, 'warmup', false)).not.toThrow();
  });
});

describe('front-door report card preset escape (abandon-trigger fix 1)', () => {
  const rejectQuality = {
    durationMs: 900,
    voicedCoveragePct: 0.05,
    clippingPct: 0,
    flags: ['short_sample'],
    verdict: 'reject' as const,
    cloneable: false,
    summary: 'Clip too short to trust.',
  };

  it('the REJECT view offers the preset escape alongside another clip', () => {
    const container = document.createElement('div');
    const onUsePreset = vi.fn();
    const onTryAgain = vi.fn();
    renderVoiceFrontDoorReportCard(container, rejectQuality, {
      onProceed: vi.fn(),
      onTryAgain,
      onUsePreset,
    });

    const presetButton = container.querySelector('.voice-report-use-preset') as HTMLButtonElement;
    expect(presetButton).not.toBeNull();
    expect(presetButton.textContent).toBe(VOICE_PRESET_ESCAPE_LABEL);
    presetButton.click();
    expect(onUsePreset).toHaveBeenCalledTimes(1);
    expect(onTryAgain).not.toHaveBeenCalled();
    // The reject view never renders a proceed action.
    expect(container.querySelector('.voice-report-proceed')).toBeNull();
  });

  it('stays backwards compatible: no callback, no button; non-reject views unchanged', () => {
    const rejected = document.createElement('div');
    renderVoiceFrontDoorReportCard(rejected, rejectQuality, {
      onProceed: vi.fn(),
      onTryAgain: vi.fn(),
    });
    expect(rejected.querySelector('.voice-report-use-preset')).toBeNull();

    const good = document.createElement('div');
    renderVoiceFrontDoorReportCard(good, { verdict: 'good', cloneable: true }, {
      onProceed: vi.fn(),
      onTryAgain: vi.fn(),
      onUsePreset: vi.fn(),
    });
    // A good clip proceeds; the preset escape belongs to the reject view only.
    expect(good.querySelector('.voice-report-use-preset')).toBeNull();
    expect(good.querySelector('.voice-report-proceed')).not.toBeNull();
  });
});
