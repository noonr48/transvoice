// Lesson surface — the time-lapse mirror (v1.5, DOM controller).
//
// The person's own recorded arc — the honest progress device (no XP could ever
// compete with hearing your own voice change; PRACTICE-PHILOSOPHY.md §4). A
// modest takeover panel:
//   - entry: a small "Your arc" link near the compass.
//   - lists pinned milestones on a simple time axis (date · label · duration).
//   - default comparison earliest vs latest; the user may select any two
//     (then/now), selected by row.
//   - playback: take A then take B SEQUENTIALLY through the EXTENDED replay
//     machinery (its own controller instance bound to this panel's compass);
//     each take animates its own compass trail — muted "then" color vs the
//     standard "now" color — under a plain "⟨date⟩ → ⟨date⟩" header.
//   - honest copy: "Same phrase not required — listen for the center of the
//     voice." Unpin (DELETE) per row with a plain confirm.
//   - empty state: "When a take is worth keeping, you can pin it here — one a
//     week is plenty."
//
// Reuse, not fork: this builds ONE createVoiceLessonReplayController bound to the
// mirror panel's own compass/trail/dot, and chains A->B via the replay
// controller's new onComplete hook + trailVariant. The audio lifecycle, frame
// mapping, token sync, and teardown are 100% the existing playback core.
//
// As a takeover surface, its panel id (voice-lesson-mirror-overlay) is added to
// the lesson controller's isBlockingSurfaceOpen list so practice keys don't fire
// behind it. Self-contained: optional DOM lookups, all listeners torn down.

import {
  resolveMirrorPair,
  sanitizeMilestones,
  mirrorPairHeader,
  milestoneRowLabel,
  MIRROR_HONEST_LINE,
  MIRROR_EMPTY_LINE,
  type VoiceMirrorPair,
} from './mirror-pure';
import { createVoiceLessonReplayController } from './replay';
import type { VoiceMilestone } from '../api';

export type VoiceMirrorOptions = {
  doc: Document;
  // List pinned milestones (GET /voice/milestones), oldest first.
  listMilestones: () => Promise<VoiceMilestone[]>;
  // Build a milestone-audio URL (kernel proxy; auth injected server-side).
  milestoneAudioUrl: (milestoneId: string) => string;
  // Unpin a milestone (DELETE /voice/milestone/:id).
  deleteMilestone: (milestoneId: string) => Promise<{ success?: boolean }>;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

function getEl(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id);
}

