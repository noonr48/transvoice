import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushBackendDiagnostic } from '../runtime-diagnostics';

type TelemetryWindow = Window & {
  __tvTelemetry?: {
    mark: (phase: string) => void;
    event: (...args: unknown[]) => void;
    dispose?: () => void;
  };
  __SLOANE_BACKEND_ERRORS?: unknown[];
};

function getHarnessSource(): string {
  const html = readFileSync(resolve(process.cwd(), 'voice-tutor-app.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const script = parsed.getElementById('tv-telemetry-bootstrap');
  if (!script?.textContent) throw new Error('telemetry bootstrap script missing');
  return script.textContent;
}

function emittedBodies(): Array<Record<string, unknown>> {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe('Voice Tutor pre-bundle telemetry', () => {
  beforeEach(() => {
    (window as TelemetryWindow).__tvTelemetry?.dispose?.();
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined });
    delete (window as TelemetryWindow).__tvTelemetry;
    delete (window as TelemetryWindow).__SLOANE_BACKEND_ERRORS;
    Function(getHarnessSource())();
  });

  afterEach(() => {
    (window as TelemetryWindow).__tvTelemetry?.mark('app-ready');
    (window as TelemetryWindow).__tvTelemetry?.dispose?.();
    vi.useRealTimers();
  });

  it('starts before the bundle and marks a completed boot with categorical payloads', () => {
    (window as TelemetryWindow).__tvTelemetry?.mark('app-ready');
    const bodies = emittedBodies();
    expect(bodies.map((entry) => entry.code)).toEqual(['boot-start', 'boot-ready']);
    expect(bodies.every((entry) => entry.schema === 'transvoice.client_failure.v1')).toBe(true);
    expect(JSON.stringify(bodies)).not.toMatch(/transcript|prompt|session|audio|token/i);
  });

  it('kill-test: uncaught errors and promise rejections emit exact failure classes', () => {
    window.dispatchEvent(new ErrorEvent('error', { lineno: 42, colno: 7, message: 'PRIVATE_MESSAGE' }));
    window.dispatchEvent(new Event('unhandledrejection'));
    const failures = emittedBodies().filter((entry) => entry.level === 'error');
    expect(failures.map((entry) => [entry.seam, entry.class, entry.code])).toEqual([
      ['client-runtime', 'partial-function', 'uncaught-error'],
      ['client-runtime', 'partial-function', 'unhandled-rejection'],
    ]);
    expect(JSON.stringify(failures)).not.toContain('PRIVATE_MESSAGE');
  });

  it('kill-test: an unfinished boot times out and pagehide records boot-skip', () => {
    vi.advanceTimersByTime(15_001);
    window.dispatchEvent(new Event('pagehide'));
    const codes = emittedBodies().map((entry) => entry.code);
    expect(codes).toContain('boot-timeout');
    expect(codes).toContain('boot-incomplete');
    const timeout = emittedBodies().find((entry) => entry.code === 'boot-timeout');
    expect([timeout?.seam, timeout?.class]).toEqual(['client-boot', 'boot-skip']);
  });

  it('caps duplicate failures and emits one suppression witness', () => {
    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(new ErrorEvent('error', { lineno: 3, colno: 2 }));
    }
    const codes = emittedBodies().map((entry) => entry.code);
    expect(codes.filter((code) => code === 'uncaught-error')).toHaveLength(1);
    expect(codes.filter((code) => code === 'uncaught-error.suppressed')).toHaveLength(1);
  });

  it('stitches a visible control activation to its observed DOM effect without copying button text', () => {
    const button = document.createElement('button');
    button.id = 'tv-coach-session-toggle';
    button.textContent = 'PRIVATE BUTTON COPY';
    button.addEventListener('click', () => button.setAttribute('aria-pressed', 'true'));
    document.body.append(button);

    button.click();
    vi.advanceTimersByTime(751);

    const controlEvents = emittedBodies().filter((entry) => entry.seam === 'control');
    expect(controlEvents.map((entry) => entry.code)).toEqual(['control-activated', 'control-observed']);
    expect(controlEvents.map((entry) => entry.data)).toEqual([
      expect.objectContaining({ control: 'tv-coach-session-toggle', attempt: 1, status: 'received' }),
      expect.objectContaining({ control: 'tv-coach-session-toggle', attempt: 1, changed: true, effect: 'state-changed' }),
    ]);
    expect(JSON.stringify(controlEvents)).not.toContain('PRIVATE BUTTON COPY');
  });

  it('stitches semantic listening start to the originating control attempt', () => {
    const button = document.createElement('button');
    button.id = 'tv-coach-session-toggle';
    document.body.append(button);
    button.click();
    window.dispatchEvent(new CustomEvent('tv-control-effect', {
      detail: { control: 'tv-coach-session-toggle', effect: 'listening-started', status: 'succeeded' },
    }));

    const effect = emittedBodies().find((entry) => entry.code === 'control-effect');
    expect(effect?.data).toEqual(expect.objectContaining({
      control: 'tv-coach-session-toggle', attempt: 1, effect: 'listening-started', status: 'succeeded',
    }));
  });

  it('keeps distinct Start and Stop attempts instead of suppressing them by event code', () => {
    const button = document.createElement('button');
    button.id = 'tv-coach-session-toggle';
    document.body.append(button);

    button.click();
    vi.advanceTimersByTime(751);
    button.click();
    vi.advanceTimersByTime(751);
    window.dispatchEvent(new CustomEvent('tv-control-effect', {
      detail: { control: 'tv-coach-session-toggle', effect: 'session-stopped', status: 'succeeded' },
    }));

    const bodies = emittedBodies().filter((entry) => entry.seam === 'control');
    expect(bodies.filter((entry) => entry.code === 'control-activated').map((entry) => entry.data)).toEqual([
      expect.objectContaining({ attempt: 1 }),
      expect.objectContaining({ attempt: 2 }),
    ]);
    expect(bodies.some((entry) => String(entry.code).endsWith('.suppressed'))).toBe(false);
    expect(bodies.find((entry) => entry.code === 'control-effect')?.data).toEqual(expect.objectContaining({
      attempt: 2,
      effect: 'session-stopped',
    }));
  });

  it('stitches preset selection semantics with a nonzero attempt', () => {
    const button = document.createElement('button');
    button.id = 'tv-coach-preset-button';
    document.body.append(button);
    button.click();
    window.dispatchEvent(new CustomEvent('tv-control-effect', {
      detail: { control: 'tv-coach-preset-button', effect: 'preset-selected', status: 'succeeded' },
    }));
    const effects = emittedBodies().filter((entry) => entry.code === 'control-effect');
    expect(effects.at(-1)?.data).toEqual(expect.objectContaining({
      control: 'tv-coach-preset-button', attempt: 1, effect: 'preset-selected',
    }));
  });

  it('bridges existing backend diagnostics into the remote failure bus without message content', () => {
    const event = vi.fn();
    (window as TelemetryWindow).__tvTelemetry = { mark: vi.fn(), event };
    pushBackendDiagnostic({
      operation: 'Voice API request',
      message: 'PRIVATE_BACKEND_MESSAGE',
      source: 'https://voice.invalid/private',
      method: 'GET',
      status: 503,
      attribution: { category: 'http', label: 'HTTP' },
    });
    expect(event).toHaveBeenCalledWith(
      'error',
      'voice-api',
      'partial-function',
      'backend-http',
      { status: 503 },
    );
    expect(JSON.stringify(event.mock.calls)).not.toContain('PRIVATE_BACKEND_MESSAGE');
  });
});
