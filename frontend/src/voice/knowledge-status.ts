export type VoiceKnowledgeStatusPayload = {
  statusSurface?: {
    surface?: string | null;
    state?: string | null;
    updatedAt?: string | null;
    label?: string | null;
    details?: {
      configured?: boolean;
      provisioned?: boolean;
      ready?: boolean;
      failed?: boolean;
      failedAfterReady?: boolean;
    } | null;
  } | null;
  activeJobId?: string | null;
  latestJob?: {
    status?: string | null;
  } | null;
  compileState?: {
    compiled_at?: string | null;
    dataset?: {
      id?: string | null;
    } | null;
  } | null;
  compiler?: {
    compiledDatasetId?: string | null;
    memoryProjects?: string[] | null;
  } | null;
};

export function getVoiceKnowledgeStatusLabel(
  data: VoiceKnowledgeStatusPayload | null | undefined,
): string {
  const normalizedLabel = typeof data?.statusSurface?.label === 'string' && data.statusSurface.label.trim()
    ? data.statusSurface.label.trim()
    : '';
  if (normalizedLabel) {
    return normalizedLabel;
  }

  return 'Unavailable';
}
