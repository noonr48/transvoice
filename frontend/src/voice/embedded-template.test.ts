import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  mountVoiceTutorEmbeddedTemplate,
  VOICE_LAB_PANEL_TEMPLATE_SLOT_ID,
  VOICE_PANEL_TEMPLATE_SLOT_ID,
} from './embedded-template';

describe('voice embedded template', () => {
  it('mounts the canonical Voice Tutor template into the main SLOANE slots', () => {
    document.body.innerHTML = `
      <aside>
        <div id="${VOICE_PANEL_TEMPLATE_SLOT_ID}" data-voice-template-slot="voice-panel"></div>
      </aside>
      <section>
        <div id="${VOICE_LAB_PANEL_TEMPLATE_SLOT_ID}" data-voice-template-slot="voice-lab-panel"></div>
      </section>
    `;

    const result = mountVoiceTutorEmbeddedTemplate({ documentRef: document });

    expect(result.mounted).toBe(true);
    expect(document.getElementById('voice-panel')?.parentElement?.id).toBe(VOICE_PANEL_TEMPLATE_SLOT_ID);
    expect(document.getElementById('voice-lab-panel')?.parentElement?.id).toBe(VOICE_LAB_PANEL_TEMPLATE_SLOT_ID);
    expect(document.getElementById('voice-target-preset')).not.toBeNull();
    // Owner's law (2026-07-27): coach mode is SPOKEN — no typed input, no
    // send button, anywhere the canonical template mounts.
    expect(document.getElementById('voice-coach-send')).toBeNull();
    expect(document.getElementById('voice-coach-question')).toBeNull();
    expect(document.getElementById('voice-coach-voice-toggle')).not.toBeNull();
    expect((document.getElementById('voice-reference-player') as HTMLAudioElement).preload).toBe('none');
    expect(document.body.textContent).not.toContain("Stop while it's good");
  });

  it('is idempotent when both Voice Tutor panels are already mounted', () => {
    document.body.innerHTML = '<div id="voice-panel"></div><div id="voice-lab-panel"></div>';

    expect(mountVoiceTutorEmbeddedTemplate({ documentRef: document })).toEqual({
      mounted: false,
      panelSlotId: VOICE_PANEL_TEMPLATE_SLOT_ID,
      labPanelSlotId: VOICE_LAB_PANEL_TEMPLATE_SLOT_ID,
    });
  });

  it('fails closed on partial template mounts', () => {
    document.body.innerHTML = '<div id="voice-panel"></div>';

    expect(() => mountVoiceTutorEmbeddedTemplate({ documentRef: document }))
      .toThrow('Voice Tutor template is partially mounted.');
  });

  // Skipped in the standalone build: index.html is the SLOANE-monolith embedded-host
  // entry and was never carried into this standalone frontend. The first three tests
  // above cover the mount logic against inline slots. Re-enable if the host returns.
  it.skip('mounts into the actual SLOANE index template slots', () => {
    const indexDocument = new DOMParser().parseFromString(
      readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'),
      'text/html',
    );

    const result = mountVoiceTutorEmbeddedTemplate({ documentRef: indexDocument });

    expect(result.mounted).toBe(true);
    expect(indexDocument.getElementById('voice-panel')).not.toBeNull();
    expect(indexDocument.getElementById('voice-lab-panel')).not.toBeNull();
    expect(indexDocument.getElementById('voice-panel-template-slot')?.children).toHaveLength(1);
    expect(indexDocument.getElementById('voice-lab-panel-template-slot')?.children).toHaveLength(1);
  });
});
