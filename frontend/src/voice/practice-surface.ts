/**
 * SELF-PRACTICE SURFACE (2026-07-29)
 *
 * A quiet list of sounds the learner can make in two free minutes, opened when
 * they are not in the state to want to talk to the tutor. It is a REMINDER, not
 * a lesson: no scoring, no verdict, no session, nothing to finish. Whether it
 * ever measures is an open owner decision and nothing here presumes it.
 *
 * IT MUST CARRY ITS OWN WAY BACK. The coach's navigation toggle lives inside
 * `#tv-coach-surface`, which is hidden while this surface is showing — so
 * without a back button here the learner is stranded on a screen with no exit,
 * and the choice is persisted, so reloading returns them to it. That was a real
 * shipped defect, caught in review; the back button is not decoration.
 */

export type PracticeDrill = {
  id: string;
  kind: string;
  title: string;
  focus: string | null;
  phrase: string | null;
  cue: string | null;
  difficulty: string | null;
  quietCapable: boolean;
};

export type PracticeSurfaceOptions = {
  doc: Document;
  /** Fetches the menu. Rejections are shown as a retryable message, never thrown. */
  loadDrills: (allowLoud: boolean) => Promise<PracticeDrill[]>;
  onBack: () => void;
};

// Both messages end with something the learner can DO. "No practice sounds for
// the voice you have chosen" was accurate and a dead end — to someone unsure she
// belongs here, being told no and nothing else reads as being turned away.
const EMPTY_MESSAGE = 'No practice sounds for this voice yet. Go back to the coach and pick a tutor voice, then open this again.';
// Names no button label: the loud toggle's wording changes with its state, so
// naming it sent the learner looking for words that were not on screen. The
// retry button below carries the action instead.
const FAILED_MESSAGE = "Couldn't load your practice sounds just now.";

/**
 * The loud toggle names its CURRENT STATE, not the action it performs.
 *
 * It first shipped as "I can be loud" / "Keep it quiet" — action labels — so a
 * learner glancing at "Keep it quiet" could not tell whether she was looking at
 * the quiet list or the loud one. Given that being overheard is the whole fear
 * this mode is built around, that is the one question the screen must answer
 * without being thought about.
 */
const LOUD_LABELS = Object.freeze({ off: 'Quiet only', on: 'Loud is OK' });

export function setupPracticeSurface(options: PracticeSurfaceOptions) {
  const { doc } = options;
  const root = doc.getElementById('tv-practice-surface');
  const list = doc.getElementById('tv-practice-list');
  const empty = doc.getElementById('tv-practice-empty');
  const back = doc.getElementById('tv-practice-back');
  const loud = doc.getElementById('tv-practice-loud');
  const retry = doc.getElementById('tv-practice-retry');
  if (!root || !list || !empty || !back || !loud || !retry) return null;

  let allowLoud = false;
  // One in-flight load at a time, but the LAST render must match what the button
  // is showing. Simply dropping a load that arrives while another is running
  // gets this backwards — it discards the learner's NEWER intent and leaves the
  // older result on screen. Measured: a fast double-tap on the loud toggle left
  // the button reading "I can be loud" with aria-pressed=false while lip trills
  // were listed underneath it. Someone practising where they can be overheard
  // then sees loud work they explicitly switched off. So a load that lands on a
  // stale intent re-runs instead of being thrown away.
  let loading = false;

  /** Show a message instead of a list. `retryable` only for failures — an empty
   *  menu is a correct answer, and offering to retry it would just repeat it. */
  const renderMessage = (message: string, retryable = false): void => {
    list.replaceChildren();
    list.removeAttribute('data-scrollable');
    empty.textContent = message;
    empty.hidden = false;
    retry.hidden = !retryable;
  };

  const renderDrills = (drills: PracticeDrill[]): void => {
    if (!drills.length) {
      renderMessage(EMPTY_MESSAGE);
      return;
    }
    empty.hidden = true;
    empty.textContent = '';
    retry.hidden = true;
    list.replaceChildren(...drills.map((drill) => {
      const item = doc.createElement('li');
      item.className = 'tv-practice-item';
      item.dataset.kind = drill.kind;

      const title = doc.createElement('div');
      title.className = 'tv-practice-title';
      title.textContent = drill.title;
      item.append(title);

      if (drill.phrase) {
        const sound = doc.createElement('div');
        sound.className = 'tv-practice-sound';
        sound.textContent = drill.phrase;
        item.append(sound);
      }
      if (drill.cue) {
        const cue = doc.createElement('div');
        cue.className = 'tv-practice-cue';
        cue.textContent = drill.cue;
        item.append(cue);
      }
      return item;
    }));
    // Flag "there is more below" so the list can show it. Without a hint, a card
    // sliced by the screen edge reads as the end, and the learner never learns
    // there are five sounds rather than three.
    list.dataset.scrollable = String(list.scrollHeight > list.clientHeight);
  };

  const refresh = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    try {
      // Keep going until what is on screen agrees with the button. Each pass
      // reads the CURRENT intent, so taps that arrive mid-flight are honoured by
      // the next pass rather than lost.
      for (let want = allowLoud; ; want = allowLoud) {
        let drills: PracticeDrill[] | null = null;
        try {
          drills = await options.loadDrills(want);
        } catch {
          // A network failure must not leave the learner staring at a blank list
          // with no explanation, and must not throw into the click handler.
          renderMessage(FAILED_MESSAGE, true);
        }
        // Only paint a result that still matches the button. Painting first and
        // looping afterwards showed the learner the stale list for the whole
        // duration of the next request — a network round trip — so someone who
        // had just switched loud OFF still saw lip trills on screen for it.
        if (want !== allowLoud) continue;
        if (drills) renderDrills(drills);
        break;
      }
    } finally {
      loading = false;
    }
  };

  back.addEventListener('click', () => { options.onBack(); });
  loud.addEventListener('click', () => {
    allowLoud = !allowLoud;
    loud.setAttribute('aria-pressed', String(allowLoud));
    loud.textContent = allowLoud ? LOUD_LABELS.on : LOUD_LABELS.off;
    void refresh();
  });
  // Retries at the CURRENT loudness. The loud toggle used to be the only thing
  // that reloaded, so "try again" and "turn loud on" were the same gesture.
  retry.addEventListener('click', () => { void refresh(); });

  return {
    /** Called when the surface becomes visible; the list is fetched lazily. */
    show: (): void => { void refresh(); },
    isAllowingLoud: (): boolean => allowLoud,
  };
}
