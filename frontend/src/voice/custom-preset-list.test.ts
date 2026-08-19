import { describe, expect, it } from 'vitest';
import type { VoiceCustomTargetPreset } from './state';
import { renderVoiceCustomPresetList } from './render/custom-presets';

function createPreset(overrides: Partial<VoiceCustomTargetPreset>): VoiceCustomTargetPreset {
  return {
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
    ...overrides,
  };
}

describe('voice custom preset list', () => {
  it('uses rename for reference presets while keeping edit for handmade presets and adds duplicate/archive actions', () => {
    const element = document.createElement('div');

    renderVoiceCustomPresetList({
      element,
      presets: [
        createPreset({ id: 'reference-1', kind: 'reference', name: 'Reference Voice' }),
        createPreset({
          id: 'handmade-1',
          kind: 'handmade',
          name: 'Handmade Voice',
          targetVoiceProfile: {
            sourceFilename: 'Handmade Voice',
            targetPreset: 'bright-playful',
            pitchFloorHz: 170,
            pitchCeilingHz: 240,
            resonanceFloor: 0.55,
            resonanceCeiling: 0.82,
            weightFloor: 0.18,
            weightCeiling: 0.42,
            stylePrompt: 'sweet',
            notes: [],
          } as any,
          referenceClipId: null,
          referenceClipName: null,
        }),
      ],
      selectedPresetId: null,
      targetSource: 'built-in',
    });

    const actionLabels = Array.from(element.querySelectorAll('[data-voice-custom-preset-action="edit"]'))
      .map((entry) => entry.textContent);
    const duplicateActions = Array.from(element.querySelectorAll('[data-voice-custom-preset-action="duplicate"]'));
    const archiveActions = Array.from(element.querySelectorAll('[data-voice-custom-preset-action="archive"]'));

    expect(actionLabels).toEqual(['Rename', 'Edit']);
    expect(duplicateActions).toHaveLength(2);
    expect(archiveActions).toHaveLength(2);
  });

  it('renders archived presets in their own section with restore and delete actions', () => {
    const element = document.createElement('div');

    renderVoiceCustomPresetList({
      element,
      presets: [
        createPreset({ id: 'archived-1', name: 'Old Voice', archived: true, archivedAt: 10 }),
      ],
      selectedPresetId: null,
      targetSource: 'built-in',
    });

    expect(element.textContent).toContain('Archived targets');
    expect(element.querySelector('[data-voice-custom-preset-action="restore"]')?.textContent).toBe('Restore');
    expect(element.querySelector('[data-voice-custom-preset-action="delete"]')?.textContent).toBe('Delete Permanently');
  });

  it('renders the clarified empty library copy', () => {
    const element = document.createElement('div');

    renderVoiceCustomPresetList({
      element,
      presets: [],
      selectedPresetId: null,
      targetSource: 'built-in',
    });

    expect(element.textContent).toContain('No saved voice targets yet.');
    expect(element.textContent).toContain('Save Current Reference As New');
  });
});
