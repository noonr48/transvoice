// Lesson surface — voice compass restyle (Wave B).
//
// Adds a soft TARGET REGION + quadrant hints to the existing #voice-graph-shell.
// The target region is derived from the reference-derived bands on
// targetVoiceProfile (pitchFloorHz/pitchCeilingHz + resonanceFloor/resonanceCeiling)
// and placed using the SAME coordinate transform the live dot uses, so it lines
// up exactly with renderVoiceGraphDot.
//
// COORDINATE TRANSFORM is shared with render/graph.ts through
// measurement-domain.ts so every valid 80–400 Hz custom target is visible.
// Higher pitch -> smaller top% (toward the top). Brighter resonance -> larger
// left% (toward the right). The region is the rect spanning the band corners.
//
// DOM renderer for the band rect; quadrant hint labels are static (built once).

import type { VoiceTargetProfile } from '../contracts';
import {
  voicePitchToGraphTopPct,
  voiceResonanceToGraphLeftPct,
} from '../measurement-domain';

export type CompassBands = {
  pitchFloorHz: number | null;
  pitchCeilingHz: number | null;
  resonanceFloor: number | null;
  resonanceCeiling: number | null;
};

export type CompassRegionRect = {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  label: string; // for the title attr / aria
};

function resonanceToLeftPct(resonance: number): number {
  return voiceResonanceToGraphLeftPct(resonance);
}

function pitchToTopPct(pitchHz: number): number {
  return voicePitchToGraphTopPct(pitchHz);
}

export function compassBandsFromProfile(profile: VoiceTargetProfile | null | undefined): CompassBands {
  return {
    pitchFloorHz: typeof profile?.pitchFloorHz === 'number' ? profile.pitchFloorHz : null,
    pitchCeilingHz: typeof profile?.pitchCeilingHz === 'number' ? profile.pitchCeilingHz : null,
    resonanceFloor: typeof profile?.resonanceFloor === 'number' ? profile.resonanceFloor : null,
    resonanceCeiling: typeof profile?.resonanceCeiling === 'number' ? profile.resonanceCeiling : null,
  };
}

/**
 * Compute the translucent target-region rect in graph %-coords, or null when
 * the bands are insufficient (need at least one full axis pair). A missing axis
 * spans the full extent of that axis so a half-specified target still hints.
 */
export function compassRegionRect(bands: CompassBands): CompassRegionRect | null {
  const hasPitch = bands.pitchFloorHz != null && bands.pitchCeilingHz != null;
  const hasResonance = bands.resonanceFloor != null && bands.resonanceCeiling != null;
  if (!hasPitch && !hasResonance) return null;

  // Resonance -> horizontal extent.
  const resLeft = hasResonance ? resonanceToLeftPct(Math.min(bands.resonanceFloor!, bands.resonanceCeiling!)) : 12;
  const resRight = hasResonance ? resonanceToLeftPct(Math.max(bands.resonanceFloor!, bands.resonanceCeiling!)) : 88;

  // Pitch -> vertical extent. Higher pitch = smaller top%, so the ceiling maps
  // to the top edge and the floor to the bottom edge.
  const pitchTopEdge = hasPitch ? pitchToTopPct(Math.max(bands.pitchFloorHz!, bands.pitchCeilingHz!)) : 12;
  const pitchBottomEdge = hasPitch ? pitchToTopPct(Math.min(bands.pitchFloorHz!, bands.pitchCeilingHz!)) : 88;

  const leftPct = Math.min(resLeft, resRight);
  const widthPct = Math.max(Math.abs(resRight - resLeft), 2);
  const topPct = Math.min(pitchTopEdge, pitchBottomEdge);
  const heightPct = Math.max(Math.abs(pitchBottomEdge - pitchTopEdge), 2);

  const labelParts: string[] = [];
  if (hasPitch) {
    labelParts.push(`pitch ${Math.round(Math.min(bands.pitchFloorHz!, bands.pitchCeilingHz!))}–${Math.round(Math.max(bands.pitchFloorHz!, bands.pitchCeilingHz!))} Hz`);
  }
  if (hasResonance) {
    labelParts.push(`resonance ${Math.round(Math.min(bands.resonanceFloor!, bands.resonanceCeiling!) * 100)}–${Math.round(Math.max(bands.resonanceFloor!, bands.resonanceCeiling!) * 100)}%`);
  }

  return {
    leftPct,
    topPct,
    widthPct,
    heightPct,
    label: labelParts.length ? `Target zone: ${labelParts.join(', ')}` : 'Target zone',
  };
}

/**
 * Apply the region rect to a target-region element (positioned absolutely inside
 * the graph grid). Hides it when null. Cheap: only writes when values change.
 */
export function renderVoiceLessonTargetRegion(
  element: HTMLElement | null | undefined,
  rect: CompassRegionRect | null,
): void {
  if (!element) return;
  if (!rect) {
    element.classList.add('hidden');
    element.removeAttribute('title');
    return;
  }
  element.classList.remove('hidden');
  element.style.left = `${rect.leftPct}%`;
  element.style.top = `${rect.topPct}%`;
  element.style.width = `${rect.widthPct}%`;
  element.style.height = `${rect.heightPct}%`;
  if (element.getAttribute('title') !== rect.label) {
    element.setAttribute('title', rect.label);
    element.setAttribute('aria-label', rect.label);
  }
}
