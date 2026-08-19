export function createVoiceAudioContext(): AudioContext {
  const globalAny = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = globalAny.AudioContext || globalAny.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext is unavailable in this environment.');
  }
  return new AudioContextCtor();
}

