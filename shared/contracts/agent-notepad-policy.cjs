'use strict';

const NOTEPAD_CAPABILITY_ID = 'session-notepad';
const NOTEPAD_POLICY_VERSION = 1;

const OWNERSHIPS = Object.freeze([
  'agent-managed',
  'backend-managed',
  'read-only',
  'none',
]);
const MUTATIONS = Object.freeze([
  'json-tools',
  'native-control-line',
  'backend',
  'none',
]);
const PROMPT_MODES = Object.freeze([
  'editable',
  'read-only',
  'hidden',
]);

const DISABLED_NOTEPAD_POLICY = Object.freeze({
  schemaVersion: NOTEPAD_POLICY_VERSION,
  enabled: false,
  ownership: 'none',
  mutation: 'none',
  promptMode: 'hidden',
  exposeTools: false,
  nativeControl: false,
  uiVisible: false,
});

const AGENT_MANAGED_NOTEPAD_POLICY = Object.freeze({
  schemaVersion: NOTEPAD_POLICY_VERSION,
  enabled: true,
  ownership: 'agent-managed',
  mutation: 'json-tools',
  promptMode: 'editable',
  exposeTools: true,
  nativeControl: false,
  uiVisible: true,
});

const BACKEND_MANAGED_NOTEPAD_POLICY = Object.freeze({
  schemaVersion: NOTEPAD_POLICY_VERSION,
  enabled: true,
  ownership: 'backend-managed',
  mutation: 'backend',
  promptMode: 'read-only',
  exposeTools: false,
  nativeControl: false,
  uiVisible: true,
});

