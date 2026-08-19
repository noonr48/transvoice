import { describe, expect, it } from 'vitest';
import { renderVoiceGraphDot } from './graph';

describe('voice graph dot rendering', () => {
  it('uses vocal size rather than confidence for dot size', () => {
    const element = document.createElement('div');

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 190,
        resonanceMean: 0.9,
        weightMean: 0.1,
        targetHitPct: 0.25,
      },
    });
    const smallSize = Number.parseFloat(element.style.getPropertyValue('--voice-dot-size'));

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 190,
        resonanceMean: 0.15,
        weightMean: 0.9,
        targetHitPct: 0.95,
      },
    });
    const largeSize = Number.parseFloat(element.style.getPropertyValue('--voice-dot-size'));

    expect(largeSize).toBeGreaterThan(smallSize);
  });

  it('uses confidence for opacity', () => {
    const element = document.createElement('div');

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 190,
        resonanceMean: 0.45,
        weightMean: 0.45,
        targetHitPct: 0.2,
      },
    });
    const lowConfidenceOpacity = Number.parseFloat(element.style.getPropertyValue('--voice-dot-opacity'));

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 190,
        resonanceMean: 0.45,
        weightMean: 0.45,
        targetHitPct: 0.95,
      },
    });
    const highConfidenceOpacity = Number.parseFloat(element.style.getPropertyValue('--voice-dot-opacity'));

    expect(highConfidenceOpacity).toBeGreaterThan(lowConfidenceOpacity);
  });

  it('keeps the full 80–400 Hz custom-target domain spatially distinct', () => {
    const topFor = (pitch: number): number => {
      const element = document.createElement('div');
      renderVoiceGraphDot({
        element,
        metrics: {
          meanPitchHz: pitch,
          resonanceMean: 0.5,
          weightMean: 0.5,
          targetHitPct: 0.8,
        },
      });
      return Number.parseFloat(element.style.getPropertyValue('--voice-dot-top'));
    };

    expect(topFor(80)).toBeCloseTo(88);
    expect(topFor(100)).toBeLessThan(topFor(80));
    expect(topFor(330)).toBeLessThan(topFor(320));
    expect(topFor(400)).toBeCloseTo(12);
  });

  it('hides the dot when the analyzer explicitly rejected the measurement', () => {
    const element = document.createElement('div');

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 201.5,
        resonanceMean: 0.95,
        weightMean: 0.05,
        targetHitPct: 0.99,
        advanced: { measurementAvailable: false },
      },
    });

    expect(element.classList.contains('hidden')).toBe(true);
    expect(element.style.getPropertyValue('--voice-dot-left')).toBe('');
    expect(element.style.getPropertyValue('--voice-dot-top')).toBe('');
  });

  it('hides the dot for a measurable but one-frame low-confidence take', () => {
    const element = document.createElement('div');

    renderVoiceGraphDot({
      element,
      metrics: {
        meanPitchHz: 219,
        resonanceMean: 0.91,
        weightMean: 0.08,
        targetHitPct: 0.99,
        advanced: {
          measurementAvailable: true,
          voicedFramePct: 0.01,
          scoreConfidence: 0.04,
          captureReliability: 0.08,
        },
      },
    });

    expect(element.classList.contains('hidden')).toBe(true);
    expect(element.style.getPropertyValue('--voice-dot-left')).toBe('');
    expect(element.style.getPropertyValue('--voice-dot-top')).toBe('');
  });

  it('hides the dot instead of fabricating coordinates from missing metrics', () => {
    const completeMetrics = {
      meanPitchHz: 190,
      resonanceMean: 0.5,
      weightMean: 0.5,
      targetHitPct: 0.45,
    };

    for (const missingMetric of Object.keys(completeMetrics) as Array<keyof typeof completeMetrics>) {
      const element = document.createElement('div');
      const incompleteMetrics: Partial<typeof completeMetrics> = { ...completeMetrics };
      delete incompleteMetrics[missingMetric];

      renderVoiceGraphDot({ element, metrics: incompleteMetrics });

      expect(element.classList.contains('hidden'), missingMetric).toBe(true);
      expect(element.style.getPropertyValue('--voice-dot-left'), missingMetric).toBe('');
      expect(element.style.getPropertyValue('--voice-dot-top'), missingMetric).toBe('');
    }
  });

  it('hides the dot when any essential metric is non-finite', () => {
    const completeMetrics = {
      meanPitchHz: 190,
      resonanceMean: 0.5,
      weightMean: 0.5,
      targetHitPct: 0.45,
    };

    for (const invalidMetric of Object.keys(completeMetrics) as Array<keyof typeof completeMetrics>) {
      const element = document.createElement('div');
      const invalidMetrics = { ...completeMetrics, [invalidMetric]: Number.NaN };

      renderVoiceGraphDot({ element, metrics: invalidMetrics });

      expect(element.classList.contains('hidden'), invalidMetric).toBe(true);
    }
  });
});