export function createVoiceMirror(options: VoiceMirrorOptions) {
  const { doc } = options;

  // --- DOM (all optional) ---
  const linkEl = getEl(doc, 'voice-lesson-mirror-link') as HTMLButtonElement | null;
  const overlayEl = getEl(doc, 'voice-lesson-mirror-overlay');
  const closeEl = getEl(doc, 'voice-lesson-mirror-close') as HTMLButtonElement | null;
  const listEl = getEl(doc, 'voice-lesson-mirror-list');
  const emptyEl = getEl(doc, 'voice-lesson-mirror-empty');
  const headerEl = getEl(doc, 'voice-lesson-mirror-header');
  const honestEl = getEl(doc, 'voice-lesson-mirror-honest');
  const playBtn = getEl(doc, 'voice-lesson-mirror-play') as HTMLButtonElement | null;
  const statusEl = getEl(doc, 'voice-lesson-mirror-status');

  // The mirror's OWN replay compass (separate from the practice replay overlay).
  const replay = createVoiceLessonReplayController({
    overlay: getEl(doc, 'voice-lesson-mirror-compass'),
    dot: getEl(doc, 'voice-lesson-mirror-dot'),
    trailSvg: doc.getElementById('voice-lesson-mirror-trail') as unknown as SVGSVGElement | null,
    trailPolyline: doc.getElementById('voice-lesson-mirror-trail-line') as unknown as SVGPolylineElement | null,
    status: getEl(doc, 'voice-lesson-mirror-replay-status'),
    cardStrip: null,
    closeButton: null,
  });

  // Persistent listeners (bound once in bind(), live for the panel's lifetime).
  const listenerCleanups: Array<() => void> = [];
  // Per-render row listeners — cleared and rebuilt on every renderList() so they
  // don't accumulate across a long session of opens/unpins.
  let rowCleanups: Array<() => void> = [];
  let milestones: VoiceMilestone[] = [];
  let thenId: string | null = null;
  let nowId: string | null = null;
  let isOpenFlag = false;

  function clearRowListeners(): void {
    rowCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    rowCleanups = [];
  }

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function show(el: HTMLElement | null, visible: boolean): void {
    el?.classList.toggle('hidden', !visible);
  }

  function currentPair(): VoiceMirrorPair | null {
    return resolveMirrorPair(milestones, { thenId, nowId });
  }

  function renderHeader(): void {
    const pair = currentPair();
    if (headerEl) headerEl.textContent = mirrorPairHeader(pair);
    if (playBtn) playBtn.disabled = !pair;
    // Reflect the effective selection back onto the rows (default extremes when
    // the user hasn't chosen).
    if (pair && listEl) {
      const rows = listEl.querySelectorAll<HTMLElement>('.voice-lesson-mirror-row');
      rows.forEach((row, index) => {
        row.classList.toggle('voice-lesson-mirror-row-then', index === pair.thenIndex);
        row.classList.toggle('voice-lesson-mirror-row-now', index === pair.nowIndex);
      });
    }
  }

  function selectRow(index: number): void {
    const milestone = milestones[index];
    if (!milestone) return;
    // Cycle a row through: set as "now" -> set as "then" -> clear. Simple and
    // discoverable; the resolver always orients then(earlier) -> now(later).
    const id = milestone.id;
    if (nowId === id) {
      nowId = null;
      thenId = id;
    } else if (thenId === id) {
      thenId = null;
    } else {
      // Default new pick to "now"; the previous now (if any) stays as the pair's
      // other end via the resolver's extreme fallback.
      nowId = id;
    }
    renderHeader();
  }

  function renderList(): void {
    const clean = sanitizeMilestones(milestones);
    const has = clean.length > 0;
    show(emptyEl, !has);
    show(listEl, has);
    show(headerEl, clean.length >= 2);
    show(playBtn, clean.length >= 2);
    if (emptyEl) emptyEl.textContent = MIRROR_EMPTY_LINE;
    if (honestEl) honestEl.textContent = MIRROR_HONEST_LINE;
    if (!listEl) return;
    // Drop the prior render's row listeners before rebuilding (no accumulation).
    clearRowListeners();
    listEl.replaceChildren();
    clean.forEach((milestone, index) => {
      const row = doc.createElement('div');
      row.className = 'voice-lesson-mirror-row';

      const pick = doc.createElement('button');
      pick.type = 'button';
      pick.className = 'voice-lesson-mirror-row-pick';
      pick.textContent = milestoneRowLabel(milestone) || 'a take';
      pick.setAttribute('aria-label', `Compare this take: ${milestoneRowLabel(milestone) || 'a take'}`);
      const onPick = (): void => selectRow(index);
      pick.addEventListener('click', onPick);
      rowCleanups.push(() => pick.removeEventListener('click', onPick));

      const unpin = doc.createElement('button');
      unpin.type = 'button';
      unpin.className = 'voice-lesson-mirror-row-unpin';
      unpin.textContent = 'Unpin';
      unpin.setAttribute('aria-label', `Unpin this take: ${milestoneRowLabel(milestone) || 'a take'}`);
      const onUnpin = (): void => { void unpinMilestone(milestone); };
      unpin.addEventListener('click', onUnpin);
      rowCleanups.push(() => unpin.removeEventListener('click', onUnpin));

      row.append(pick, unpin);
      listEl.appendChild(row);
    });
    renderHeader();
  }

  async function unpinMilestone(milestone: VoiceMilestone): Promise<void> {
    const label = milestoneRowLabel(milestone) || 'this take';
    // Plain confirm, per the contract — not a styled modal.
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Unpin ${label}? It will no longer appear in your arc.`)
      : true;
    if (!ok) return;
    try {
      await options.deleteMilestone(milestone.id);
      milestones = milestones.filter((m) => m.id !== milestone.id);
      if (thenId === milestone.id) thenId = null;
      if (nowId === milestone.id) nowId = null;
      renderList();
      log('system', 'Take unpinned from your arc.');
    } catch (error) {
      log('warning', `Could not unpin that take: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  function playPair(): void {
    const pair = currentPair();
    if (!pair) return;
    setStatus(`${mirrorPairHeader(pair)} — playing then…`);
    // Take A ("then"), muted trail; on complete, chain take B ("now").
    replay.open({
      sourceControl: 'voice-lesson-mirror-play',
      attemptId: pair.then.attemptId ?? null,
      frames: [],
      card: null,
      momentProgress: null,
      reason: null,
      resolveAudioUrl: () => options.milestoneAudioUrl(pair.then.id),
      trailVariant: 'then',
      visualOnlyDurationMs: 3500,
      onComplete: () => {
        setStatus(`${mirrorPairHeader(pair)} — playing now…`);
        replay.open({
          attemptId: pair.now.attemptId ?? null,
          frames: [],
          card: null,
          momentProgress: null,
          reason: null,
          resolveAudioUrl: () => options.milestoneAudioUrl(pair.now.id),
          trailVariant: 'now',
          visualOnlyDurationMs: 3500,
          onComplete: () => setStatus(`${mirrorPairHeader(pair)} — that was then, and now.`),
        });
      },
    });
  }

  async function open(): Promise<void> {
    if (!overlayEl) return;
    overlayEl.classList.remove('hidden');
    overlayEl.setAttribute('aria-hidden', 'false');
    isOpenFlag = true;
    setStatus('');
    try {
      milestones = sanitizeMilestones(await options.listMilestones());
    } catch (error) {
      milestones = [];
      log('warning', `Could not load your arc: ${error instanceof Error ? error.message : String(error)}`);
    }
    renderList();
  }

  function close(): void {
    replay.close();
    overlayEl?.classList.add('hidden');
    overlayEl?.setAttribute('aria-hidden', 'true');
    isOpenFlag = false;
  }

  function isOpen(): boolean {
    return isOpenFlag || Boolean(overlayEl && !overlayEl.classList.contains('hidden'));
  }

  function bind(): void {
    const on = (el: HTMLElement | null, type: string, handler: EventListener): void => {
      if (!el) return;
      el.addEventListener(type, handler);
      listenerCleanups.push(() => el.removeEventListener(type, handler));
    };
    on(linkEl, 'click', () => { void open(); });
    on(closeEl, 'click', () => close());
    on(playBtn, 'click', () => playPair());
    // Esc + backdrop close (the panel owns this while it's the takeover surface).
    const onKeydown = (event: Event): void => {
      if (isOpen() && (event as KeyboardEvent).key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    doc.addEventListener('keydown', onKeydown);
    listenerCleanups.push(() => doc.removeEventListener('keydown', onKeydown));
    const onBackdrop = (event: Event): void => {
      if (event.target === overlayEl) close();
    };
    overlayEl?.addEventListener('click', onBackdrop);
    listenerCleanups.push(() => overlayEl?.removeEventListener('click', onBackdrop));
  }

  function start(): void {
    bind();
  }

  function dispose(): void {
    replay.dispose();
    clearRowListeners();
    listenerCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    listenerCleanups.length = 0;
  }

  return { start, open, close, isOpen, dispose };
}

export type VoiceMirror = ReturnType<typeof createVoiceMirror>;
