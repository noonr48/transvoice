'use strict';

const { config } = require('./config');
const {
  createLearnerContextRouteHandlers,
} = require('./learner-context-route-handlers');
const { createSensitiveRouteGuard } = require('./route-access-control');
const {
  resolveInteractionRuntimeRoot,
} = require('./entrypoint-runtime-root-support');
const {
  createDefaultRouteErrorSender,
  registerJsonRoute,
  registerPayloadRoute,
  registerVoidRoute,
} = require('./server-route-support');

function resolveVoiceRuntimeEntrypointDeps(deps = {}) {
  const interactionRuntime = (deps.interactionGraph && typeof deps.interactionGraph === 'object')
    ? deps.interactionGraph
    : resolveInteractionRuntimeRoot(
      deps.interactionRuntime,
      'voiceRuntimeEntrypoints',
    );

  return {
    voiceRouteMiddlewares: deps.voiceRouteMiddlewares || createSensitiveRouteGuard({
      adminToken: deps.adminToken || config.ADMIN_TOKEN,
      routeLabel: 'Voice route',
    }),
    enableDeepTutorVoiceRoutes: deps.enableDeepTutorVoiceRoutes,
    learnerContextRouteHandlers: deps.learnerContextRouteHandlers
      || interactionRuntime.learnerContextRouteHandlers
      || createLearnerContextRouteHandlers(),
    sendRouteError: deps.sendRouteError,
    voiceOperationRouteHandlers: deps.voiceOperationRouteHandlers || interactionRuntime.voiceOperationRouteHandlers,
    voiceSessionRouteHandlers: deps.voiceSessionRouteHandlers || interactionRuntime.voiceSessionRouteHandlers,
  };
}

