import { createVoiceRuntimeCoordinator } from './runtime-coordinator';
import { createVoiceCoachRuntimeService, type VoiceCoachRuntimeService } from './runtime-service';

type VoiceCoachRuntimeBootstrapOptions = {
  runtimeService: Parameters<typeof createVoiceCoachRuntimeService>[0];
  runtimeCoordinator: Omit<Parameters<typeof createVoiceRuntimeCoordinator>[0], 'runtimeService'>;
};

export type VoiceCoachRuntimeBootstrap = {
  runtimeService: VoiceCoachRuntimeService;
  runtimeCoordinator: ReturnType<typeof createVoiceRuntimeCoordinator>;
};

export function createVoiceCoachRuntimeBootstrap(
  options: VoiceCoachRuntimeBootstrapOptions,
): VoiceCoachRuntimeBootstrap {
  const runtimeService = createVoiceCoachRuntimeService(options.runtimeService);
  const runtimeCoordinator = createVoiceRuntimeCoordinator({
    ...options.runtimeCoordinator,
    runtimeService,
  });

  return {
    runtimeService,
    runtimeCoordinator,
  };
}
