import type { VoiceCoachMessageChannel } from './state';
import {
  getVoiceCoachClarificationIntent as resolveClarificationIntent,
  resolveVoiceCoachHandlingDecision as resolveHandlingDecision,
  resolveVoiceCoachRoutingDecision as resolveRoutingDecision,
} from './coach-routing-core';

export type VoiceCoachClarificationIntent =
  | 'repeat'
  | 'repeat-slower'
  | 'advance'
  | 'hold'
  | 'why'
  | 'easier'
  | 'harder'
  | 'practice-ready'
  | 'practice-stop';

export type VoiceCoachRoutingDecision = {
  normalizedQuestion: string;
  intent: VoiceCoachClarificationIntent | null;
  shouldDeferToFrontend: boolean;
  shouldEscalateToDeepTutor: boolean;
};

export type VoiceCoachHandlingRoute =
  | 'legacy'
  | 'deeptutor-realtime'
  | 'deeptutor-guide'
  | 'deeptutor-brief-action'
  | 'deeptutor-advance';

export type VoiceCoachHandlingDecision = VoiceCoachRoutingDecision & {
  route: VoiceCoachHandlingRoute;
  channel: VoiceCoachMessageChannel;
};

export function getVoiceCoachClarificationIntent(text: string): VoiceCoachClarificationIntent | null {
  return resolveClarificationIntent(text) as VoiceCoachClarificationIntent | null;
}

export function resolveVoiceCoachRoutingDecision(text: string): VoiceCoachRoutingDecision {
  return resolveRoutingDecision(text) as VoiceCoachRoutingDecision;
}

export function resolveVoiceCoachHandlingDecision(
  text: string,
  hasActiveGuideSession: boolean,
): VoiceCoachHandlingDecision {
  const decision = resolveHandlingDecision(text, hasActiveGuideSession) as VoiceCoachHandlingDecision;
  if (
    decision.channel !== 'coach'
    && decision.channel !== 'legacy'
    && decision.channel !== 'runtime'
    && decision.channel !== 'deeptutor'
    && decision.channel !== 'shortcut'
  ) {
    throw new Error(`Unsupported voice coach channel: ${String(decision.channel)}`);
  }
  return decision;
}
