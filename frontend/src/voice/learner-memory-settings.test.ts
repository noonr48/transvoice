import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindLearnerMemorySettings,
  forgetLearnerMemory,
  getLearnerMemory,
  renderLearnerMemory,
  updateLearnerMemoryProfile,
} from './learner-memory-settings';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function installMemorySettingsDom(): void {
  document.body.innerHTML = `
    <input id="voice-memory-student-id" value="learner-1">
    <input id="voice-memory-name">
    <input id="voice-memory-pronouns">
    <!-- Mirrors the real select in frontend/voice-tutor.html. 2026-07-27
         MTF-ONLY: the retired ftm option is gone from both. -->
    <select id="voice-memory-direction">
      <option value="unspecified">Unspecified</option>
      <option value="mtf">Feminizing</option>
      <option value="neutral">Neutral</option>
    </select>
    <input id="voice-memory-goal">
    <p id="voice-memory-target"></p>
    <p id="voice-memory-health"></p>
    <div id="voice-memory-items"></div>
    <button id="voice-memory-load" type="button">Load</button>
    <button id="voice-memory-save" type="button">Save</button>
    <button id="voice-memory-reset" type="button">Reset</button>
    <button id="voice-memory-delete-all" type="button">Delete</button>
    <div id="voice-memory-status"></div>
  `;
}

async function flushAsyncEvents(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('learner memory settings', () => {
  beforeEach(() => {
    installMemorySettingsDom();
  });

  it('uses the learner profile and forget routes with explicit learner scope', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, learnerContext: {} }))
      .mockResolvedValueOnce(jsonResponse({ success: true, learnerContext: {} }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        learnerContext: null,
        deletionReceipt: { operation: 'delete-all' },
      }));

    await getLearnerMemory('http://backend.test/', 'learner / one', fetchImpl);
    await updateLearnerMemoryProfile('http://backend.test/', 'learner / one', {
      displayName: 'Ben',
      direction: 'neutral',
    }, fetchImpl);
    await expect(forgetLearnerMemory('http://backend.test/', 'learner / one', {
      operation: 'delete-all',
    }, fetchImpl)).resolves.toMatchObject({
      deletionReceipt: { operation: 'delete-all' },
    });

    expect(fetchImpl.mock.calls).toEqual([
      [
        'http://backend.test/voice/learner-context/profile?studentId=learner+%2F+one',
        { cache: 'no-store' },
      ],
      [
        'http://backend.test/voice/learner-context/profile',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            studentId: 'learner / one',
            displayName: 'Ben',
            direction: 'neutral',
          }),
        }),
      ],
      [
        'http://backend.test/voice/learner-context/forget',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            studentId: 'learner / one',
            operation: 'delete-all',
          }),
        }),
      ],
    ]);
  });

  it('renders identity, exact selected tutor voice, storage health, and removable memory', () => {
    const onRemove = vi.fn();
    renderLearnerMemory({
      learnerContext: {
        profile: {
          displayName: 'Ben',
          pronouns: 'they/them',
          direction: 'neutral',
          goal: 'A voice that feels like mine',
        },
        targetBinding: {
          presetId: 'preset-1',
          presetName: 'Warm cedar',
          referenceClipId: 'clip-1',
          targetKey: 'uploaded-reference:clip-1',
        },
        coachPreferences: [{ id: 'slower-pace', text: 'Give me more time to answer' }],
        moments: [{ id: 'moment-1', kind: 'breakthrough', text: 'Easy onset clicked' }],
        storageHealth: { status: 'recovered', writeBlocked: false },
      },
    }, onRemove);

    expect(document.getElementById('voice-memory-name')).toHaveValue('Ben');
    expect(document.getElementById('voice-memory-pronouns')).toHaveValue('they/them');
    expect(document.getElementById('voice-memory-direction')).toHaveValue('neutral');
    expect(document.getElementById('voice-memory-goal')).toHaveValue('A voice that feels like mine');
    expect(document.getElementById('voice-memory-target')).toHaveTextContent(
      'Selected tutor voice: Warm cedar',
    );
    expect(document.getElementById('voice-memory-health')).toHaveTextContent(
      'Memory storage: recovered.',
    );

    const removeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.memory-remove'));
    expect(removeButtons).toHaveLength(2);
    removeButtons[0].click();
    removeButtons[1].click();
    expect(onRemove).toHaveBeenNthCalledWith(1, { removePreference: 'slower-pace' });
    expect(onRemove).toHaveBeenNthCalledWith(2, { momentId: 'moment-1' });
  });

  it('keeps per-item removal wired after saving profile details', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(_input).endsWith('/profile')) {
        return jsonResponse({
          success: true,
          learnerContext: {
            profile: { displayName: 'Ben', direction: 'unspecified' },
            coachPreferences: [{ id: 'brevity', text: 'Keep replies short' }],
            moments: [],
            storageHealth: { status: 'healthy', writeBlocked: false },
          },
        });
      }
      return jsonResponse({
        success: true,
        learnerContext: {
          profile: { displayName: 'Ben', direction: 'unspecified' },
          coachPreferences: [],
          moments: [],
          storageHealth: { status: 'healthy', writeBlocked: false },
        },
      });
    });
    bindLearnerMemorySettings({
      getBackendUrl: () => 'http://backend.test',
      fetchImpl,
      confirmImpl: () => true,
    });

    (document.getElementById('voice-memory-name') as HTMLInputElement).value = 'Ben';
    (document.getElementById('voice-memory-save') as HTMLButtonElement).click();
    await flushAsyncEvents();

    const remove = document.querySelector<HTMLButtonElement>('.memory-remove');
    expect(remove).not.toBeNull();
    remove?.click();
    await flushAsyncEvents();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]).toEqual([
      'http://backend.test/voice/learner-context/forget',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          studentId: 'learner-1',
          removePreference: 'brevity',
        }),
      }),
    ]);
    expect(document.getElementById('voice-memory-status')).toHaveTextContent('Removed.');
  });

  it('requires confirmation before either destructive bulk operation', () => {
    const fetchImpl = vi.fn();
    const confirmImpl = vi.fn(() => false);
    bindLearnerMemorySettings({
      getBackendUrl: () => 'http://backend.test',
      fetchImpl,
      confirmImpl,
    });

    (document.getElementById('voice-memory-reset') as HTMLButtonElement).click();
    (document.getElementById('voice-memory-delete-all') as HTMLButtonElement).click();

    expect(confirmImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
