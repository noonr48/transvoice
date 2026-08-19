'use strict';

const {
  createVoiceBackendPayload,
} = require('../shared/contracts/voice-backend-payload.cjs');

function createHttpError(status, message, extras = {}) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.payload = {
    success: false,
    error: message,
    ...extras,
  };
  return error;
}

function normalizeStudentId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function requireStudentId(value) {
  const studentId = normalizeStudentId(value);
  if (!studentId) {
    throw createHttpError(400, 'studentId is required and must be a string');
  }
  return studentId;
}

function requireLearnerContextService(service) {
  if (!service || typeof service.getVoiceStudentModelSnapshot !== 'function') {
    throw createHttpError(503, 'Learner context service is unavailable');
  }
  return service;
}

function pickProvidedDatasetControls(body = {}) {
  const controls = {};
  if (Object.prototype.hasOwnProperty.call(body, 'consent')) {
    controls.consent = body.consent;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'eligibility')) {
    controls.eligibility = body.eligibility;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'exclusions')) {
    controls.exclusions = body.exclusions;
  }
  return controls;
}

function buildSnapshotPayload(snapshot, extras = {}) {
  return createVoiceBackendPayload({
    studentModel: snapshot || null,
    learnerContext: snapshot?.learnerContext || null,
  }, {
    success: true,
    ...extras,
  });
}

