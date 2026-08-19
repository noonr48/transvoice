type VoiceStandaloneEnv = Record<string, unknown>;

type VoiceStandaloneLocation = Pick<Location, 'href' | 'hostname' | 'origin' | 'pathname' | 'protocol'>;

type VoiceStandaloneWindow = {
  history?: Pick<History, 'replaceState'>;
  location: VoiceStandaloneLocation;
};

export type VoiceTutorStandaloneEntrypoint = {
  enabled: boolean;
  kernelUrl: string | null;
  kernelWsUrl: string | null;
  voiceTrainerUrl: string | null;
  source: 'query' | 'path' | 'env' | null;
  applyEmbeddedWorkspaceMode: () => void;
};

const STANDALONE_QUERY_PARAM = 'sloaneVoiceStandalone';
const EMBEDDED_WORKSPACE_PARAM = 'sloaneEmbeddedWorkspace';
const EMBEDDED_WORKSPACE_MODE_PARAM = 'sloaneMode';
const DEFAULT_STANDALONE_PORT = 3021;

function normalizeUrl(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\/+$/, '')
    : '';
}

function readFirstSearchParam(params: URLSearchParams, names: string[]): string {
  for (const name of names) {
    const value = normalizeUrl(params.get(name));
    if (value) {
      return value;
    }
  }
  return '';
}

function readFirstEnvUrl(env: VoiceStandaloneEnv, names: string[]): string {
  for (const name of names) {
    const value = normalizeUrl(env[name]);
    if (value) {
      return value;
    }
  }
  return '';
}

function isEnabledByEnv(env: VoiceStandaloneEnv): boolean {
  const raw = env.VITE_VOICE_STANDALONE;
  return typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function getUrl(windowRef: VoiceStandaloneWindow): URL | null {
  try {
    return new URL(windowRef.location.href);
  } catch {
    return null;
  }
}

function isVoiceTutorStandalonePath(pathname: string): boolean {
  return /(?:^|\/)voice-tutor(?:\.html|\/)?$/u.test(pathname);
}

function getBrowserHost(windowRef: VoiceStandaloneWindow): string {
  const hostname = normalizeUrl(windowRef.location.hostname);
  return hostname && hostname !== '0.0.0.0' && hostname !== '::'
    ? hostname
    : '127.0.0.1';
}

function getBrowserHttpProtocol(windowRef: VoiceStandaloneWindow): 'http:' | 'https:' {
  return windowRef.location.protocol === 'https:' ? 'https:' : 'http:';
}

function getDefaultStandaloneKernelUrl(windowRef: VoiceStandaloneWindow): string {
  return `${getBrowserHttpProtocol(windowRef)}//${getBrowserHost(windowRef)}:${DEFAULT_STANDALONE_PORT}`;
}

function deriveWebSocketBaseUrl(httpUrl: string): string {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function readStandaloneSource(
  windowRef: VoiceStandaloneWindow,
  env: VoiceStandaloneEnv,
): VoiceTutorStandaloneEntrypoint['source'] {
  const url = getUrl(windowRef);
  if (url?.searchParams.get(STANDALONE_QUERY_PARAM) === '1') {
    return 'query';
  }
  if (isVoiceTutorStandalonePath(windowRef.location.pathname)) {
    return 'path';
  }
  if (isEnabledByEnv(env)) {
    return 'env';
  }
  return null;
}

export function resolveVoiceTutorStandaloneEntrypoint(options: {
  windowRef: VoiceStandaloneWindow;
  env?: VoiceStandaloneEnv;
}): VoiceTutorStandaloneEntrypoint {
  const env = options.env || {};
  const url = getUrl(options.windowRef);
  const source = readStandaloneSource(options.windowRef, env);

  if (!source) {
    return {
      enabled: false,
      kernelUrl: null,
      kernelWsUrl: null,
      voiceTrainerUrl: null,
      source: null,
      applyEmbeddedWorkspaceMode: () => undefined,
    };
  }

  const queryKernelUrl = url
    ? readFirstSearchParam(url.searchParams, ['voiceKernelUrl', 'voiceTutorKernelUrl'])
    : '';
  const envKernelUrl = readFirstEnvUrl(env, ['VITE_VOICE_STANDALONE_API_URL', 'VITE_VOICE_TUTOR_API_URL']);
  const kernelUrl = queryKernelUrl || envKernelUrl || getDefaultStandaloneKernelUrl(options.windowRef);

  const queryKernelWsUrl = url
    ? readFirstSearchParam(url.searchParams, ['voiceKernelWsUrl', 'voiceTutorKernelWsUrl'])
    : '';
  const envKernelWsUrl = readFirstEnvUrl(env, ['VITE_VOICE_STANDALONE_WS_URL', 'VITE_VOICE_TUTOR_WS_URL']);
  const kernelWsUrl = queryKernelWsUrl || envKernelWsUrl || deriveWebSocketBaseUrl(kernelUrl);

  const queryVoiceTrainerUrl = url
    ? readFirstSearchParam(url.searchParams, ['voiceTrainerUrl', 'voiceTutorTrainerUrl'])
    : '';
  const envVoiceTrainerUrl = readFirstEnvUrl(env, ['VITE_VOICE_STANDALONE_TRAINER_URL', 'VITE_VOICE_TRAINER_STANDALONE_URL']);
  const voiceTrainerUrl = queryVoiceTrainerUrl || envVoiceTrainerUrl || `${kernelUrl}/voice-trainer`;

  return {
    enabled: true,
    kernelUrl,
    kernelWsUrl,
    voiceTrainerUrl,
    source,
    applyEmbeddedWorkspaceMode: () => {
      const currentUrl = getUrl(options.windowRef);
      if (!currentUrl) {
        return;
      }
      let changed = false;
      if (currentUrl.searchParams.get(EMBEDDED_WORKSPACE_PARAM) !== '1') {
        currentUrl.searchParams.set(EMBEDDED_WORKSPACE_PARAM, '1');
        changed = true;
      }
      if (currentUrl.searchParams.get(EMBEDDED_WORKSPACE_MODE_PARAM) !== 'voice') {
        currentUrl.searchParams.set(EMBEDDED_WORKSPACE_MODE_PARAM, 'voice');
        changed = true;
      }
      if (currentUrl.searchParams.get(STANDALONE_QUERY_PARAM) !== '1') {
        currentUrl.searchParams.set(STANDALONE_QUERY_PARAM, '1');
        changed = true;
      }
      if (!changed) {
        return;
      }
      options.windowRef.history?.replaceState?.(null, '', currentUrl.toString());
    },
  };
}