const READ_ONLY_NOTEPAD_POLICY = Object.freeze({
  schemaVersion: NOTEPAD_POLICY_VERSION,
  enabled: true,
  ownership: 'read-only',
  mutation: 'none',
  promptMode: 'read-only',
  exposeTools: false,
  nativeControl: false,
  uiVisible: true,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeText(value).replace(/_/g, '-');
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function clonePolicy(policy) {
  return { ...(policy || DISABLED_NOTEPAD_POLICY) };
}

function enforceNotepadPolicyInvariants(policy) {
  const resolved = clonePolicy(policy);
  if (!resolved.enabled) {
    return {
      ...clonePolicy(DISABLED_NOTEPAD_POLICY),
      ...(normalizeText(resolved.source) ? { source: normalizeText(resolved.source) } : {}),
    };
  }
  if (resolved.promptMode === 'hidden') {
    return {
      ...resolved,
      exposeTools: false,
      nativeControl: false,
      uiVisible: false,
    };
  }
  if (resolved.uiVisible === false) {
    return {
      ...resolved,
      exposeTools: false,
      nativeControl: false,
    };
  }
  if (resolved.promptMode === 'read-only') {
    return {
      ...resolved,
      exposeTools: false,
      nativeControl: false,
    };
  }
  return resolved;
}

function getDefaultNotepadPolicyForExecutionFamily(executionFamily) {
  const family = normalizeText(executionFamily).toLowerCase();
  if (['cli', 'game', 'deeptutor', 'video', 'xna', 'subject'].includes(family)) {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  if (family === 'voice') {
    return clonePolicy(BACKEND_MANAGED_NOTEPAD_POLICY);
  }
  if (family === 'llm') {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  return clonePolicy(DISABLED_NOTEPAD_POLICY);
}

function getDefaultNotepadPolicyForAgentId(agentId, executionFamily = '') {
  const normalizedAgentId = normalizeText(agentId).toLowerCase();
  if (normalizedAgentId === 'voice') {
    return clonePolicy(BACKEND_MANAGED_NOTEPAD_POLICY);
  }
  if (
    normalizedAgentId === 'general'
    || normalizedAgentId === 'game'
    || normalizedAgentId === 'story'
    || normalizedAgentId === 'deeptutor'
    || normalizedAgentId === 'video-producer'
    || normalizedAgentId === 'video'
    || normalizedAgentId === 'xna'
    || normalizedAgentId.startsWith('uni-')
  ) {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  return getDefaultNotepadPolicyForExecutionFamily(executionFamily || 'llm');
}

function getDefaultNotepadPolicyForBlueprintId(blueprintId) {
  const normalizedBlueprintId = normalizeText(blueprintId).toLowerCase();
  if (normalizedBlueprintId === 'deeptutor-voice-tutor') {
    return clonePolicy(BACKEND_MANAGED_NOTEPAD_POLICY);
  }
  if ([
    'sloane-general',
    'sloane-game',
    'sloane-story',
    'sloane-video-producer',
    'sloane-video',
    'deeptutor-general-tutor',
    'xna-reviewed-implementer',
    'uni-subject-agent',
    'sloane-custom-cli',
  ].includes(normalizedBlueprintId)) {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  if (normalizedBlueprintId === 'llm-chat-default') {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  return null;
}

function normalizeNotepadPolicy(value, fallback = DISABLED_NOTEPAD_POLICY) {
  const base = clonePolicy(fallback);
  if (value === true) {
    return {
      ...clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY),
      source: base.source || 'boolean',
    };
  }
  if (value === false) {
    return clonePolicy(DISABLED_NOTEPAD_POLICY);
  }
  if (!isRecord(value)) {
    return base;
  }

  const enabled = normalizeBoolean(value.enabled, base.enabled);
  if (!enabled) {
    return enforceNotepadPolicyInvariants({
      ...clonePolicy(DISABLED_NOTEPAD_POLICY),
      source: normalizeText(value.source) || base.source,
    });
  }

  const ownership = normalizeEnum(
    value.ownership || value.owner || value.ownerMode || value.owner_mode,
    OWNERSHIPS,
    base.ownership,
  );
  const mutation = normalizeEnum(
    value.mutation || value.mutationMode || value.mutation_mode,
    MUTATIONS,
    base.mutation,
  );
  const promptMode = normalizeEnum(
    value.promptMode || value.prompt_mode || value.prompt,
    PROMPT_MODES,
    base.promptMode,
  );

  return enforceNotepadPolicyInvariants({
    schemaVersion: Number.isFinite(Number(value.schemaVersion || value.schema_version))
      ? Math.max(1, Math.floor(Number(value.schemaVersion || value.schema_version)))
      : NOTEPAD_POLICY_VERSION,
    enabled,
    ownership,
    mutation,
    promptMode,
    exposeTools: normalizeBoolean(
      Object.prototype.hasOwnProperty.call(value, 'exposeTools') ? value.exposeTools : value.expose_tools,
      mutation === 'json-tools' && ownership === 'agent-managed',
    ),
    nativeControl: normalizeBoolean(
      Object.prototype.hasOwnProperty.call(value, 'nativeControl') ? value.nativeControl : value.native_control,
      mutation === 'native-control-line',
    ),
    uiVisible: normalizeBoolean(
      Object.prototype.hasOwnProperty.call(value, 'uiVisible') ? value.uiVisible : value.ui_visible,
      promptMode !== 'hidden',
    ),
    ...(normalizeText(value.source || base.source) ? { source: normalizeText(value.source || base.source) } : {}),
  });
}

function applyRuntimeToNotepadPolicy(policy, options = {}) {
  const runtimeMode = normalizeText(options.runtimeMode || options.runtime || options.toolUseMode).toLowerCase();
  const normalizedPolicy = normalizeNotepadPolicy(policy);
  if (!normalizedPolicy.enabled) {
    return normalizedPolicy;
  }
  if (
    runtimeMode === 'provider-native'
    && normalizedPolicy.ownership === 'agent-managed'
    && normalizedPolicy.mutation === 'json-tools'
    && normalizedPolicy.promptMode === 'editable'
    && normalizedPolicy.exposeTools === true
  ) {
    return enforceNotepadPolicyInvariants({
      ...normalizedPolicy,
      mutation: 'native-control-line',
      exposeTools: false,
      nativeControl: true,
      source: normalizedPolicy.source || 'provider-native-runtime',
    });
  }
  return normalizedPolicy;
}

function createNotepadCapability(policy, displayName = 'Session Notepad') {
  const notepadPolicy = normalizeNotepadPolicy(policy, AGENT_MANAGED_NOTEPAD_POLICY);
  return {
    id: NOTEPAD_CAPABILITY_ID,
    display_name: displayName,
    metadata: {
      notepadPolicy,
    },
  };
}

function readPolicyCandidate(value) {
  if (value === true) {
    return clonePolicy(AGENT_MANAGED_NOTEPAD_POLICY);
  }
  if (value === false) {
    return clonePolicy(DISABLED_NOTEPAD_POLICY);
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'notepadPolicy')) {
    return readPolicyCandidate(value.notepadPolicy);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'notepad_policy')) {
    return readPolicyCandidate(value.notepad_policy);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'policy')) {
    return readPolicyCandidate(value.policy);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'enabled')
    || Object.prototype.hasOwnProperty.call(value, 'ownership')
    || Object.prototype.hasOwnProperty.call(value, 'mutation')
    || Object.prototype.hasOwnProperty.call(value, 'promptMode')
    || Object.prototype.hasOwnProperty.call(value, 'prompt_mode')
    || Object.prototype.hasOwnProperty.call(value, 'exposeTools')
    || Object.prototype.hasOwnProperty.call(value, 'expose_tools')
    || Object.prototype.hasOwnProperty.call(value, 'nativeControl')
    || Object.prototype.hasOwnProperty.call(value, 'native_control')
    || Object.prototype.hasOwnProperty.call(value, 'uiVisible')
    || Object.prototype.hasOwnProperty.call(value, 'ui_visible')
  ) {
    return value;
  }
  return null;
}

function extractNotepadPolicyFromEntries(entries) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const entryId = normalizeText(entry.id);
    const metadata = isRecord(entry.metadata) ? entry.metadata : null;
    if (entryId === NOTEPAD_CAPABILITY_ID) {
      return readPolicyCandidate(metadata) || readPolicyCandidate(entry);
    }
    const candidate = readPolicyCandidate(metadata);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function extractDefaultNotepadPolicyFromBlueprintEntries(entries) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const policy = getDefaultNotepadPolicyForBlueprintId(entry.id);
    if (policy) {
      return policy;
    }
  }
  return null;
}

