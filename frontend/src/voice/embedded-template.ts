import { getVoiceTutorStandaloneTemplateHtml } from './standalone-template';

export const VOICE_PANEL_TEMPLATE_SLOT_ID = 'voice-panel-template-slot';
export const VOICE_LAB_PANEL_TEMPLATE_SLOT_ID = 'voice-lab-panel-template-slot';

type VoiceTutorEmbeddedTemplateMountResult = {
  mounted: boolean;
  panelSlotId: string;
  labPanelSlotId: string;
};

type VoiceTutorEmbeddedTemplateMountOptions = {
  documentRef?: Document;
};

function getRequiredSlot(documentRef: Document, id: string): HTMLElement {
  const slot = documentRef.getElementById(id);
  if (!slot) {
    throw new Error(`Missing Voice Tutor template slot: #${id}`);
  }
  return slot as HTMLElement;
}

function getTemplateElement(template: HTMLTemplateElement, id: string): HTMLElement {
  const element = template.content.querySelector<HTMLElement>(`#${id}`);
  if (!element) {
    throw new Error(`Voice Tutor template is missing #${id}`);
  }
  return element;
}

export function mountVoiceTutorEmbeddedTemplate({
  documentRef = document,
}: VoiceTutorEmbeddedTemplateMountOptions = {}): VoiceTutorEmbeddedTemplateMountResult {
  const existingPanel = documentRef.getElementById('voice-panel');
  const existingLabPanel = documentRef.getElementById('voice-lab-panel');
  if (existingPanel || existingLabPanel) {
    if (existingPanel && existingLabPanel) {
      return {
        mounted: false,
        panelSlotId: VOICE_PANEL_TEMPLATE_SLOT_ID,
        labPanelSlotId: VOICE_LAB_PANEL_TEMPLATE_SLOT_ID,
      };
    }
    throw new Error('Voice Tutor template is partially mounted.');
  }

  const panelSlot = getRequiredSlot(documentRef, VOICE_PANEL_TEMPLATE_SLOT_ID);
  const labPanelSlot = getRequiredSlot(documentRef, VOICE_LAB_PANEL_TEMPLATE_SLOT_ID);
  const template = documentRef.createElement('template');
  template.innerHTML = getVoiceTutorStandaloneTemplateHtml().trim();

  panelSlot.replaceChildren(getTemplateElement(template, 'voice-panel').cloneNode(true));
  labPanelSlot.replaceChildren(getTemplateElement(template, 'voice-lab-panel').cloneNode(true));

  return {
    mounted: true,
    panelSlotId: VOICE_PANEL_TEMPLATE_SLOT_ID,
    labPanelSlotId: VOICE_LAB_PANEL_TEMPLATE_SLOT_ID,
  };
}