function registerVoiceRuntimeEntrypoints(app, deps = {}) {
  const resolvedDeps = resolveVoiceRuntimeEntrypointDeps(deps);
  const {
    enableDeepTutorVoiceRoutes,
    learnerContextRouteHandlers,
    sendRouteError = createDefaultRouteErrorSender(),
    voiceRouteMiddlewares,
    voiceOperationRouteHandlers,
    voiceSessionRouteHandlers,
  } = resolvedDeps;
  const deepTutorVoiceRoutesEnabled = enableDeepTutorVoiceRoutes !== false;

  registerPayloadRoute(
    app,
    'get',
    '/voice/health',
    async () => {
      const result = await voiceSessionRouteHandlers.getVoiceHealth();
      return {
        ...result,
        payload: {
          ...(result?.payload || {}),
          deepTutorVoiceRoutesEnabled,
        },
      };
    },
    { middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerPayloadRoute(
    app,
    'get',
    '/voice/session/:sessionId',
    (req) => voiceSessionRouteHandlers.getVoiceSession(req.params.sessionId),
    { middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/learner-context/profile',
    (req) => learnerContextRouteHandlers.getLearnerContext(req.query?.studentId, req.query?.query || ''),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/learner-context/export-manifest',
    (req) => learnerContextRouteHandlers.getLearnerContextExportManifest(req.query?.studentId),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'put',
    '/voice/learner-context/dataset-controls',
    (req) => learnerContextRouteHandlers.updateLearnerContextDatasetControls(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/learner-context/profile',
    (req) => learnerContextRouteHandlers.updateLearnerContextProfile(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  // v6 LEARNER CONTROL: forget a moment / preference, or reset the accumulated memory.
  registerJsonRoute(
    app,
    'post',
    '/voice/learner-context/forget',
    (req) => learnerContextRouteHandlers.forgetLearnerContext(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  // v2 learner memo: deterministic continuity greeting for session entry.
  registerJsonRoute(
    app,
    'get',
    '/voice/coach/greeting',
    (req) => learnerContextRouteHandlers.getLearnerContextGreeting(req.query || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/learner-context/notepad-handoff',
    (req) => learnerContextRouteHandlers.updateLearnerContextNotepadHandoff(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  if (deepTutorVoiceRoutesEnabled) {
    registerPayloadRoute(
      app,
      'get',
      '/deeptutor/voice/session/:sessionId',
      (req) => voiceSessionRouteHandlers.getDeepTutorVoiceSession(req.params.sessionId, {
        refreshGuide: req.query?.refresh === '1',
      }),
      { middlewares: voiceRouteMiddlewares, sendRouteError },
    );

    registerPayloadRoute(
      app,
      'post',
      '/deeptutor/voice/session/start',
      (req) => voiceSessionRouteHandlers.startDeepTutorVoiceSession(req.body || {}),
      { middlewares: voiceRouteMiddlewares, sendRouteError },
    );

    registerJsonRoute(
      app,
      'post',
      '/deeptutor/voice/session/message',
      (req) => voiceOperationRouteHandlers.processDeepTutorVoiceMessage(req.body || {}),
      { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
    );

    registerJsonRoute(
      app,
      'post',
      '/deeptutor/voice/session/brief-action',
      (req) => voiceOperationRouteHandlers.processDeepTutorVoiceBriefAction(req.body || {}),
      { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
    );

    registerJsonRoute(
      app,
      'post',
      '/deeptutor/voice/session/next',
      (req) => voiceOperationRouteHandlers.processDeepTutorVoiceAdvance(req.body || {}),
      { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
    );

    registerJsonRoute(
      app,
      'post',
      '/deeptutor/voice/session/coach',
      (req) => voiceOperationRouteHandlers.processDeepTutorVoiceTakeCoaching(req.body || {}),
      { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
    );
  }

  registerJsonRoute(
    app,
    'post',
    '/voice/session/start',
    (req) => voiceOperationRouteHandlers.startVoiceSession(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/reference',
    (req) => voiceOperationRouteHandlers.updateVoiceSessionReference(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/preset',
    (req) => voiceOperationRouteHandlers.updateVoiceSessionPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/presets',
    (req) => voiceOperationRouteHandlers.listCustomVoiceTargetPresets(req.query || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/reference/save',
    (req) => voiceOperationRouteHandlers.saveCurrentVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/handmade/save',
    (req) => voiceOperationRouteHandlers.saveHandmadeVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/select',
    (req) => voiceOperationRouteHandlers.selectVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/duplicate',
    (req) => voiceOperationRouteHandlers.duplicateVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/archive',
    (req) => voiceOperationRouteHandlers.archiveVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/restore',
    (req) => voiceOperationRouteHandlers.restoreVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/presets/delete',
    (req) => voiceOperationRouteHandlers.deleteVoiceTargetPreset(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/drills',
    (req) => voiceOperationRouteHandlers.getVoiceDrills(req.query || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  // The self-practice menu. Sibling of /voice/drills, but the two are NOT
  // interchangeable: this one needs no session and refuses an unknown preset
  // rather than defaulting to a feminine pack. See the handler's comment.
  registerJsonRoute(
    app,
    'get',
    '/voice/self-practice',
    (req) => voiceOperationRouteHandlers.listSelfPracticeDrills(req.query || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/drills/select',
    (req) => voiceOperationRouteHandlers.selectVoiceDrill(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/cockpit/line',
    (req) => voiceOperationRouteHandlers.updateVoiceCockpitLine(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/input/status',
    () => voiceOperationRouteHandlers.getVoiceInputStatus(),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/input/runtime',
    (req) => voiceOperationRouteHandlers.updateVoiceInputRuntime(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/input/turn',
    (req) => voiceOperationRouteHandlers.submitVoiceInputTurn(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'get',
    '/voice/speech/status',
    () => voiceOperationRouteHandlers.getVoiceSpeechStatus(),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/speech/conditioning',
    (req) => voiceOperationRouteHandlers.updateVoiceSpeechConditioning(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/speech/conditioning/latents',
    (req) => voiceOperationRouteHandlers.prepareVoiceSpeechConditioningLatents(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerVoidRoute(
    app,
    'post',
    '/voice/speech/generate',
    (req, res) => voiceOperationRouteHandlers.proxyVoiceSpeechGenerate(req, res, req.body || {}),
    {
      errorLabel: null,
      ignoreErrorIfResponseEnded: true,
      isAsync: true,
      middlewares: voiceRouteMiddlewares,
      sendRouteError,
    },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/speech/played',
    (req) => voiceOperationRouteHandlers.recordVoiceSpeechPlayback(req.body || {}),
    { middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/speech/cancel',
    (req) => voiceOperationRouteHandlers.cancelVoiceSpeech(req.body || {}),
    { middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/cockpit/state',
    (req) => voiceOperationRouteHandlers.updateVoiceCockpitState(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/phrase-forecast',
    (req) => voiceOperationRouteHandlers.projectVoicePhraseForecast(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/phrase-comparison',
    (req) => voiceOperationRouteHandlers.saveVoicePhraseComparison(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/coach/start',
    (req) => voiceOperationRouteHandlers.startAsyncVoiceCoachTask(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/coach/runtime',
    (req) => voiceOperationRouteHandlers.processVoiceCoachRuntime(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/coach/message',
    (req) => voiceOperationRouteHandlers.processVoiceCoachRuntime(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/coach/ask',
    (req) => voiceOperationRouteHandlers.processLegacyVoiceCoachMessage(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/take',
    (req) => voiceOperationRouteHandlers.finalizeVoiceTake(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/disarm',
    (req) => voiceOperationRouteHandlers.disarmVoiceSession(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );

  registerJsonRoute(
    app,
    'post',
    '/voice/session/end',
    (req) => voiceOperationRouteHandlers.endVoiceSession(req.body || {}),
    { isAsync: true, middlewares: voiceRouteMiddlewares, sendRouteError },
  );
}

module.exports = {
  registerVoiceRuntimeEntrypoints,
  resolveVoiceRuntimeEntrypointDeps,
};