function createLearnerContextRouteHandlers(deps = {}) {
  const {
    learnerContextService = null,
    clearRuntimeLearnerData = null,
  } = deps;

  async function getLearnerContext(studentId, query = '') {
    const service = requireLearnerContextService(learnerContextService);
    const resolvedStudentId = requireStudentId(studentId);
    const snapshot = await service.getVoiceStudentModelSnapshot(resolvedStudentId, query);
    return buildSnapshotPayload(snapshot, {
      studentId: snapshot.studentId || resolvedStudentId,
    });
  }

  // v2 learner memo: deterministic two-line continuity greeting (no LLM call).
  // Composes from the learner snapshot via the signal-builder's memo helper.
  // Fail-soft: any read error still yields a neutral greeting (success:true) so
  // the frontend can always render it on session entry. `sessionId` is accepted
  // for the call shape; the standalone runtime resolves a single default learner
  // per session, so we read the snapshot by studentId (default when absent).
  async function getLearnerContextGreeting(query = {}) {
    const { buildContinuityGreeting } = require('./coaching/signal-builder');
    const service = requireLearnerContextService(learnerContextService);
    const requestedStudentId = normalizeStudentId(query.studentId);
    const sessionId = normalizeStudentId(query.sessionId) || null;
    let snapshot = null;
    try {
      snapshot = await service.getVoiceStudentModelSnapshot(requestedStudentId || undefined, '');
    } catch {
      snapshot = null;
    }
    const greeting = buildContinuityGreeting(snapshot);
    return {
      success: true,
      sessionId,
      studentId: snapshot?.studentId || requestedStudentId || null,
      greeting,
    };
  }

  async function getLearnerContextExportManifest(studentId) {
    const service = requireLearnerContextService(learnerContextService);
    if (typeof service.getDatasetExportManifest !== 'function') {
      throw createHttpError(503, 'Learner context export manifest is unavailable');
    }
    const resolvedStudentId = requireStudentId(studentId);
    return {
      success: true,
      studentId: resolvedStudentId,
      manifest: service.getDatasetExportManifest(resolvedStudentId),
    };
  }

  async function updateLearnerContextDatasetControls(body = {}) {
    const service = requireLearnerContextService(learnerContextService);
    if (typeof service.setDatasetControls !== 'function') {
      throw createHttpError(503, 'Learner context dataset controls are unavailable');
    }
    const studentId = requireStudentId(body.studentId);
    service.setDatasetControls(studentId, pickProvidedDatasetControls(body));
    const snapshot = await service.getVoiceStudentModelSnapshot(studentId, body.query || '');
    return buildSnapshotPayload(snapshot, {
      studentId: snapshot.studentId || studentId,
      manifest: typeof service.getDatasetExportManifest === 'function'
        ? service.getDatasetExportManifest(studentId)
        : null,
    });
  }

  async function updateLearnerContextProfile(body = {}) {
    const service = requireLearnerContextService(learnerContextService);
    if (typeof service.updateLearnerProfile !== 'function') {
      throw createHttpError(503, 'Learner context profile update is unavailable');
    }
    const studentId = requireStudentId(body.studentId);
    // Only forward the fields the caller actually supplied (the service gates
    // each by has-own-property so a partial body is a partial update).
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
      updates.displayName = body.displayName;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'topics')) {
      updates.topics = body.topics;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'hobbies')) {
      updates.hobbies = body.hobbies;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'pronouns')) {
      updates.pronouns = body.pronouns;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'direction')) {
      updates.direction = body.direction;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'goal')) {
      updates.goal = body.goal;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'avoid')) {
      updates.avoid = body.avoid;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'whatWorked')) {
      updates.whatWorked = body.whatWorked;
    }
    service.updateLearnerProfile(studentId, updates);
    const snapshot = await service.getVoiceStudentModelSnapshot(studentId, body.query || '');
    return buildSnapshotPayload(snapshot, {
      studentId: snapshot.studentId || studentId,
    });
  }

  async function updateLearnerContextNotepadHandoff(body = {}) {
    const service = requireLearnerContextService(learnerContextService);
    if (typeof service.updateNotepadHandoff !== 'function') {
      throw createHttpError(503, 'Learner context notepad handoff is unavailable');
    }
    const studentId = requireStudentId(body.studentId);
    service.updateNotepadHandoff(studentId, {
      content: body.content,
      items: body.items,
      note: body.note,
      sessionId: body.sessionId,
      source: body.source || 'voice-learner-context-route',
      summary: body.summary,
    });
    const snapshot = await service.getVoiceStudentModelSnapshot(studentId, body.query || '');
    return buildSnapshotPayload(snapshot, {
      studentId: snapshot.studentId || studentId,
    });
  }

  // v6 LEARNER CONTROL: delete a specific moment / coaching preference, or reset the
  // accumulated memory (mirrors updateLearnerContextDatasetControls).
  async function forgetLearnerContext(body = {}) {
    const service = requireLearnerContextService(learnerContextService);
    const studentId = requireStudentId(body.studentId);
    const operation = typeof body.operation === 'string' ? body.operation.trim().toLowerCase() : '';
    const deleteAll = operation === 'delete-all' || body.deleteAll === true;
    const reset = operation === 'reset-personalization' || body.reset === true;
    if (deleteAll) {
      const runtimeReceipt = typeof clearRuntimeLearnerData === 'function'
        ? await clearRuntimeLearnerData(studentId, { deleteAll: true })
        : null;
      if (typeof service.deleteLearnerData !== 'function') {
        throw createHttpError(503, 'Complete learner data deletion is unavailable');
      }
      const learnerReceipt = service.deleteLearnerData(studentId);
      if (!learnerReceipt?.success) {
        throw createHttpError(503, 'Complete learner data deletion could not be verified');
      }
      return createVoiceBackendPayload(null, {
        success: true,
        studentId,
        studentModel: null,
        learnerContext: null,
        deletionReceipt: {
          operation: 'delete-all',
          learnerStore: learnerReceipt,
          runtimeStore: runtimeReceipt,
        },
      });
    }
    let runtimeReceipt = null;
    if (reset && typeof service.resetLearnerMemory === 'function') {
      service.resetLearnerMemory(studentId);
      if (typeof clearRuntimeLearnerData === 'function') {
        runtimeReceipt = await clearRuntimeLearnerData(studentId, { deleteAll: false });
      }
    }
    if (body.momentId && typeof service.removeMoment === 'function') {
      service.removeMoment(studentId, body.momentId);
    }
    if (body.removePreference && typeof service.removeCoachPreference === 'function') {
      service.removeCoachPreference(studentId, body.removePreference);
    }
    const snapshot = await service.getVoiceStudentModelSnapshot(studentId, body.query || '');
    return buildSnapshotPayload(snapshot, {
      studentId: snapshot.studentId || studentId,
      ...(reset ? {
        resetReceipt: {
          operation: 'reset-personalization',
          runtimeStore: runtimeReceipt,
        },
      } : {}),
    });
  }

  return {
    getLearnerContext,
    getLearnerContextGreeting,
    getLearnerContextExportManifest,
    updateLearnerContextDatasetControls,
    updateLearnerContextProfile,
    updateLearnerContextNotepadHandoff,
    forgetLearnerContext,
  };
}

module.exports = {
  createLearnerContextRouteHandlers,
};
