/**
 * SLOANE OS — Centralized Configuration
 *
 * Single source of truth for all service URLs, API keys, and shared constants.
 * All other files should require() this instead of reading process.env directly.
 */

const os = require('os');
const path = require('path');

const DEFAULT_GLM_API_URL = 'https://api.z.ai/api/coding/paas/v4';
const DEFAULT_SOLANE_ROOT = path.resolve(__dirname, '../..');
const GLM_STANDARD_API_PATH_PATTERN = /^\/api\/paas\/v4\/?$/i;
const GLM_CODING_API_PATH = '/api/coding/paas/v4';

function parsePathList(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const DEFAULT_CORS_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

function resolveCorsConfig(env = process.env) {
  const raw = typeof env.CORS_ALLOWED_ORIGINS === 'string'
    ? env.CORS_ALLOWED_ORIGINS.trim()
    : '';
  if (raw === '*') {
    return { allowAll: true, allowedOrigins: [], usesDefaultAllowedOrigins: false };
  }
  const allowedOrigins = parsePathList(raw);
  return {
    allowAll: false,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_CORS_ALLOWED_ORIGINS.slice(),
    usesDefaultAllowedOrigins: allowedOrigins.length === 0,
  };
}

function resolveTrustProxySetting(env = process.env) {
  const rawValue = typeof env.SLOANE_TRUST_PROXY === 'string' && env.SLOANE_TRUST_PROXY.trim()
    ? env.SLOANE_TRUST_PROXY.trim()
    : typeof env.TRUST_PROXY === 'string' && env.TRUST_PROXY.trim()
      ? env.TRUST_PROXY.trim()
      : '';

  if (!rawValue) {
    return 'loopback';
  }

  if (/^\d+$/.test(rawValue)) {
    return Number(rawValue);
  }

  const normalized = rawValue.toLowerCase();
  if (['true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'off', 'disabled', 'none'].includes(normalized)) {
    return false;
  }

  const entries = parsePathList(rawValue);
  return entries.length > 1 ? entries : rawValue;
}

function readPathOverride(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeGlmApiUrl(value) {
  const raw = readPathOverride(value) || DEFAULT_GLM_API_URL;

  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() === 'api.z.ai' && GLM_STANDARD_API_PATH_PATTERN.test(url.pathname)) {
      url.pathname = GLM_CODING_API_PATH;
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    }
    return raw.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function parseFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseTruthyFlag(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

function parseBooleanFlag(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseObjectMemoryRetrievalMode(value, fallback = 'shadow') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['shadow', 'canary', 'primary'].includes(normalized) ? normalized : fallback;
}

function parseClampedPositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

function parseClampedNonNegativeInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

function isGlmEnabled(env = process.env) {
  return parseTruthyFlag(env.GLM_MODELS_ENABLED || env.SLOANE_ENABLE_GLM_MODELS);
}

function getPathConfig(env = process.env, options = {}) {
  const homeDir = readPathOverride(options.homeDir)
    || readPathOverride(env.HOME)
    || os.homedir()
    || '/tmp';
  const solaneRoot = readPathOverride(options.solaneRoot)
    || readPathOverride(env.SOLANE_ROOT)
    || DEFAULT_SOLANE_ROOT;
  const sloaneLocalPath = readPathOverride(env.SLOANE_LOCAL_ROOT)
    || path.join(solaneRoot, 'sloane-local');
  const stateRoot = readPathOverride(env.SLOANE_STATE_ROOT)
    || path.join(homeDir, '.local', 'share', 'sloane');
  const localSearchRepoRoot = readPathOverride(env.LOCAL_SEARCH_MCP_REPO_ROOT)
    || path.resolve(solaneRoot, '../../local-search-mcp');
  const localSearchDistPath = readPathOverride(env.LOCAL_SEARCH_MCP_DIST_PATH)
    || path.join(localSearchRepoRoot, 'dist');
  const vaultAppRoot = readPathOverride(env.VAULT_APP_ROOT)
    || path.join(solaneRoot, 'vault-app');

  return {
    HOME: homeDir,
    SOLANE_ROOT: solaneRoot,
    VAULT_APP_ROOT: vaultAppRoot,
    SLOANE_LOCAL_PATH: sloaneLocalPath,
    STATE_ROOT: stateRoot,
    TASKS_PATH: readPathOverride(env.SLOANE_TASKS_PATH) || path.join(stateRoot, 'tasks.json'),
    EVENTS_PATH: readPathOverride(env.SLOANE_EVENTS_PATH) || path.join(stateRoot, 'events.jsonl'),
    AUTORESEARCH_STORE_PATH: readPathOverride(env.AUTORESEARCH_STORE_PATH) || path.join(stateRoot, 'auto-research.json'),
    MODEL_REGISTRY_PATH: readPathOverride(env.SLOANE_MODEL_REGISTRY_PATH) || path.join(sloaneLocalPath, 'model-registry.json'),
    MODEL_VISION_OVERRIDES_PATH: readPathOverride(env.MODEL_VISION_OVERRIDES_PATH) || path.join(sloaneLocalPath, 'model-vision-overrides.json'),
    AGENT_PREFS_PATH: readPathOverride(env.SLOANE_AGENT_PREFS_PATH)
      || readPathOverride(env.AGENT_PREFS_PATH)
      || path.join(sloaneLocalPath, 'agent-prefs.json'),
    CANVAS_BUS_STATE_PATH: readPathOverride(env.CANVAS_BUS_STATE_PATH) || path.join(stateRoot, 'canvas-bus-state'),
    IMAGE_STUDIO_STATE_PATH: readPathOverride(env.IMAGE_STUDIO_STATE_PATH) || path.join(stateRoot, 'image-studio-state'),
    LEARNER_CONTEXT_STATE_PATH: readPathOverride(env.SLOANE_LEARNER_CONTEXT_PATH)
      || readPathOverride(env.LEARNER_CONTEXT_STATE_PATH)
      || path.join(stateRoot, 'learner-context'),
    GENERAL_KNOWLEDGE_ROOT: readPathOverride(env.GENERAL_KNOWLEDGE_ROOT) || path.join(sloaneLocalPath, 'general-knowledge'),
    SUBJECT_SOURCE_ROOT: readPathOverride(env.SLOANE_SUBJECT_SOURCE_ROOT)
      || readPathOverride(env.SUBJECT_SOURCE_ROOT)
      || path.join(sloaneLocalPath, 'subject-sources'),
    SUBJECT_WIKI_ROOT: readPathOverride(env.SLOANE_SUBJECT_WIKI_ROOT)
      || readPathOverride(env.SUBJECT_WIKI_ROOT)
      || path.join(sloaneLocalPath, 'subject-wiki'),
    LOCAL_SEARCH_MCP_REPO_ROOT: localSearchRepoRoot,
    LOCAL_SEARCH_MCP_DIST_PATH: localSearchDistPath,
    VOCECHAT_ARCHIVE_PATH: readPathOverride(env.VOCECHAT_ARCHIVE_PATH)
      || path.resolve(solaneRoot, '../VoceChat/archive_msgs'),
    VOCECHAT_EXPORT_PATH: readPathOverride(env.VOCECHAT_EXPORT_PATH)
      || path.join(solaneRoot, 'sloane-ui', 'backend', 'vocechat-export'),
    WORKSPACE_ROOT: readPathOverride(env.SLOANE_WORKSPACE_ROOT)
      || readPathOverride(env.WORKSPACE_ROOT)
      || homeDir,
    MANAGED_SLOANE_UNIT_PATH: path.join(homeDir, '.config/systemd/user/sloane.service'),
  };
}

function getGlmConfig(env = process.env) {
  if (!isGlmEnabled(env)) {
    return {
      enabled: false,
      apiUrl: '',
      baseUrl: '',
      apiKey: '',
      proxyUrl: '',
      proxyHosts: [],
    };
  }

  const apiUrl = normalizeGlmApiUrl(
    env.GLM_API_BASE_URL
      || env.GLM_API_BASE
      || env.GLM_API_URL
      || env.ZAI_BASE_URL
      || env.Z_AI_BASE_URL
      || env.ZAI_API_BASE
      || env.Z_AI_API_BASE
      || DEFAULT_GLM_API_URL,
  );
  const apiKey = env.GLM_API_KEY || env.Z_AI_API_KEY || env.ZAI_API_KEY || '';
  const proxyUrl = readPathOverride(env.GLM_PROXY_URL)
    || readPathOverride(env.Z_AI_PROXY_URL)
    || readPathOverride(env.ZAI_PROXY_URL);
  const proxyHosts = parsePathList(env.GLM_PROXY_HOSTS || env.Z_AI_PROXY_HOSTS || env.ZAI_PROXY_HOSTS || 'api.z.ai');
  return {
    enabled: true,
    apiUrl,
    baseUrl: apiUrl,
    apiKey,
    proxyUrl,
    proxyHosts,
  };
}

function isGlmModel(modelId) {
  return typeof modelId === 'string' && /^glm-/i.test(modelId.trim());
}

const glmConfig = getGlmConfig();
const pathConfig = getPathConfig(process.env);
const corsConfig = resolveCorsConfig(process.env);
const trustProxySetting = resolveTrustProxySetting(process.env);
const userHomeDir = pathConfig.HOME;
const solaneRoot = pathConfig.SOLANE_ROOT;
const {
  assertLegacyRagflowAllowed,
} = require('./legacy-ragflow-runtime-guard');
const defaultAllowedPaths = [
  path.join(userHomeDir, 'Desktop'),
  path.join(userHomeDir, 'Documents'),
  path.join(userHomeDir, 'Downloads'),
];
const configuredAllowedPaths = parsePathList(process.env.ALLOWED_PATHS);

const config = {
  // ═══════════════════════════════════════════════════════════════
  // Server
  // ═══════════════════════════════════════════════════════════════
  HOST: process.env.HOST || '127.0.0.1',
  PORT: Number(process.env.PORT || 3001),
  ADMIN_TOKEN: String(process.env.SLOANE_ADMIN_TOKEN || '').trim(),
  MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '50mb',
  TRUST_PROXY: trustProxySetting,
  CORS_ALLOW_ALL_ORIGINS: corsConfig.allowAll,
  CORS_ALLOWED_ORIGINS: corsConfig.allowedOrigins,
  CORS_USES_DEFAULT_ALLOWED_ORIGINS: corsConfig.usesDefaultAllowedOrigins,

  // Legacy document/vector services are retired. Keep these inert even if
  // stale environment files still contain old endpoints or tokens.
  RAGFLOW_URL: '',
  RAGFLOW_API_KEY: '',
  RAG_API_URL: '',
  RAG_API_KEY: '',
  RAG_API_AUTH_MODE: process.env.RAG_API_AUTH_MODE || 'x-api-key',
  USE_RAG_API: false,
  SLOANE_OBJECT_MEMORY_RETRIEVAL_MODE: parseObjectMemoryRetrievalMode(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_MODE,
    'primary',
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_CANARY_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_CANARY_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_PRIMARY_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_PRIMARY_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_PROMOTION_GATE_PATH: String(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_PROMOTION_GATE_PATH
      || process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_PROMOTION_GATE
      || '',
  ).trim(),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_PROJECT: String(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_PROJECT || 'sloane-os-general',
  ).trim() || 'sloane-os-general',
  SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_LANES: String(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_LANES || 'document_chunks',
  ).trim() || 'document_chunks',
  SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_TOP_K: parseClampedPositiveInteger(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_TOP_K,
    5,
    1,
    25,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_TIMEOUT_MS: parseClampedPositiveInteger(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_SHADOW_TIMEOUT_MS,
    1500,
    1,
    30000,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_FTS_PRESELECT_LIMIT: parseClampedNonNegativeInteger(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_FTS_PRESELECT_LIMIT,
    1000,
    0,
    5000,
  ),
  SLOANE_OBJECT_MEMORY_RETRIEVAL_FTS_PRESELECT_FALLBACK_FULL_SCAN: parseBooleanFlag(
    process.env.SLOANE_OBJECT_MEMORY_RETRIEVAL_FTS_PRESELECT_FALLBACK_FULL_SCAN,
    false,
  ),
  SLOANE_OBJECT_MEMORY_DUAL_WRITE_ATTACHMENTS_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_DUAL_WRITE_ATTACHMENTS_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_DUAL_WRITE_KNOWLEDGE_INGESTION_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_DUAL_WRITE_KNOWLEDGE_INGESTION_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_ONLY_KNOWLEDGE_INGESTION_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_ONLY_KNOWLEDGE_INGESTION_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_DUAL_WRITE_INDEX_DOCUMENTS_ENABLED: parseTruthyFlag(
    process.env.SLOANE_OBJECT_MEMORY_DUAL_WRITE_INDEX_DOCUMENTS_ENABLED,
  ),
  SLOANE_OBJECT_MEMORY_DUAL_WRITE_PROJECT: String(
    process.env.SLOANE_OBJECT_MEMORY_DUAL_WRITE_PROJECT || 'sloane-os-general',
  ).trim() || 'sloane-os-general',

  // Sloane's self-managed knowledge base
  SLOANE_AGENT_KB_ID: process.env.SLOANE_AGENT_KB_ID || '',

  // Highlights / personal feed ingestion (YouTube + saved pages)
  HIGHLIGHTS_DATASET_ID: String(
    process.env.HIGHLIGHTS_DATASET_ID
      || process.env.AI_SEARCH_HIGHLIGHTS_DATASET_ID
      || ''
  ).trim(),
  HIGHLIGHTS_DEFAULT_TITLE: process.env.HIGHLIGHTS_DEFAULT_TITLE || 'Highlights',
  HIGHLIGHTS_MAX_KEYFRAMES: Number(process.env.HIGHLIGHTS_MAX_KEYFRAMES || 10),

  // ═══════════════════════════════════════════════════════════════
  // SimpleMem — session memory
  // ═══════════════════════════════════════════════════════════════
  SIMPLEMEM_URL: process.env.SIMPLEMEM_URL || process.env.CROSS_MEM_URL || 'http://127.0.0.1:3500',
  SIMPLEMEM_API_KEY: String(
    process.env.SIMPLEMEM_API_KEY
      || process.env.SIMPLEMEM_CROSS_API_KEY
      || process.env.CROSS_MEM_API_KEY
      || ''
  ).trim(),
  SIMPLEMEM_TENANT_ID: String(
    process.env.SIMPLEMEM_TENANT_ID
      || process.env.SLOANE_MEMORY_TENANT_ID
      || 'sloane-user'
  ).trim() || 'sloane-user',

  // ═══════════════════════════════════════════════════════════════
  // Infinity — Embeddings and reranking
  // ═══════════════════════════════════════════════════════════════
  INFINITY_URL: process.env.INFINITY_URL || 'http://localhost:7997',
  SLOANE_EMBEDDING_URL: process.env.SLOANE_EMBEDDING_URL
    || process.env.SLOANE_REMOTE_EMBEDDING_URL
    || process.env.INFINITY_EMBEDDING_URL
    || process.env.INFINITY_URL
    || 'http://localhost:7997',
  SLOANE_RERANK_URL: process.env.SLOANE_RERANK_URL
    || process.env.SLOANE_REMOTE_RERANK_URL
    || process.env.INFINITY_RERANK_URL
    || process.env.INFINITY_URL
    || 'http://localhost:7997',
  SLOANE_RERANK_MODEL: process.env.SLOANE_RERANK_MODEL
    || process.env.RERANK_MODEL
    || 'jinaai/jina-reranker-v2-base-multilingual',
  SLOANE_OBJECT_MEMORY_OCR_URL: process.env.SLOANE_OBJECT_MEMORY_OCR_URL
    || process.env.SLOANE_REMOTE_OCR_URL
    || '',

  // ═══════════════════════════════════════════════════════════════
  // LLM — optional GLM / Z.AI API
  // ═══════════════════════════════════════════════════════════════
  GLM_MODELS_ENABLED: glmConfig.enabled,
  GLM_API_URL: glmConfig.apiUrl,
  GLM_API_KEY: glmConfig.apiKey,
  GLM_PROXY_URL: glmConfig.proxyUrl,
  GLM_PROXY_HOSTS: glmConfig.proxyHosts,

  // ═══════════════════════════════════════════════════════════════
  // OpenAI
  // ═══════════════════════════════════════════════════════════════
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  OPENAI_API_KEY: String(process.env.OPENAI_API_KEY || '').trim(),
  OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5',

  // ═══════════════════════════════════════════════════════════════
  // Vision — Image analysis
  // ═══════════════════════════════════════════════════════════════
  VISION_MODEL: process.env.VISION_MODEL || 'models/gemini-3.1-flash-lite',
  LOCAL_VISION_WORKER_URL: process.env.LOCAL_VISION_WORKER_URL || 'http://localhost:3460',
  LOCAL_VISION_ENABLED: String(process.env.LOCAL_VISION_ENABLED || 'false').toLowerCase() !== 'false',

  // ═══════════════════════════════════════════════════════════════
  // DeepTutor
  // ═══════════════════════════════════════════════════════════════
  DEEPTUTOR_URL: process.env.DEEPTUTOR_URL || 'http://localhost:8001',

  // ═══════════════════════════════════════════════════════════════
  // VoxCPM / Nano-vLLM
  // ═══════════════════════════════════════════════════════════════
  VOXCPM_ENABLED: String(process.env.VOXCPM_ENABLED || 'false').toLowerCase() !== 'false',
  VOXCPM_URL: process.env.VOXCPM_URL || process.env.NANOVLLM_VOXCPM_URL || 'http://localhost:8020',
  VOXCPM_MODEL: process.env.VOXCPM_MODEL || 'openbmb/VoxCPM2',
  VOXCPM_TIMEOUT_MS: Number(process.env.VOXCPM_TIMEOUT_MS || 30000),

  // ═══════════════════════════════════════════════════════════════
  // Voice Input / ASR / VAD
  // ═══════════════════════════════════════════════════════════════
  VOICE_ASR_ENABLED: String(process.env.VOICE_ASR_ENABLED || 'false').toLowerCase() !== 'false',
  VOICE_ASR_URL: process.env.VOICE_ASR_URL || process.env.SENSEVOICE_URL || 'http://localhost:8766',
  VOICE_ASR_MODEL: process.env.VOICE_ASR_MODEL || '',
  VOICE_ASR_API_STYLE: process.env.VOICE_ASR_API_STYLE || 'auto',
  VOICE_ASR_LANGUAGE: process.env.VOICE_ASR_LANGUAGE || 'auto',
  VOICE_ASR_TIMEOUT_MS: Number(process.env.VOICE_ASR_TIMEOUT_MS || 10000),
  VOICE_ASR_LIVE_MODE: process.env.VOICE_ASR_LIVE_MODE || 'buffered',
  VOICE_ASR_LIVE_WS_URL: process.env.VOICE_ASR_LIVE_WS_URL || '',
  VOICE_ASR_LIVE_WS_PROTOCOL: process.env.VOICE_ASR_LIVE_WS_PROTOCOL || 'json',
  VOICE_ASR_CUSTOM_RMS_THRESHOLD: Number(process.env.VOICE_ASR_CUSTOM_RMS_THRESHOLD || 0.018),
  VOICE_ASR_CUSTOM_SILENCE_HOLD_MS: Number(process.env.VOICE_ASR_CUSTOM_SILENCE_HOLD_MS || 900),
  VOICE_ASR_CUSTOM_MIN_SPEECH_MS: Number(process.env.VOICE_ASR_CUSTOM_MIN_SPEECH_MS || 350),
  VOICE_ASR_CUSTOM_PARTIAL_INTERVAL_MS: Number(process.env.VOICE_ASR_CUSTOM_PARTIAL_INTERVAL_MS || 1200),
  VOICE_VAD_ENABLED: String(process.env.VOICE_VAD_ENABLED || 'false').toLowerCase() !== 'false',
  VOICE_VAD_STRATEGY: process.env.VOICE_VAD_STRATEGY || 'auto',
  VOICE_INPUT_LIVE_BEARER_TOKEN: String(process.env.VOICE_INPUT_LIVE_BEARER_TOKEN || '').trim(),
  VOICE_LEGACY_STUDENT_MODEL_BRIDGE_ENABLED: parseBooleanFlag(
    process.env.VOICE_LEGACY_STUDENT_MODEL_BRIDGE_ENABLED,
    true,
  ),

  // ═══════════════════════════════════════════════════════════════
  // Paths
  // ═══════════════════════════════════════════════════════════════
  SOLANE_ROOT: solaneRoot,
  SLOANE_LOCAL_PATH: pathConfig.SLOANE_LOCAL_PATH,
  STATE_ROOT: pathConfig.STATE_ROOT,
  SUBJECTS_PATH: process.env.SUBJECTS_PATH || path.join(solaneRoot, 'subjects'),
  SKILLS_PATH: process.env.SKILLS_PATH || path.join(pathConfig.SLOANE_LOCAL_PATH, 'skills'),
  MCP_CONFIG_PATH: process.env.MCP_CONFIG_PATH || path.join(pathConfig.SLOANE_LOCAL_PATH, 'mcp-config.json'),
  AGENTS_PATH: process.env.AGENTS_PATH || path.join(pathConfig.SLOANE_LOCAL_PATH, 'agents.json'),
  UNI_SUBJECTS_CONFIG_PATH: process.env.UNI_SUBJECTS_CONFIG_PATH || path.join(pathConfig.SLOANE_LOCAL_PATH, 'uni-subjects.json'),
  DATA_IMPORT_DIR: process.env.DATA_IMPORT_DIR || path.join(pathConfig.SLOANE_LOCAL_PATH, 'imported-data'),
  TASKS_PATH: pathConfig.TASKS_PATH,
  EVENTS_PATH: pathConfig.EVENTS_PATH,
  AUTORESEARCH_STORE_PATH: pathConfig.AUTORESEARCH_STORE_PATH,
  MODEL_REGISTRY_PATH: pathConfig.MODEL_REGISTRY_PATH,
  MODEL_VISION_OVERRIDES_PATH: pathConfig.MODEL_VISION_OVERRIDES_PATH,
  AGENT_PREFS_PATH: pathConfig.AGENT_PREFS_PATH,
	  IMAGE_STUDIO_STATE_PATH: pathConfig.IMAGE_STUDIO_STATE_PATH,
	  CANVAS_BUS_STATE_PATH: pathConfig.CANVAS_BUS_STATE_PATH,
	  LEARNER_CONTEXT_STATE_PATH: pathConfig.LEARNER_CONTEXT_STATE_PATH,
	  GENERAL_KNOWLEDGE_ROOT: pathConfig.GENERAL_KNOWLEDGE_ROOT,
  SUBJECT_SOURCE_ROOT: pathConfig.SUBJECT_SOURCE_ROOT,
  SUBJECT_WIKI_ROOT: pathConfig.SUBJECT_WIKI_ROOT,
  LOCAL_SEARCH_MCP_REPO_ROOT: pathConfig.LOCAL_SEARCH_MCP_REPO_ROOT,
  LOCAL_SEARCH_MCP_DIST_PATH: pathConfig.LOCAL_SEARCH_MCP_DIST_PATH,
  VOCECHAT_ARCHIVE_PATH: pathConfig.VOCECHAT_ARCHIVE_PATH,
  VOCECHAT_EXPORT_PATH: pathConfig.VOCECHAT_EXPORT_PATH,
  WORKSPACE_ROOT: pathConfig.WORKSPACE_ROOT,
  ALLOWED_PATHS: configuredAllowedPaths.length > 0 ? configuredAllowedPaths : defaultAllowedPaths,
  LESSON_PROJECT_PATH: process.env.LESSON_PROJECT_PATH || solaneRoot,
  VAULT_APP_ROOT: pathConfig.VAULT_APP_ROOT,
  VAULT_FILES_PATH: process.env.VAULT_FILES_PATH || path.join(solaneRoot, 'vault-app/files'),
  SESSION_ATTACHMENTS_PATH: process.env.SESSION_ATTACHMENTS_PATH || path.join(pathConfig.SLOANE_LOCAL_PATH, 'session-attachments'),
  SESSION_ATTACHMENTS_PRUNE_TTL_DAYS: Math.max(
    0,
    parseFiniteNumber(process.env.SESSION_ATTACHMENTS_PRUNE_TTL_DAYS, 30),
  ),
  SESSION_ATTACHMENTS_PRUNE_INTERVAL_MS: Math.max(
    0,
    parseFiniteNumber(process.env.SESSION_ATTACHMENTS_PRUNE_INTERVAL_MS, 12 * 60 * 60 * 1000),
  ),
  ONLYOFFICE_BIN: process.env.ONLYOFFICE_BIN || path.join(userHomeDir, '.local/bin/cli-anything-onlyoffice'),
};

if (!config.ADMIN_TOKEN) {
  console.warn('[config] SLOANE_ADMIN_TOKEN is empty — admin routes are protected only by network trust.');
}

/**
 * RAGFlow fetch helper — eliminates repeated auth header boilerplate.
 *
 * @param {string} path - API path (e.g., '/api/v1/datasets')
 * @param {object} options - { method, body, headers, json }
 * @returns {Promise<Response>}
 *
 * Usage:
 *   const res = await ragflowFetch('/api/v1/datasets');
 *   const res = await ragflowFetch('/api/v1/retrieval', { method: 'POST', body: { question: 'test' } });
 */
function ragflowFetch(path, options = {}) {
  void path;
  void options;
  return Promise.reject(assertLegacyRagflowAllowed({
    surface: 'config.ragflowFetch',
    extraEnvKeys: [
      'SLOANE_LEGACY_RAGFLOW_HTTP_ROUTES_ENABLED',
      'SLOANE_ENABLE_LEGACY_RAGFLOW_ROUTES',
    ],
  }));
}

module.exports = {
  config,
  ragflowFetch,
  getGlmConfig,
  getPathConfig,
  resolveTrustProxySetting,
  isGlmEnabled,
  isGlmModel,
  DEFAULT_GLM_API_URL,
  DEFAULT_SOLANE_ROOT,
};
