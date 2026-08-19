/**
 * The self-practice screen (2026-07-29).
 *
 * The property that matters most here is NOT what the list looks like — it is
 * that the learner can always get out. The coach's navigation toggle lives
 * inside the coach surface, which is hidden while this one is showing, and the
 * chosen surface is persisted to storage. A practice screen with no working way
 * back is therefore not a cosmetic bug: it is an unrecoverable dead end that
 * survives a reload. It shipped once and was caught in review.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupPracticeSurface, type PracticeDrill } from './practice-surface';

function mountSurface(): void {
  document.body.innerHTML = `
    <section id="tv-practice-surface">
      <button id="tv-practice-back" type="button">← Coach</button>
      <button id="tv-practice-loud" type="button" aria-pressed="false">Quiet only</button>
      <ul id="tv-practice-list"></ul>
      <p id="tv-practice-empty" hidden></p>
      <button id="tv-practice-retry" type="button" hidden>Try again</button>
    </section>
  `;
}

function drill(overrides: Partial<PracticeDrill> = {}): PracticeDrill {
  return {
    id: 'hum-sovt',
    kind: 'hum_sovt',
    title: 'Easy hum',
    focus: 'resonance',
    phrase: 'mmm—ooo',
    cue: 'Let it buzz on your lips.',
    difficulty: 'easy',
    quietCapable: true,
    ...overrides,
  };
}

const listItems = () => Array.from(document.querySelectorAll('#tv-practice-list li'));
const emptyEl = () => document.getElementById('tv-practice-empty') as HTMLParagraphElement;
const loudBtn = () => document.getElementById('tv-practice-loud') as HTMLButtonElement;
const retryBtn = () => document.getElementById('tv-practice-retry') as HTMLButtonElement;

describe('self-practice surface', () => {
  beforeEach(() => { mountSurface(); });

  it('THE WAY BACK: the back button is wired, and works on the failure screen too', async () => {
    // A learner who arrives here with the network down must still be able to
    // leave. If the exit only worked once the list had loaded, a failed fetch
    // would strand them exactly as the missing button did.
    const onBack = vi.fn();
    const surface = setupPracticeSurface({
      doc: document,
      onBack,
      loadDrills: () => Promise.reject(new Error('offline')),
    });
    expect(surface).not.toBeNull();

    surface?.show();
    await vi.waitFor(() => expect(emptyEl().hidden).toBe(false));
    expect(emptyEl().textContent).toMatch(/Couldn't load/);

    document.getElementById('tv-practice-back')?.dispatchEvent(new Event('click'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders the sound and the cue for each drill', async () => {
    const surface = setupPracticeSurface({
      doc: document,
      onBack: () => {},
      loadDrills: () => Promise.resolve([
        drill(),
        drill({ id: 'straw', kind: 'straw_phonation', title: 'Straw', phrase: 'ooo', cue: 'Small and steady.' }),
      ]),
    });

    surface?.show();
    await vi.waitFor(() => expect(listItems()).toHaveLength(2));
    expect(listItems()[0].textContent).toContain('Easy hum');
    expect(listItems()[0].textContent).toContain('mmm—ooo');
    expect(listItems()[0].textContent).toContain('Let it buzz on your lips.');
    expect(emptyEl().hidden).toBe(true);
  });

  it('QUIET BY DEFAULT: the first load asks for the quiet menu', async () => {
    // Someone practising at a bus stop must not be handed a lip trill because a
    // toggle defaulted the wrong way.
    const loadDrills = vi.fn(() => Promise.resolve([drill()]));
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });

    surface?.show();
    await vi.waitFor(() => expect(loadDrills).toHaveBeenCalled());
    expect(loadDrills).toHaveBeenCalledWith(false);
    expect(loudBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('the loud toggle flips the request, the label, and the pressed state', async () => {
    const loadDrills = vi.fn(() => Promise.resolve([drill()]));
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });
    surface?.show();
    await vi.waitFor(() => expect(loadDrills).toHaveBeenCalledTimes(1));

    loudBtn().dispatchEvent(new Event('click'));
    expect(loudBtn().getAttribute('aria-pressed')).toBe('true');
    expect(loudBtn().textContent).toBe('Loud is OK');
    await vi.waitFor(() => expect(loadDrills).toHaveBeenCalledTimes(2));
    expect(loadDrills).toHaveBeenLastCalledWith(true);
    expect(surface?.isAllowingLoud()).toBe(true);

    loudBtn().dispatchEvent(new Event('click'));
    expect(loudBtn().textContent).toBe('Quiet only');
    await vi.waitFor(() => expect(loadDrills).toHaveBeenLastCalledWith(false));
  });

  it('an empty menu says so rather than showing a blank screen', async () => {
    // The backend returns an empty list for an unknown preset ON PURPOSE — it
    // refuses to substitute a different voice target. That has to read as a
    // message, not as a screen that failed to paint.
    const surface = setupPracticeSurface({
      doc: document, onBack: () => {}, loadDrills: () => Promise.resolve([]),
    });
    surface?.show();
    await vi.waitFor(() => expect(emptyEl().hidden).toBe(false));
    expect(emptyEl().textContent).toMatch(/No practice sounds/);
    expect(listItems()).toHaveLength(0);
  });

  it('a failed load is recoverable: the next load replaces the message', async () => {
    const loadDrills = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([drill()]);
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });

    surface?.show();
    await vi.waitFor(() => expect(emptyEl().textContent).toMatch(/Couldn't load/));

    surface?.show();
    await vi.waitFor(() => expect(listItems()).toHaveLength(1));
    expect(emptyEl().hidden).toBe(true);
  });

  it('overlapping identical loads collapse into one', async () => {
    let settle!: (drills: PracticeDrill[]) => void;
    const first = new Promise<PracticeDrill[]>((resolve) => { settle = resolve; });
    const loadDrills = vi.fn(() => first);
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });

    surface?.show();
    surface?.show();
    expect(loadDrills).toHaveBeenCalledTimes(1);

    settle([drill()]);
    await vi.waitFor(() => expect(listItems()).toHaveLength(1));
    surface?.show();
    expect(loadDrills).toHaveBeenCalledTimes(2);
  });

  it('DOUBLE-TAPPING LOUD: what is listed always matches what the button says', async () => {
    // The regression this exists for: an in-flight guard that dropped the load
    // triggered by the SECOND tap. The button flipped twice back to quiet while
    // the first (loud) response rendered underneath it, leaving the learner
    // reading the quiet label, aria-pressed=false, over a list of lip trills.
    // Someone practising where they can be overheard is then shown loud work
    // they explicitly switched off — the owner's one hard requirement.
    const responses: Record<string, PracticeDrill[]> = {
      quiet: [drill({ id: 'hum', title: 'Easy hum' })],
      loud: [
        drill({ id: 'hum', title: 'Easy hum' }),
        drill({ id: 'trill', title: 'Lip trill', quietCapable: false }),
      ],
    };
    const gates: Array<() => void> = [];
    const loadDrills = vi.fn((allowLoud: boolean) => new Promise<PracticeDrill[]>((resolve) => {
      gates.push(() => resolve(responses[allowLoud ? 'loud' : 'quiet']));
    }));
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });

    // Tap on, then immediately tap off while the first request is still open.
    loudBtn().dispatchEvent(new Event('click'));
    loudBtn().dispatchEvent(new Event('click'));
    expect(surface?.isAllowingLoud()).toBe(false);
    expect(loudBtn().textContent).toBe('Quiet only');

    // Release every request, in the order they were made.
    for (let i = 0; i < 4 && gates.length; i += 1) {
      gates.shift()?.();
      await vi.waitFor(() => expect(loadDrills.mock.calls.length).toBeGreaterThan(0));
    }
    await vi.waitFor(() => expect(listItems()).toHaveLength(responses.quiet.length));

    // The screen agrees with the button: quiet button, quiet list.
    expect(loudBtn().getAttribute('aria-pressed')).toBe('false');
    // `toContain` uses strict equality, so `not.toContain(expect.stringContaining(x))`
    // passes against a matching array and proves nothing. `toContainEqual` is the
    // one that understands asymmetric matchers.
    expect(listItems().map((li) => li.textContent)).not.toContainEqual(
      expect.stringContaining('Lip trill'),
    );
    expect(document.body.textContent).not.toContain('Lip trill');
  });

  it('RETRY DOES NOT CHANGE THE LOUDNESS SETTING', async () => {
    // The failure message used to send the learner to the loud toggle, because
    // that was the only other control that reloaded. So the app's only offer of
    // "try again" also switched loud practice ON — handing a shy learner the
    // exposing exercises she had deliberately not opted into. Retry is now its
    // own button, and it retries at whatever loudness she actually chose.
    const loadDrills = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([drill()]);
    const surface = setupPracticeSurface({ doc: document, onBack: () => {}, loadDrills });

    surface?.show();
    await vi.waitFor(() => expect(retryBtn().hidden).toBe(false));
    expect(emptyEl().textContent).toMatch(/Couldn't load/);
    // The message must not name a button, because the loud toggle's wording
    // changes with its state and may not say what the message claims.
    expect(emptyEl().textContent).not.toMatch(/loud/i);

    retryBtn().dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(listItems()).toHaveLength(1));
    expect(loadDrills).toHaveBeenLastCalledWith(false);
    expect(surface?.isAllowingLoud()).toBe(false);
    expect(loudBtn().getAttribute('aria-pressed')).toBe('false');
    expect(retryBtn().hidden).toBe(true);
  });

  it('an empty menu offers a next step, and no pointless retry', async () => {
    // An empty menu is a CORRECT answer (the lane has no drills), so retrying it
    // would just repeat itself. It still has to tell her what to do instead —
    // being told "no" and nothing else reads as being turned away.
    const surface = setupPracticeSurface({
      doc: document, onBack: () => {}, loadDrills: () => Promise.resolve([]),
    });
    surface?.show();
    await vi.waitFor(() => expect(emptyEl().hidden).toBe(false));
    expect(emptyEl().textContent).toMatch(/go back to the coach/i);
    expect(retryBtn().hidden).toBe(true);
  });

  it('flags when the list runs past the bottom of the screen', async () => {
    // A card sliced by the screen edge with no scrollbar reads as the end of the
    // list, so a learner can believe there are three sounds when there are five.
    const list = document.getElementById('tv-practice-list') as HTMLElement;
    // jsdom reports 0 for both, so drive the two cases explicitly.
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 });

    const surface = setupPracticeSurface({
      doc: document, onBack: () => {}, loadDrills: () => Promise.resolve([drill(), drill({ id: 'b' })]),
    });
    surface?.show();
    await vi.waitFor(() => expect(list.dataset.scrollable).toBe('true'));

    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 200 });
    surface?.show();
    await vi.waitFor(() => expect(list.dataset.scrollable).toBe('false'));
  });

  it('returns null when the markup is absent instead of throwing at boot', () => {
    // Boot must survive a stripped page. Throwing here would take the coach down
    // with it.
    document.body.innerHTML = '';
    expect(setupPracticeSurface({
      doc: document, onBack: () => {}, loadDrills: () => Promise.resolve([]),
    })).toBeNull();
  });
});
