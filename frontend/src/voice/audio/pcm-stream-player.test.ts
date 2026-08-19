import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createPcmStreamPlayer } from './pcm-stream-player';

const DEPLOYED_WORKLET_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/worklets/pcm-stream-player.worklet.js'),
  'utf8',
);

function createWorkletHarness() {
  const posted: Array<{ type?: string; buffer?: Float32Array }> = [];
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((message: { type?: string; buffer?: Float32Array }) => {
      posted.push(message);
    }),
  };
  const node = {
    port,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioWorkletNode;
  const context = {
    state: 'running',
    destination: {},
    close: vi.fn(),
    resume: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
  } as unknown as AudioContext;
  return { posted, port, node, context };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('PCM stream backpressure', () => {
  it('preserves source duration when the Android audio context runs at a higher sample rate', async () => {
    const harness = createWorkletHarness();
    Object.defineProperty(harness.context, 'sampleRate', { value: 96_000 });
    const player = createPcmStreamPlayer({
      audioContext: harness.context,
      ringBufferSamples: 4_800,
      createWorkletNode: () => harness.node,
    });
    const sourceSamples = 480;
    const response = new Response(new Uint8Array(sourceSamples * 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await player.play(response);

    const queuedSamples = harness.posted
      .filter((message) => message.type === 'push')
      .reduce((total, message) => total + (message.buffer?.length || 0), 0);
    expect(queuedSamples).toBeGreaterThanOrEqual((sourceSamples * 2) - 2);
    expect(queuedSamples).toBeLessThanOrEqual(sourceSamples * 2);
    expect(player.getState()).toMatchObject({
      sampleRate: 48_000,
      playbackSampleRate: 96_000,
      totalSamplesQueued: queuedSamples,
    });
  });

  it('preserves playback accounting after the browser detaches transferred audio buffers', async () => {
    const transferredTypes: string[] = [];
    let transferredSamples = 0;
    const port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: vi.fn((
        message: { type?: string; buffer?: Float32Array },
        transfer: Transferable[] = [],
      ) => {
        transferredTypes.push(message.type || '');
        if (message.type === 'push' && message.buffer) {
          transferredSamples += message.buffer.length;
          structuredClone(message, { transfer });
        }
      }),
    };
    const node = {
      port,
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as AudioWorkletNode;
    const context = {
      state: 'running',
      sampleRate: 48_000,
      destination: {},
      close: vi.fn(),
      resume: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
    } as unknown as AudioContext;
    const player = createPcmStreamPlayer({
      audioContext: context,
      ringBufferSamples: 4_800,
      createWorkletNode: () => node,
    });
    const sourceSamples = 2_400;
    const response = new Response(new Uint8Array(sourceSamples * 2), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await player.play(response);

    expect(transferredTypes).toEqual(['reset', 'push', 'end']);
    expect(transferredSamples).toBe(sourceSamples);
    expect(player.getState().totalSamplesQueued).toBe(sourceSamples);
  });

  it('fails closed instead of acknowledging a successful empty PCM response', async () => {
    const harness = createWorkletHarness();
    const player = createPcmStreamPlayer({
      audioContext: harness.context,
      createWorkletNode: () => harness.node,
    });
    const failed = vi.fn();
    player.on('failed', failed);
    const response = new Response(new Uint8Array(), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await expect(player.play(response)).rejects.toThrow(/no audio samples/i);
    expect(failed).toHaveBeenCalledOnce();
    expect(harness.posted.some((message) => message.type === 'end')).toBe(false);
  });

  it('never posts more audio than the worklet can hold and resumes after consumption', async () => {
    const harness = createWorkletHarness();
    const player = createPcmStreamPlayer({
      audioContext: harness.context,
      ringBufferSamples: 4_800,
      createWorkletNode: () => harness.node,
    });
    const sampleCount = 7_200;
    const body = new Uint8Array(sampleCount * 2);
    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    const play = player.play(response);
    await vi.waitFor(() => {
      expect(harness.posted.filter((message) => message.type === 'push')).toHaveLength(2);
    });
    expect(harness.posted
      .filter((message) => message.type === 'push')
      .reduce((total, message) => total + (message.buffer?.length || 0), 0)).toBe(4_800);

    harness.port.onmessage?.({ data: { type: 'consumed', count: 2_400 } } as MessageEvent);
    await play;

    const pushes = harness.posted.filter((message) => message.type === 'push');
    expect(pushes).toHaveLength(3);
    expect(pushes.reduce((total, message) => total + (message.buffer?.length || 0), 0)).toBe(sampleCount);
    expect(harness.posted.at(-1)?.type).toBe('end');
  });

  it('settles and releases the audio device when aborted while capacity-blocked', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const harness = createWorkletHarness();
      const player = createPcmStreamPlayer({
        audioContext: harness.context,
        ringBufferSamples: 4_800,
        createWorkletNode: () => harness.node,
      });
      const response = new Response(new Uint8Array(7_200 * 2), {
        status: 200,
        headers: {
          'X-Audio-Format': 'pcm_s16le',
          'X-Audio-Sample-Rate': '48000',
          'X-Audio-Channels': '1',
        },
      });

      const play = player.play(response);
      await vi.waitFor(() => {
        expect(harness.posted.filter((message) => message.type === 'push')).toHaveLength(2);
      });
      player.abort();

      await expect(play).rejects.toMatchObject({ name: 'AbortError' });
      player.dispose();
      expect(harness.context.close).toHaveBeenCalledOnce();
      expect(harness.posted.some((message) => message.type === 'end')).toBe(false);
    }
  });

  it('fails within a bound when a running worklet never consumes queued audio', async () => {
    const harness = createWorkletHarness();
    const player = createPcmStreamPlayer({
      audioContext: harness.context,
      ringBufferSamples: 4_800,
      capacityWaitTimeoutMs: 25,
      createWorkletNode: () => harness.node,
    });
    const failed = vi.fn();
    player.on('failed', failed);
    const response = new Response(new Uint8Array(7_200 * 2), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await expect(player.play(response)).rejects.toThrow(/stalled/i);
    expect(failed).toHaveBeenCalledOnce();
    player.dispose();
    expect(harness.context.close).toHaveBeenCalledOnce();
  });

  it('fails immediately when the browser refuses to resume its audio device', async () => {
    const resumeError = new Error('gesture rejected');
    const context = {
      state: 'suspended',
      destination: {},
      close: vi.fn(),
      resume: vi.fn(async () => { throw resumeError; }),
      addEventListener: vi.fn(),
    } as unknown as AudioContext;
    const player = createPcmStreamPlayer({
      audioContext: context,
      createWorkletNode: () => createWorkletHarness().node,
    });
    const response = new Response(new Uint8Array(9_600 * 2), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await expect(player.play(response)).rejects.toThrow(/could not resume.*gesture rejected/i);
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('lets End interrupt a pending audio-device resume and releases the context', async () => {
    const resume = createDeferred<void>();
    const createWorkletNode = vi.fn(() => createWorkletHarness().node);
    const context = {
      state: 'suspended',
      destination: {},
      close: vi.fn(),
      resume: vi.fn(() => resume.promise),
      addEventListener: vi.fn(),
    } as unknown as AudioContext;
    const player = createPcmStreamPlayer({ audioContext: context, createWorkletNode });
    const controller = new AbortController();
    const response = new Response(new Uint8Array(96 * 2), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    const play = player.play(response, { signal: controller.signal });
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledOnce());
    controller.abort();

    await expect(play).rejects.toMatchObject({ name: 'AbortError' });
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(createWorkletNode).not.toHaveBeenCalled();
  });

  it('bounds a pending audio-device resume when no cancellation arrives', async () => {
    const resume = createDeferred<void>();
    const context = {
      state: 'suspended',
      destination: {},
      close: vi.fn(),
      resume: vi.fn(() => resume.promise),
      addEventListener: vi.fn(),
    } as unknown as AudioContext;
    const player = createPcmStreamPlayer({
      audioContext: context,
      resumeWaitTimeoutMs: 25,
      createWorkletNode: () => createWorkletHarness().node,
    });
    const response = new Response(new Uint8Array(96 * 2), {
      status: 200,
      headers: {
        'X-Audio-Format': 'pcm_s16le',
        'X-Audio-Sample-Rate': '48000',
        'X-Audio-Channels': '1',
      },
    });

    await expect(player.play(response)).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringMatching(/stalled while resuming/i),
    });
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('the deployed worklet reports consumption and renders the final sample before ending', () => {
    type ProcessorInstance = {
      port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
      };
      process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
    };
    type ProcessorConstructor = new (options: unknown) => ProcessorInstance;
    let Processor: ProcessorConstructor | null = null;

    class FakeAudioWorkletProcessor {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
      };
    }

    const evaluate = new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      DEPLOYED_WORKLET_SOURCE,
    );
    evaluate(
      FakeAudioWorkletProcessor,
      (name: string, constructor: ProcessorConstructor) => {
        expect(name).toBe('sloane-pcm-stream-player');
        Processor = constructor;
      },
      48_000,
    );
    expect(Processor).not.toBeNull();
    const processor = new (Processor as unknown as ProcessorConstructor)({
      processorOptions: { ringBufferSamples: 256 },
    });
    const samples = Float32Array.from({ length: 256 }, (_, index) => index / 256);
    processor.port.onmessage?.({ data: { type: 'push', buffer: samples } });
    processor.port.onmessage?.({ data: { type: 'end' } });

    const first = new Float32Array(128);
    const second = new Float32Array(128);
    expect(processor.process([], [[first]])).toBe(true);
    expect(processor.process([], [[second]])).toBe(false);
    expect(first).toEqual(samples.subarray(0, 128));
    expect(second).toEqual(samples.subarray(128));
    expect(second.at(-1)).toBe(samples.at(-1));
    const consumed = processor.port.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'consumed')
      .reduce((total, message) => total + message.count, 0);
    expect(consumed).toBe(samples.length);
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'ended' });
  });

  it('the deployed worklet refuses overflow instead of silently overwriting speech', () => {
    type ProcessorInstance = {
      port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
      };
    };
    type ProcessorConstructor = new (options: unknown) => ProcessorInstance;
    let Processor: ProcessorConstructor | null = null;
    class FakeAudioWorkletProcessor {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
      };
    }
    new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      DEPLOYED_WORKLET_SOURCE,
    )(
      FakeAudioWorkletProcessor,
      (_name: string, constructor: ProcessorConstructor) => { Processor = constructor; },
      48_000,
    );
    const processor = new (Processor as unknown as ProcessorConstructor)({
      processorOptions: { ringBufferSamples: 128 },
    });
    processor.port.onmessage?.({
      data: { type: 'push', buffer: new Float32Array(129) },
    });
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: 'overflow',
      attemptedSamples: 129,
      availableSamples: 128,
    });
  });

  it('the deployed worklet explicitly reports cancellation before it exits', () => {
    type ProcessorInstance = {
      port: {
        onmessage: ((event: { data: unknown }) => void) | null;
        postMessage: ReturnType<typeof vi.fn>;
      };
      process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
    };
    type ProcessorConstructor = new (options: unknown) => ProcessorInstance;
    let Processor: ProcessorConstructor | null = null;
    class FakeAudioWorkletProcessor {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
      };
    }
    new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      DEPLOYED_WORKLET_SOURCE,
    )(
      FakeAudioWorkletProcessor,
      (_name: string, constructor: ProcessorConstructor) => { Processor = constructor; },
      48_000,
    );
    const processor = new (Processor as unknown as ProcessorConstructor)({
      processorOptions: { ringBufferSamples: 128 },
    });

    processor.port.onmessage?.({ data: { type: 'stop' } });

    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'stopped' });
    expect(processor.process([], [[new Float32Array(128)]])).toBe(false);
  });
});
