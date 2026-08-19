import type { VoiceCoachMessageChannel } from './state';

/**
 * 2026-07-27 (owner's law): ALL learner speech goes to the tutor, and the tutor
 * decides. The clarification-plan resolver that used to live here — mapping a
 * matched intent to a client action that CONSUMED the turn — is gone with the
 * whole consumption lane. The pending channel is now simply the truthful name
 * of the one pipe every question actually takes (submitRuntimeCoachQuestion):
 * the deeptutor-guided runtime lane when a guide session is active, the legacy
 * coach lane otherwise.
 */
export function resolveVoiceCoachPendingChannel(
  _question: string,
  hasActiveGuideSession: boolean,
): VoiceCoachMessageChannel {
  return hasActiveGuideSession ? 'runtime' : 'legacy';
}