function extractNotepadPolicyCandidate(value) {
  if (!isRecord(value)) {
    return null;
  }
  return readPolicyCandidate(value)
    || readPolicyCandidate(value.metadata)
    || readPolicyCandidate(value.metadata?.notepad)
    || extractNotepadPolicyFromEntries(value.capabilities)
    || extractNotepadPolicyFromEntries(value.blueprints)
    || extractNotepadPolicyFromEntries(value.metadata?.compatibility?.capabilities)
    || extractNotepadPolicyFromEntries(value.metadata?.compatibility?.blueprints)
    || null;
}

function resolveAgentNotepadPolicy(value = {}, options = {}) {
  const agentOrSession = isRecord(value) ? value : {};
  const agentId = normalizeText(
    options.agentId
      || agentOrSession.agentId
      || agentOrSession.agent_id
      || agentOrSession.id,
  );
  const executionFamily = normalizeText(
    options.executionFamily
      || options.execution_family
      || agentOrSession.executionFamily
      || agentOrSession.execution_family,
  );
  const fallback = getDefaultNotepadPolicyForAgentId(agentId, executionFamily);
  const configuredFallback = readPolicyCandidate(options.fallbackPolicy)
    || readPolicyCandidate(options.fallbackNotepadPolicy)
    || null;
  const blueprintFallback = extractDefaultNotepadPolicyFromBlueprintEntries(agentOrSession.blueprints)
    || extractDefaultNotepadPolicyFromBlueprintEntries(agentOrSession.composition?.blueprints)
    || extractDefaultNotepadPolicyFromBlueprintEntries(agentOrSession.agentComposition?.blueprints)
    || extractDefaultNotepadPolicyFromBlueprintEntries(agentOrSession.composition_manifest?.metadata?.compatibility?.blueprints)
    || extractDefaultNotepadPolicyFromBlueprintEntries(agentOrSession.metadata?.compatibility?.blueprints)
    || null;
  const effectiveFallback = configuredFallback
    ? normalizeNotepadPolicy(configuredFallback, fallback)
    : blueprintFallback
      ? normalizeNotepadPolicy(blueprintFallback, fallback)
      : fallback;
  const candidate = extractNotepadPolicyCandidate(options)
    || extractNotepadPolicyCandidate(agentOrSession)
    || extractNotepadPolicyCandidate(agentOrSession.agent)
    || extractNotepadPolicyCandidate(agentOrSession.composition)
    || extractNotepadPolicyCandidate(agentOrSession.agentComposition)
    || extractNotepadPolicyCandidate(agentOrSession.composition_manifest)
    || extractNotepadPolicyCandidate(agentOrSession.agentCompositionManifest);
  return applyRuntimeToNotepadPolicy(
    normalizeNotepadPolicy(candidate || effectiveFallback, effectiveFallback),
    options,
  );
}

function shouldExposeNotepadTool(policy, toolName) {
  const resolvedPolicy = normalizeNotepadPolicy(policy);
  if (
    !resolvedPolicy.enabled
    || resolvedPolicy.promptMode === 'hidden'
    || resolvedPolicy.uiVisible === false
  ) {
    return false;
  }
  if (toolName === 'read_notepad') {
    return true;
  }
  return resolvedPolicy.promptMode === 'editable'
    && resolvedPolicy.ownership === 'agent-managed'
    && resolvedPolicy.exposeTools === true
    && resolvedPolicy.mutation === 'json-tools';
}

function shouldUseNativeNotepadControl(policy) {
  const resolvedPolicy = normalizeNotepadPolicy(policy);
  return resolvedPolicy.enabled === true
    && resolvedPolicy.promptMode === 'editable'
    && resolvedPolicy.uiVisible !== false
    && resolvedPolicy.ownership === 'agent-managed'
    && resolvedPolicy.nativeControl === true
    && resolvedPolicy.mutation === 'native-control-line';
}

module.exports = {
  AGENT_MANAGED_NOTEPAD_POLICY,
  BACKEND_MANAGED_NOTEPAD_POLICY,
  DISABLED_NOTEPAD_POLICY,
  NOTEPAD_CAPABILITY_ID,
  NOTEPAD_POLICY_VERSION,
  READ_ONLY_NOTEPAD_POLICY,
  applyRuntimeToNotepadPolicy,
  createNotepadCapability,
  getDefaultNotepadPolicyForBlueprintId,
  getDefaultNotepadPolicyForAgentId,
  getDefaultNotepadPolicyForExecutionFamily,
  normalizeNotepadPolicy,
  resolveAgentNotepadPolicy,
  shouldExposeNotepadTool,
  shouldUseNativeNotepadControl,
};
