import { describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceDrillState } from '../state';
import { renderVoiceDrillList, renderVoiceRecommendedDrills } from './drills';

describe('voice drill rendering', () => {
  it('disables recommended drill pills while the practice target is locked', () => {
    const element = document.createElement('div');

    renderVoiceRecommendedDrills({
      element,
      drills: [{
        id: 'drill-1',
        title: 'Drill 1',
        focus: 'focus',
        phrase: 'phrase',
        description: 'desc',
        cues: [],
        tags: [],
        cueSheet: null,
      }],
      selectedDrillId: null,
      drillStatus: 'idle',
      currentSessionId: 'session-1',
      isConnected: true,
      targetMutationLocked: true,
      selectionPendingId: null,
      onSelectDrill: vi.fn(async () => undefined),
      onSelectError: vi.fn(),
    });

    expect((element.querySelector('button') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('disables drill list buttons while the practice target is locked', () => {
    const element = document.createElement('div');

    renderVoiceDrillList({
      element,
      drillState: createDefaultVoiceDrillState({
        drills: [{
          id: 'drill-1',
          title: 'Drill 1',
          focus: 'focus',
          phrase: 'phrase',
          description: 'desc',
          cues: [],
          tags: [],
          cueSheet: null,
        }],
      }),
      drillStatus: 'idle',
      drillError: null,
      selectedDrillId: null,
      currentSessionId: 'session-1',
      isConnected: true,
      targetMutationLocked: true,
      selectionPendingId: null,
      onSelectDrill: vi.fn(async () => undefined),
      onSelectError: vi.fn(),
    });

    expect((element.querySelector('button') as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
