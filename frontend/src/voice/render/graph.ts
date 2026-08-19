import {
  clampVoiceMetric,
  isVoiceAttemptMeasurementUsable,
  type VoiceAttemptMetrics,
  type VoiceLiveFrame,
} from '../state';
import {
  voicePitchToGraphTopPct,
  voiceResonanceToGraphLeftPct,
} from '../measurement-domain';

type VoiceGraphMetrics = Partial<VoiceAttemptMetrics> | null;

type VoicePolylinePathRenderContext = {
  svgEl: SVGSVGElement | null | undefined;
  polylineEl: SVGPolylineElement | null | undefined;
  timeline: VoiceLiveFrame[] | null | undefined;
  extraPolylineEls?: Array<SVGPolylineElement | null | undefined>;
};

type VoiceGraphDotRenderContext = {
  element: HTMLElement | null | undefined;
  metrics: VoiceGraphMetrics;
  isReference?: boolean;
};

type VoiceForecastPathRenderContext = {
  svgEl: SVGSVGElement | null | undefined;
  polylineEl: SVGPolylineElement | null | undefined;
  corridorEl: SVGPolylineElement | null | undefined;
  timeline: VoiceLiveFrame[] | null | undefined;
};

type VoiceGraphPoint = {
  left: number;
  top: number;
  weight: number;
  confidence: number;
  vocalSize: number;
};

export function getVoiceMetricsFromFrame(frame: VoiceLiveFrame | null): Partial<VoiceAttemptMetrics> | null {
  if (!frame) return null;
  return {
    meanPitchHz: frame.pitchHz,
    resonanceMean: frame.resonanceScore,
    weightMean: frame.weightScore,
    targetHitPct: frame.confidence,
  };
}

function getVoiceGraphPoint(metrics: VoiceGraphMetrics): VoiceGraphPoint | null {
  if (!metrics || !isVoiceAttemptMeasurementUsable(metrics)) return null;
  const essentialMetrics = [
    metrics.meanPitchHz,
    metrics.resonanceMean,
    metrics.weightMean,
    metrics.targetHitPct,
  ];
  if (!essentialMetrics.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  const resonance = clampVoiceMetric(metrics.resonanceMean!, 0, 1);
  const pitch = metrics.meanPitchHz!;
  const weight = clampVoiceMetric(metrics.weightMean!, 0, 1);
  const confidence = clampVoiceMetric(metrics.targetHitPct!, 0.2, 1);
  const vocalSize = clampVoiceMetric(((1 - resonance) * 0.7) + (weight * 0.3), 0, 1);
  return {
    left: voiceResonanceToGraphLeftPct(resonance),
    top: voicePitchToGraphTopPct(pitch),
    weight,
    confidence,
    vocalSize,
  };
}

function getVoiceTimelineGraphPoints(timeline: VoiceLiveFrame[] | null | undefined): Array<{ left: number; top: number }> {
  return (Array.isArray(timeline) ? timeline : [])
    .filter((frame) => frame?.voiced)
    .map((frame) => getVoiceGraphPoint(getVoiceMetricsFromFrame(frame)))
    .filter(Boolean) as Array<{ left: number; top: number }>;
}

export function hasVoiceTimelinePath(timeline: VoiceLiveFrame[] | null | undefined): boolean {
  return getVoiceTimelineGraphPoints(timeline).length >= 2;
}

export function renderVoicePolylinePath({
  svgEl,
  polylineEl,
  timeline,
  extraPolylineEls = [],
}: VoicePolylinePathRenderContext): void {
  if (!svgEl || !polylineEl) return;
  const points = getVoiceTimelineGraphPoints(timeline);
  if (points.length < 2) {
    svgEl.classList.add('hidden');
    polylineEl.setAttribute('points', '');
    extraPolylineEls.forEach((extraPolylineEl) => extraPolylineEl?.setAttribute('points', ''));
    return;
  }

  const pointString = points.map((point) => `${point.left},${point.top}`).join(' ');
  svgEl.classList.remove('hidden');
  polylineEl.setAttribute('points', pointString);
  extraPolylineEls.forEach((extraPolylineEl) => extraPolylineEl?.setAttribute('points', pointString));
}

export function renderVoiceGraphDot({
  element,
  metrics,
  isReference = false,
}: VoiceGraphDotRenderContext): void {
  if (!element) return;
  const point = getVoiceGraphPoint(metrics);
  if (!point) {
    element.classList.add('hidden');
    return;
  }

  const dotSize = isReference ? 16 + point.vocalSize * 16 : 14 + point.vocalSize * 18;
  const weightClass = point.weight < 0.4
    ? 'voice-graph-dot-light'
    : point.weight < 0.68
      ? 'voice-graph-dot-mid'
      : 'voice-graph-dot-heavy';
  const opacity = isReference
    ? 0.44 + point.confidence * 0.44
    : 0.55 + point.confidence * 0.4;
  const haloSpread = isReference ? 3 + point.confidence * 4 : 4 + point.confidence * 5;
  const haloGlow = isReference ? 10 + point.confidence * 10 : 12 + point.confidence * 12;

  element.classList.remove('hidden');
  element.classList.remove(
    'voice-graph-dot-light',
    'voice-graph-dot-mid',
    'voice-graph-dot-heavy',
  );
  element.classList.toggle('voice-graph-reference-dot', isReference);
  if (!isReference) element.classList.add(weightClass);
  element.style.setProperty('--voice-dot-left', `${point.left}%`);
  element.style.setProperty('--voice-dot-top', `${point.top}%`);
  element.style.setProperty('--voice-dot-size', `${dotSize}px`);
  element.style.setProperty('--voice-dot-opacity', String(opacity));
  element.style.setProperty('--voice-dot-halo-spread', `${haloSpread}px`);
  element.style.setProperty('--voice-dot-halo-glow', `${haloGlow}px`);
}

export function renderVoiceForecastPath({
  svgEl,
  polylineEl,
  corridorEl,
  timeline,
}: VoiceForecastPathRenderContext): void {
  renderVoicePolylinePath({
    svgEl,
    polylineEl,
    timeline,
    extraPolylineEls: [corridorEl],
  });
}
