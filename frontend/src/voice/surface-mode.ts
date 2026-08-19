/**
 * WHICH SURFACE IS THE LEARNER LOOKING AT (2026-07-29)
 *
 * The app has two: the Coach (a live spoken lesson) and Self-Practice (a
 * pure-sound list you open when you are not in the state to want to talk).
 * Product law 2, amended 2026-07-29, permits exactly one NAVIGATION affordance
 * to move between them — distinct from the two LESSON controls, which stay at
 * two forever.
 *
 * THE HAZARD THIS MODULE EXISTS TO CONTAIN. Leaving the coach is not a visual
 * change. The coach surface is HIDDEN, not unmounted — `#app` underneath it owns
 * the audio transport, and the boot guard keys on an element inside `#app`, so
 * neither may be removed. That means a learner who switches to practice
 * mid-session leaves a LIVE MICROPHONE and a running tutor behind an invisible
 * surface. `onLeaveCoach` is therefore not optional decoration; it is the
 * teardown, and the caller must wire it.
 *
 * That hazard also decides what happens when the teardown FAILS: the switch is
 * cancelled and the learner stays on the coach. Leaving would hide a lesson that
 * may still be running. Staying costs them a trip they wanted; leaving costs
 * them an open microphone they cannot see.
 */

export type VoiceSurface = 'coach' | 'practice';

const STORAGE_KEY = 'tvSurface';
const SURFACES: readonly VoiceSurface[] = ['coach', 'practice'];

/** Coach is the default: the app is a lesson first. */
export const DEFAULT_VOICE_SURFACE: VoiceSurface = 'coach';

export type VoiceSurfaceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type VoiceSurfaceControllerOptions = {
  root?: HTMLElement | null;
  storage?: VoiceSurfaceStorage | null;
  /**
   * Called BEFORE the surface changes away from 'coach'. Must stop capture and
   * checkpoint the session, and must REJECT if the lesson is still running when
   * it returns — a teardown that reports success over a live session makes this
   * module hide an open microphone.
   *
   * A rejection (or a timeout) cancels the switch and is reported through
   * `onTeardownError`. The learner stays on the working coach rather than being
   * moved to a screen that conceals a running lesson.
   */
  onLeaveCoach?: (() => void | Promise<void>) | null;
  onChange?: ((surface: VoiceSurface) => void) | null;
  onTeardownError?: ((error: unknown) => void) | null;
  /**
   * How long to wait for `onLeaveCoach` before giving up on it. A teardown that
   * never settles is not hypothetical: the stop request is a plain `fetch` with
   * no timeout, so a server that accepts and never answers would otherwise leave
   * the in-flight guard latched and the navigation button dead until a reload.
   */
  teardownTimeoutMs?: number;
};

export const DEFAULT_VOICE_TEARDOWN_TIMEOUT_MS = 8000;

/** Thrown when `onLeaveCoach` does not settle inside the deadline. */
export class VoiceTeardownTimeoutError extends Error {
  constructor(ms: number) {
    super(`Coach teardown did not finish within ${ms}ms.`);
    this.name = 'VoiceTeardownTimeoutError';
  }
}

export function isVoiceSurface(value: unknown): value is VoiceSurface {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

/**
 * Read the remembered surface. Anything unrecognised, corrupt, or unreadable
 * (private browsing throws on access) resolves to the coach — the surface that
 * always works.
 */
export function readStoredVoiceSurface(storage?: VoiceSurfaceStorage | null): VoiceSurface {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return isVoiceSurface(raw) ? raw : DEFAULT_VOICE_SURFACE;
  } catch {
    return DEFAULT_VOICE_SURFACE;
  }
}

export function createVoiceSurfaceController(options: VoiceSurfaceControllerOptions = {}) {
  const root = options.root ?? (typeof document === 'undefined' ? null : document.body);
  const storage = options.storage ?? null;
  let current: VoiceSurface = readStoredVoiceSurface(storage);

  const paint = (surface: VoiceSurface): void => {
    if (root) root.dataset.tvSurface = surface;
  };

  const persist = (surface: VoiceSurface): void => {
    try {
      storage?.setItem(STORAGE_KEY, surface);
    } catch {
      // A full or blocked storage must not break navigation. The surface still
      // switches; it just will not be remembered next launch.
    }
  };

  // ONE SWITCH AT A TIME. `set` awaits an async teardown, and the toggle stays
  // visible and clickable for that whole window — measured: a double tap ran
  // `onLeaveCoach` TWICE, i.e. two concurrent session-stop requests. Holding the
  // in-flight promise collapses the second tap onto the first.
  let inFlight: Promise<VoiceSurface> | null = null;

  const set = (next: VoiceSurface): Promise<VoiceSurface> => {
    if (inFlight) return inFlight;
    const run = performSet(next);
    inFlight = run;
    return run.finally(() => { inFlight = null; });
  };

  const performSet = async (next: VoiceSurface): Promise<VoiceSurface> => {
    if (!isVoiceSurface(next) || next === current) return current;

    // Teardown BEFORE the switch, so the mic is never live behind a hidden
    // surface even for a frame.
    //
    // AND IF THE TEARDOWN FAILS, STAY PUT. Hiding this surface is what makes the
    // microphone invisible; a stop that threw, or one that never answered, means
    // the lesson may still be running, so leaving would recreate precisely the
    // hazard this function exists to prevent.
    //
    // THIS IS ONLY CORRECT WHEN A LESSON IS ACTUALLY RUNNING, and it is
    // `onLeaveCoach`'s job to decide that: it must reject ONLY when a live lesson
    // could not be stopped, and swallow bookkeeping failures for an idle coach.
    // Rejecting on an idle failure turns this into a silently dead button (caught
    // in review). Callers must also surface something on screen from
    // `onTeardownError` — a cancelled switch with no message is indistinguishable
    // from a broken control, since the learner tapped and simply stayed put.
    if (current === 'coach' && options.onLeaveCoach) {
      const budget = options.teardownTimeoutMs ?? DEFAULT_VOICE_TEARDOWN_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(options.onLeaveCoach()),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new VoiceTeardownTimeoutError(budget)), budget);
          }),
        ]);
      } catch (error) {
        options.onTeardownError?.(error);
        return current;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    current = next;
    paint(current);
    persist(current);
    options.onChange?.(current);
    return current;
  };

  paint(current);

  return {
    get current(): VoiceSurface {
      return current;
    },
    set,
    toggle: (): Promise<VoiceSurface> => set(current === 'coach' ? 'practice' : 'coach'),
  };
}
