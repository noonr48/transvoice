import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupVoiceWelcomeBack } from './welcome-back';

// Surfacing wave — first-run greeting: the front-door completion hook fires the
// SAME greeting path returning learners get, exactly once (double-greet guard).

function mountWelcomeBackDom(): void {
  document.body.innerHTML = `
    <section id="voice-welcome-back" class="hidden">
      <h3 id="voice-welcome-back-title"></h3>
      <p id="voice-welcome-back-target"></p>
      <p id="voice-welcome-back-stat"></p>
      <button type="button" id="voice-welcome-back-continue"></button>
      <button type="button" id="voice-welcome-back-change"></button>
      <p id="voice-welcome-back-note" class="hidden"></p>
    </section>
  `;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const GREETING_RESPONSE = {
  greeting: { line1: 'Hello — your target voice is set.', line2: 'One easy line to start.' },
} as never;

function createOptions(memoResponse: unknown) {
  const getCoachGreeting = vi.fn(async () => GREETING_RESPONSE);
  const appendCoachGreeting = vi.fn();
  return {
    options: {
      sessionId: 'session-1',
      hasRestorableSession: false,
      getMemoProfile: vi.fn(async () => memoResponse as never),
      getCoachGreeting,
      getReferenceAnalysis: vi.fn(async () => ({}) as never),
      syncReference: vi.fn(async () => ({}) as never),
      onContinuePractice: vi.fn(),
      showFrontDoor: vi.fn(),
      setFrontDoorHidden: vi.fn(),
      appendCoachGreeting,
      log: vi.fn(),
    },
    getCoachGreeting,
    appendCoachGreeting,
  };
}

describe('voice welcome-back first-run greeting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('greets a first-run learner once when the front door completes', async () => {
    mountWelcomeBackDom();
    // First run: no lastReference in the memo -> no automatic greeting.
    const { options, getCoachGreeting, appendCoachGreeting } = createOptions({});
    const handle = setupVoiceWelcomeBack(options);
    await flushAsyncWork();
    expect(getCoachGreeting).not.toHaveBeenCalled();

    // Front door completes with a reference attached -> the coach speaks first.
    handle.greetFirstRun();
    await flushAsyncWork();
    expect(getCoachGreeting).toHaveBeenCalledTimes(1);
    expect(getCoachGreeting).toHaveBeenCalledWith('session-1', 'default-voice-learner');
    expect(appendCoachGreeting).toHaveBeenCalledTimes(1);
    expect(appendCoachGreeting).toHaveBeenCalledWith(
      expect.objectContaining({ line1: 'Hello — your target voice is set.' }),
    );

    // Repeat completion (re-upload, second proceed) never double-greets.
    handle.greetFirstRun();
    await flushAsyncWork();
    expect(getCoachGreeting).toHaveBeenCalledTimes(1);
  });

  it('does not double-greet a returning learner', async () => {
    mountWelcomeBackDom();
    // Returning learner: the module already fires the continuity greeting.
    const { options, getCoachGreeting } = createOptions({
      lastReference: { clipId: 'clip-9', name: 'My target', summary: 'warm and light' },
    });
    const handle = setupVoiceWelcomeBack(options);
    await flushAsyncWork();
    expect(getCoachGreeting).toHaveBeenCalledTimes(1);

    // A later front-door completion (e.g. "Change target voice" flow) no-ops.
    handle.greetFirstRun();
    await flushAsyncWork();
    expect(getCoachGreeting).toHaveBeenCalledTimes(1);
  });

  it('counts canonical hit fractions and excludes measurement-invalid audit takes', async () => {
    mountWelcomeBackDom();
    const { options } = createOptions({
      lastReference: { clipId: 'clip-9', name: 'My target', summary: 'grounded' },
      recentAttempts: [
        { attemptId: 'valid-1', targetHitPct: 0.75, usableForLearning: true },
        { attemptId: 'valid-2', targetHitPct: 0.8, usableForLearning: true },
        { attemptId: 'invalid', targetHitPct: 0.99, usableForLearning: false },
      ],
    });
    setupVoiceWelcomeBack(options);
    await flushAsyncWork();

    expect(document.getElementById('voice-welcome-back-stat')?.textContent)
      .toBe('2 takes logged · 2 on-target in a row');
  });
});
