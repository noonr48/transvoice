import type { VoiceCustomTargetPreset } from '../state';

type VoiceCustomPresetListRenderContext = {
  element: HTMLElement | null | undefined;
  presets: VoiceCustomTargetPreset[];
  selectedPresetId: string | null;
  targetSource: string;
};

function buildMetaText(preset: VoiceCustomTargetPreset): string {
  const meta = [
    preset.kind === 'handmade' ? 'Handmade' : 'Reference',
    preset.basePreset || 'cute-feminine',
    preset.referenceClipName || null,
  ].filter(Boolean);
  return meta.join(' • ');
}

function buildSignalPills(preset: VoiceCustomTargetPreset): string[] {
  const target = preset.targetVoiceProfile;
  if (!target) {
    return [];
  }
  const pills: string[] = [];
  if (target.pitchFloorHz != null && target.pitchCeilingHz != null) {
    pills.push(`Pitch ${Math.round(target.pitchFloorHz)}–${Math.round(target.pitchCeilingHz)} Hz`);
  }
  if (target.resonanceFloor != null && target.resonanceCeiling != null) {
    pills.push(`Forward ${target.resonanceFloor.toFixed(2)}–${target.resonanceCeiling.toFixed(2)}`);
  }
  if (target.weightFloor != null && target.weightCeiling != null) {
    pills.push(`Weight ${target.weightFloor.toFixed(2)}–${target.weightCeiling.toFixed(2)}`);
  }
  return pills.slice(0, 3);
}

function appendActionButton(
  container: HTMLElement,
  presetId: string,
  action: 'use' | 'edit' | 'duplicate' | 'archive' | 'restore' | 'delete',
  label: string,
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'voice-btn voice-btn-secondary voice-btn-small';
  button.textContent = label;
  button.dataset.voiceCustomPresetAction = action;
  button.dataset.voiceCustomPresetId = presetId;
  container.appendChild(button);
}

function renderPresetGroup(
  element: HTMLElement,
  presets: VoiceCustomTargetPreset[],
  selectedPresetId: string | null,
  targetSource: string,
  label: string,
  archived: boolean,
): void {
  if (!presets.length) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'voice-custom-preset-group';

  const heading = document.createElement('div');
  heading.className = 'voice-custom-preset-group-title';
  heading.textContent = label;
  section.appendChild(heading);

  for (const preset of presets) {
    const card = document.createElement('div');
    card.className = `voice-custom-preset-item${selectedPresetId === preset.id ? ' selected' : ''}${preset.archived ? ' archived' : ''}`;

    const top = document.createElement('div');
    top.className = 'voice-custom-preset-top';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'voice-custom-preset-title-group';

    const title = document.createElement('span');
    title.className = 'voice-custom-preset-title';
    title.textContent = preset.name;

    const meta = document.createElement('span');
    meta.className = 'voice-custom-preset-meta';
    meta.textContent = buildMetaText(preset);

    titleGroup.append(title, meta);

    const badges = document.createElement('div');
    badges.className = 'voice-custom-preset-badges';

    if (selectedPresetId === preset.id) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'voice-drill-badge current';
      activeBadge.textContent = targetSource === 'custom-handmade' || targetSource === 'custom-reference'
        ? 'Active target'
        : 'Selected';
      badges.appendChild(activeBadge);
    }

    if (preset.archived) {
      const archivedBadge = document.createElement('span');
      archivedBadge.className = 'voice-drill-badge';
      archivedBadge.textContent = 'Archived';
      badges.appendChild(archivedBadge);
    }

    if (preset.sourceLabel) {
      const sourceBadge = document.createElement('span');
      sourceBadge.className = 'voice-drill-badge recommended';
      sourceBadge.textContent = preset.sourceLabel;
      badges.appendChild(sourceBadge);
    }

    top.append(titleGroup, badges);

    const detailPills = buildSignalPills(preset);
    if (detailPills.length) {
      const details = document.createElement('div');
      details.className = 'voice-inline-badges';
      for (const pillText of detailPills) {
        const pill = document.createElement('span');
        pill.className = 'voice-drill-badge';
        pill.textContent = pillText;
        details.appendChild(pill);
      }
      card.append(top, details);
    } else {
      card.append(top);
    }

    const actions = document.createElement('div');
    actions.className = 'voice-inline-actions';

    if (!archived) {
      appendActionButton(actions, preset.id, 'use', 'Use');
      appendActionButton(actions, preset.id, 'edit', preset.kind === 'reference' ? 'Rename' : 'Edit');
      appendActionButton(actions, preset.id, 'duplicate', 'Duplicate');
      appendActionButton(actions, preset.id, 'archive', 'Archive');
    } else {
      appendActionButton(actions, preset.id, 'restore', 'Restore');
    }
    appendActionButton(actions, preset.id, 'delete', archived ? 'Delete Permanently' : 'Delete');

    card.appendChild(actions);
    section.appendChild(card);
  }

  element.appendChild(section);
}

export function renderVoiceCustomPresetList({
  element,
  presets,
  selectedPresetId,
  targetSource,
}: VoiceCustomPresetListRenderContext): void {
  if (!element) {
    return;
  }

  element.replaceChildren();

  if (!presets.length) {
    const empty = document.createElement('div');
    empty.className = 'voice-drill-empty';
    empty.textContent = 'No saved voice targets yet. Save Current Reference As New or Save Handmade Preset to create one.';
    element.appendChild(empty);
    return;
  }

  const activePresets = presets.filter((preset) => !preset.archived);
  const archivedPresets = presets.filter((preset) => preset.archived);

  renderPresetGroup(element, activePresets, selectedPresetId, targetSource, 'Saved targets', false);
  renderPresetGroup(element, archivedPresets, selectedPresetId, targetSource, 'Archived targets', true);
}
