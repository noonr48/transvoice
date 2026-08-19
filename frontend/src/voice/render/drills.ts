import type { VoiceDrill, VoiceDrillState } from '../state';

type VoiceDrillSelectHandler = (drillId: string) => Promise<void>;
type VoiceDrillSelectErrorHandler = (error: unknown) => void;

type VoiceRecommendedDrillsRenderContext = {
  element: HTMLElement | null | undefined;
  drills: VoiceDrill[];
  selectedDrillId: string | null;
  drillStatus: 'idle' | 'loading' | 'error';
  currentSessionId: string | null;
  isConnected: boolean;
  targetMutationLocked?: boolean;
  selectionPendingId: string | null;
  onSelectDrill: VoiceDrillSelectHandler;
  onSelectError: VoiceDrillSelectErrorHandler;
};

type VoiceDrillListRenderContext = {
  element: HTMLElement | null | undefined;
  drillState: VoiceDrillState;
  drillStatus: 'idle' | 'loading' | 'error';
  drillError: string | null;
  selectedDrillId: string | null;
  currentSessionId: string | null;
  isConnected: boolean;
  targetMutationLocked?: boolean;
  selectionPendingId: string | null;
  onSelectDrill: VoiceDrillSelectHandler;
  onSelectError: VoiceDrillSelectErrorHandler;
};

function attachVoiceDrillSelect(
  button: HTMLButtonElement,
  drillId: string,
  onSelectDrill: VoiceDrillSelectHandler,
  onSelectError: VoiceDrillSelectErrorHandler,
): void {
  button.addEventListener('click', () => {
    onSelectDrill(drillId).catch((error) => {
      onSelectError(error);
    });
  });
}

export function renderVoiceRecommendedDrills({
  element,
  drills,
  selectedDrillId,
  drillStatus,
  currentSessionId,
  isConnected,
  targetMutationLocked = false,
  selectionPendingId,
  onSelectDrill,
  onSelectError,
}: VoiceRecommendedDrillsRenderContext): void {
  if (!element) return;
  element.replaceChildren();

  if (drills.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'voice-pill';
    empty.textContent = drillStatus === 'loading' ? 'Loading drills…' : 'No recommendations yet';
    element.appendChild(empty);
    return;
  }

  for (const drill of drills) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `voice-pill${selectedDrillId === drill.id ? ' active' : ''}`;
    pill.textContent = drill.title;
    pill.disabled = !currentSessionId || !isConnected || targetMutationLocked || selectionPendingId === drill.id;
    attachVoiceDrillSelect(pill, drill.id, onSelectDrill, onSelectError);
    element.appendChild(pill);
  }
}

export function renderVoiceDrillList({
  element,
  drillState,
  drillStatus,
  drillError,
  selectedDrillId,
  currentSessionId,
  isConnected,
  targetMutationLocked = false,
  selectionPendingId,
  onSelectDrill,
  onSelectError,
}: VoiceDrillListRenderContext): void {
  if (!element) return;
  element.replaceChildren();

  if (drillStatus === 'loading' && drillState.drills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-drill-empty';
    empty.textContent = 'Loading guided drill pack…';
    element.appendChild(empty);
    return;
  }

  if (drillStatus === 'error' && drillState.drills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-drill-empty';
    empty.textContent = drillError || 'Guided drills are temporarily unavailable.';
    element.appendChild(empty);
    return;
  }

  if (drillState.drills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-drill-empty';
    empty.textContent = 'Guided drills will appear here once the trainer syncs.';
    element.appendChild(empty);
    return;
  }

  const recommendedIds = new Set(drillState.recommendedIds);

  for (const drill of drillState.drills) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `voice-drill-item${selectedDrillId === drill.id ? ' selected' : ''}`;
    button.disabled = !currentSessionId || !isConnected || targetMutationLocked || selectionPendingId === drill.id;

    const top = document.createElement('div');
    top.className = 'voice-drill-top';

    const title = document.createElement('span');
    title.className = 'voice-drill-title';
    title.textContent = drill.title;

    const focus = document.createElement('span');
    focus.className = 'voice-drill-focus';
    focus.textContent = drill.focus || 'Guided drill';

    top.append(title, focus);

    const phrase = document.createElement('div');
    phrase.className = 'voice-drill-phrase';
    phrase.textContent = drill.phrase ? `"${drill.phrase}"` : 'No phrase loaded';

    const meta = document.createElement('div');
    meta.className = 'voice-drill-meta';
    const metaBits = [
      drill.description,
      drill.cues.slice(0, 2).join(' • '),
    ].filter(Boolean);
    meta.textContent = metaBits.join(' ');

    const badges = document.createElement('div');
    badges.className = 'voice-drill-badges';
    if (recommendedIds.has(drill.id)) {
      const recommended = document.createElement('span');
      recommended.className = 'voice-drill-badge recommended';
      recommended.textContent = 'Recommended';
      badges.appendChild(recommended);
    }
    if (selectedDrillId === drill.id) {
      const current = document.createElement('span');
      current.className = 'voice-drill-badge current';
      current.textContent = selectionPendingId === drill.id ? 'Loading…' : 'Current drill';
      badges.appendChild(current);
    }

    button.append(top, phrase, meta);
    if (badges.childElementCount > 0) {
      button.appendChild(badges);
    }

    attachVoiceDrillSelect(button, drill.id, onSelectDrill, onSelectError);
    element.appendChild(button);
  }
}
