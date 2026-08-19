from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from src.config import settings
from src.services.contracts import (
  VOICE_ANALYSIS_VERSION,
  VoiceAttemptArtifact,
  sanitize_non_finite,
)
from src.services.storage import model_to_dict


VOICE_ATTEMPT_DATASET_SCHEMA_VERSION = 'voice-attempt-dataset-v1'
VOICE_ATTEMPT_DATASET_REDACTION_VERSION = 'basic-redaction-v1'

CRITICAL_RELIABILITY_FLAGS = {
  'short_sample',
  'low_voiced_coverage',
  'low_confidence',
  'low_score_confidence',
  'quiet_input',
}

EMAIL_PATTERN = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.IGNORECASE)
PHONE_PATTERN = re.compile(r'(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)')
LONG_ID_PATTERN = re.compile(r'\b[A-Fa-f0-9]{16,}\b')


@dataclass(frozen=True)
class VoiceDatasetExportOptions:
  allow_training: bool = False
  allow_evaluation: bool = False
  consent_source: str | None = None
  salt: str = 'sloane-voice-attempt-dataset'
  min_duration_ms: int = 500
  min_frame_count: int = 3
  min_timeline_sampled_frame_count: int = 1
  min_voiced_frame_pct: float = 0.20
  min_confident_frame_pct: float = 0.20
  max_training_strain: int = 3
  include_transcript: bool = False
  eval_ratio: float = 0.15
  holdout_ratio: float = 0.05


def _utc_now() -> str:
  return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _model_payload(value: Any) -> dict[str, Any]:
  if value is None:
    return {}
  if isinstance(value, dict):
    return value
  if hasattr(value, 'model_dump'):
    return value.model_dump(exclude_none=True)
  if hasattr(value, 'dict'):
    return value.dict(exclude_none=True)
  return {}


def _stable_hash(value: str | None, salt: str, length: int = 16) -> str | None:
  normalized = str(value or '').strip()
  if not normalized:
    return None
  digest = hashlib.sha256(f'{salt}:{normalized}'.encode('utf-8')).hexdigest()
  return digest[:length]


def _redact_text(value: Any, max_length: int = 240) -> str | None:
  if not isinstance(value, str):
    return None
  normalized = ' '.join(value.split())
  if not normalized:
    return None
  normalized = EMAIL_PATTERN.sub('[email]', normalized)
  normalized = LONG_ID_PATTERN.sub('[id]', normalized)
  normalized = PHONE_PATTERN.sub('[phone]', normalized)
  return normalized[:max_length]


def _redact_string_list(value: Any, max_items: int = 8, max_length: int = 160) -> list[str]:
  if not isinstance(value, list):
    return []
  redacted = []
  for item in value:
    text = _redact_text(str(item), max_length=max_length)
    if text:
      redacted.append(text)
    if len(redacted) >= max_items:
      break
  return redacted


def _metadata_allowed_use(metadata: dict[str, Any] | None) -> dict[str, Any] | None:
  if not isinstance(metadata, dict):
    return None
  raw = metadata.get('allowedUse') or metadata.get('datasetUse') or metadata.get('datasetConsent')
  if raw is True:
    return {'training': True, 'evaluation': True, 'source': 'artifact_metadata'}
  if not isinstance(raw, dict):
    return None
  return {
    'training': bool(raw.get('training') or raw.get('train')),
    'evaluation': bool(raw.get('evaluation') or raw.get('eval')),
    'source': _redact_text(raw.get('source'), 80) or 'artifact_metadata',
  }


def resolve_allowed_use(artifact: VoiceAttemptArtifact, options: VoiceDatasetExportOptions) -> dict[str, Any]:
  self_report_metadata = _model_payload(artifact.selfReport).get('metadata')
  rep_context_metadata = _model_payload(artifact.repContext).get('metadata')
  metadata_policy = _metadata_allowed_use(self_report_metadata) or _metadata_allowed_use(rep_context_metadata)

  training = bool(options.allow_training or metadata_policy and metadata_policy.get('training'))
  evaluation = bool(options.allow_evaluation or metadata_policy and metadata_policy.get('evaluation'))
  source = options.consent_source or (metadata_policy or {}).get('source')
  if not source and (options.allow_training or options.allow_evaluation):
    source = 'operator_override'

  return {
    'training': training,
    'evaluation': evaluation,
    'source': source,
  }


def _artifact_metric_value(artifact: VoiceAttemptArtifact, key: str) -> float | None:
  metrics = artifact.metrics
  if metrics is None:
    return None
  value = getattr(metrics, key, None)
  return float(value) if isinstance(value, (int, float)) else None


def validate_voice_attempt_artifact(
  artifact: VoiceAttemptArtifact,
  options: VoiceDatasetExportOptions | None = None,
) -> dict[str, Any]:
  resolved_options = options or VoiceDatasetExportOptions()
  allowed_use = resolve_allowed_use(artifact, resolved_options)
  exclusion_reasons: list[str] = []
  warnings: list[str] = []

  if not allowed_use['training'] and not allowed_use['evaluation']:
    exclusion_reasons.append('missing_consent')
  if artifact.includesRawAudio:
    exclusion_reasons.append('raw_audio_present')
  if artifact.analysisVersion != VOICE_ANALYSIS_VERSION:
    exclusion_reasons.append('unsupported_analysis_version')
  if artifact.metrics is None:
    exclusion_reasons.append('missing_metrics')
  if artifact.durationMs < resolved_options.min_duration_ms:
    exclusion_reasons.append('too_short')
  if artifact.frameCount < resolved_options.min_frame_count:
    exclusion_reasons.append('too_few_frames')
  if artifact.timelineSampledFrameCount < resolved_options.min_timeline_sampled_frame_count:
    exclusion_reasons.append('missing_timeline_sample')

  advanced = artifact.metrics.advanced if artifact.metrics is not None else None
  root_reliability_flags = list(artifact.reliabilityFlags or [])
  advanced_reliability_flags = list(advanced.reliabilityFlags or []) if advanced is not None else []
  reliability_flags = sorted(set(root_reliability_flags + advanced_reliability_flags))

  if advanced is not None:
    if advanced.voicedFramePct is not None and advanced.voicedFramePct < resolved_options.min_voiced_frame_pct:
      exclusion_reasons.append('low_voiced_coverage')
    if advanced.confidentFramePct is not None and advanced.confidentFramePct < resolved_options.min_confident_frame_pct:
      exclusion_reasons.append('low_confidence_coverage')
  elif artifact.metrics is not None:
    exclusion_reasons.append('missing_advanced_metrics')

  for flag in reliability_flags:
    if flag in CRITICAL_RELIABILITY_FLAGS:
      exclusion_reasons.append(f'reliability:{flag}')
    else:
      warnings.append(f'reliability:{flag}')

  self_report = _model_payload(artifact.selfReport)
  strain = self_report.get('strain')
  high_strain = isinstance(strain, int) and strain > resolved_options.max_training_strain
  if high_strain:
    warnings.append('high_strain')

  base_ready = len(exclusion_reasons) == 0
  training_ready = base_ready and allowed_use['training'] and not high_strain
  evaluation_ready = base_ready and allowed_use['evaluation']
  if base_ready and not training_ready and not evaluation_ready:
    if high_strain and allowed_use['training']:
      exclusion_reasons.append('training_high_strain')
    else:
      exclusion_reasons.append('no_allowed_ready_use')
  dataset_ready = len(exclusion_reasons) == 0 and (training_ready or evaluation_ready)
  training_exclusion_reasons = []
  if base_ready and allowed_use['training'] and high_strain:
    training_exclusion_reasons.append('high_strain')

  return {
    'schemaVersion': VOICE_ATTEMPT_DATASET_SCHEMA_VERSION,
    'datasetReady': dataset_ready,
    'trainingReady': training_ready,
    'evaluationReady': evaluation_ready,
    'allowedUse': allowed_use,
    'exclusionReasons': sorted(set(exclusion_reasons)),
    'trainingExclusionReasons': sorted(set(training_exclusion_reasons)),
    'warnings': sorted(set(warnings)),
  }


def _split_for_record(record_id: str, validation: dict[str, Any], options: VoiceDatasetExportOptions) -> str:
  if validation.get('evaluationReady') and not validation.get('trainingReady'):
    return 'eval'
  if validation.get('trainingReady') and not validation.get('evaluationReady'):
    return 'train'
  digest = hashlib.sha256(f'{options.salt}:split:{record_id}'.encode('utf-8')).hexdigest()
  bucket = int(digest[:8], 16) / 0xFFFFFFFF
  if bucket < options.holdout_ratio:
    return 'holdout'
  if bucket < options.holdout_ratio + options.eval_ratio:
    return 'eval'
  return 'train'


def _redact_rep_context(artifact: VoiceAttemptArtifact, options: VoiceDatasetExportOptions) -> dict[str, Any] | None:
  context = _model_payload(artifact.repContext)
  if not context:
    return None
  active_line = context.get('activeLine')
  redacted_active_line = None
  if isinstance(active_line, dict):
    redacted_active_line = {
      'id': _stable_hash(active_line.get('id') or active_line.get('lineId'), options.salt),
      'intent': _redact_text(active_line.get('intent'), 160),
      'teachingFocus': _redact_string_list(active_line.get('teachingFocus'), 8, 80),
    }
  return {
    'lessonIdHash': _stable_hash(context.get('lessonId'), options.salt),
    'drillIdHash': _stable_hash(context.get('drillId'), options.salt),
    'promptIdHash': _stable_hash(context.get('promptId'), options.salt),
    'targetPreset': _redact_text(context.get('targetPreset'), 80),
    'targetSource': _redact_text(context.get('targetSource'), 80),
    'referenceClipIdHash': _stable_hash(context.get('referenceClipId'), options.salt),
    'forecastPhrase': _redact_text(context.get('forecastPhrase') or context.get('phrase') or context.get('prompt'), 240),
    'repIndex': context.get('repIndex') if isinstance(context.get('repIndex'), int) else None,
    'takeIndex': context.get('takeIndex') if isinstance(context.get('takeIndex'), int) else None,
    'tags': _redact_string_list(context.get('tags'), 8, 80),
    'activeLine': redacted_active_line,
  }


def _redact_self_report(artifact: VoiceAttemptArtifact) -> dict[str, Any] | None:
  report = _model_payload(artifact.selfReport)
  if not report:
    return None
  return {
    'perceivedDifficulty': report.get('perceivedDifficulty'),
    'effort': report.get('effort'),
    'confidence': report.get('confidence'),
    'strain': report.get('strain'),
    'fatigue': report.get('fatigue'),
    'notes': _redact_text(report.get('notes'), 240),
    'tags': _redact_string_list(report.get('tags'), 8, 80),
  }


def build_voice_attempt_dataset_record(
  artifact: VoiceAttemptArtifact,
  validation: dict[str, Any] | None = None,
  options: VoiceDatasetExportOptions | None = None,
) -> dict[str, Any]:
  resolved_options = options or VoiceDatasetExportOptions()
  resolved_validation = validation or validate_voice_attempt_artifact(artifact, resolved_options)
  record_id = _stable_hash(artifact.attemptArtifactId, resolved_options.salt) or 'unknown'
  split = _split_for_record(record_id, resolved_validation, resolved_options) if resolved_validation.get('datasetReady') else None
  advanced = artifact.metrics.advanced if artifact.metrics is not None else None
  quality = advanced.quality if advanced is not None else None
  formant_lite = advanced.formantLite if advanced is not None else None
  attempt_target = artifact.target

  record = {
    'schemaVersion': VOICE_ATTEMPT_DATASET_SCHEMA_VERSION,
    'recordId': record_id,
    'split': split,
    'source': {
      'attemptArtifactIdHash': record_id,
      'clientAttemptIdHash': _stable_hash(artifact.clientAttemptId, resolved_options.salt),
      'voiceSessionIdHash': _stable_hash(artifact.voiceSessionId, resolved_options.salt),
      'sloaneSessionIdHash': _stable_hash(artifact.sloaneSessionId, resolved_options.salt),
      'createdAt': artifact.createdAt,
      'finalizedAt': artifact.finalizedAt,
      'analysisVersion': artifact.analysisVersion,
      'finalizationAction': artifact.finalizationAction,
    },
    'dataset': {
      'ready': resolved_validation['datasetReady'],
      'trainingReady': resolved_validation['trainingReady'],
      'evaluationReady': resolved_validation['evaluationReady'],
      'allowedUse': resolved_validation['allowedUse'],
      'exclusionReasons': resolved_validation['exclusionReasons'],
      'trainingExclusionReasons': resolved_validation['trainingExclusionReasons'],
      'warnings': resolved_validation['warnings'],
      'redactionVersion': VOICE_ATTEMPT_DATASET_REDACTION_VERSION,
    },
    'repContext': _redact_rep_context(artifact, resolved_options),
    'selfReport': _redact_self_report(artifact),
    'target': {
      'targetPreset': attempt_target.targetPreset if attempt_target is not None else artifact.targetPreset,
      'targetProfileId': attempt_target.targetProfileId if attempt_target is not None else None,
      'source': attempt_target.source if attempt_target is not None else None,
      'direction': attempt_target.direction if attempt_target is not None else None,
      'pitchFloorHz': attempt_target.pitchFloorHz if attempt_target is not None else None,
      'pitchCeilingHz': attempt_target.pitchCeilingHz if attempt_target is not None else None,
      'resonanceFloor': attempt_target.resonanceFloor if attempt_target is not None else None,
      'resonanceCeiling': attempt_target.resonanceCeiling if attempt_target is not None else None,
      'weightFloor': attempt_target.weightFloor if attempt_target is not None else None,
      'weightCeiling': attempt_target.weightCeiling if attempt_target is not None else None,
      'lessonIdHash': _stable_hash(artifact.lessonId, resolved_options.salt),
      'referenceClipIdHash': _stable_hash(artifact.referenceClipId, resolved_options.salt),
    },
    'quality': {
      'durationMs': artifact.durationMs,
      'frameCount': artifact.frameCount,
      'timelineFrameCount': artifact.timelineFrameCount,
      'timelineSampledFrameCount': artifact.timelineSampledFrameCount,
      'timelineCompression': artifact.timelineCompression,
      'voicedFramePct': advanced.voicedFramePct if advanced is not None else None,
      'confidentFramePct': advanced.confidentFramePct if advanced is not None else None,
      'scoreConfidence': advanced.scoreConfidence if advanced is not None else None,
      'reliabilityFlags': list(artifact.reliabilityFlags or []),
      'includesRawAudio': artifact.includesRawAudio,
    },
    'metrics': {
      'meanPitchHz': _artifact_metric_value(artifact, 'meanPitchHz'),
      'pitchRangeSt': _artifact_metric_value(artifact, 'pitchRangeSt'),
      'resonanceMean': _artifact_metric_value(artifact, 'resonanceMean'),
      'weightMean': _artifact_metric_value(artifact, 'weightMean'),
      'targetHitPct': _artifact_metric_value(artifact, 'targetHitPct'),
      'similarityScore': _artifact_metric_value(artifact, 'similarityScore'),
      'pitchP10Hz': advanced.pitchP10Hz if advanced is not None else None,
      'pitchP90Hz': advanced.pitchP90Hz if advanced is not None else None,
      'phraseEndDropHz': advanced.phraseEndDropHz if advanced is not None else None,
      'frontnessScore': formant_lite.frontnessScore if formant_lite is not None else None,
      'breathyRisk': quality.breathyRisk if quality is not None else None,
      'strainRisk': quality.strainRisk if quality is not None else None,
    },
    'labels': {
      'issues': _redact_string_list(artifact.issues, 8, 240),
      'nextDrills': _redact_string_list(artifact.nextDrills, 8, 160),
    },
  }

  if resolved_options.include_transcript:
    record['transcript'] = _redact_text(artifact.transcript, 500)

  return record


def _read_artifact_file(path: Path) -> tuple[VoiceAttemptArtifact | None, str | None]:
  try:
    payload = json.loads(path.read_text(encoding='utf-8'))
  except (OSError, UnicodeDecodeError, json.JSONDecodeError):
    return None, 'invalid_json'
  try:
    return VoiceAttemptArtifact(**payload), None
  except Exception:
    return None, 'invalid_artifact_schema'


def load_voice_attempt_artifacts(storage_root: Path) -> tuple[list[VoiceAttemptArtifact], list[dict[str, Any]]]:
  artifacts: list[VoiceAttemptArtifact] = []
  rejected: list[dict[str, Any]] = []
  attempts_dir = storage_root / 'attempt_artifacts'
  for path in sorted(attempts_dir.glob('*.json')):
    artifact, error = _read_artifact_file(path)
    if artifact is None:
      rejected.append({
        'file': path.name,
        'error': error or 'unknown_error',
      })
      continue
    artifacts.append(artifact)
  return artifacts, rejected


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
  with open(path, 'w', encoding='utf-8') as handle:
    for record in records:
      handle.write(json.dumps(
        sanitize_non_finite(record), ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False,
      ))
      handle.write('\n')


def _count_by(records: list[dict[str, Any]], key_path: tuple[str, ...]) -> dict[str, int]:
  counts: dict[str, int] = {}
  for record in records:
    value: Any = record
    for key in key_path:
      value = value.get(key) if isinstance(value, dict) else None
    if isinstance(value, list):
      values = value or ['none']
    else:
      values = [value or 'none']
    for item in values:
      counts[str(item)] = counts.get(str(item), 0) + 1
  return dict(sorted(counts.items()))


def export_voice_attempt_dataset(
  storage_root: Path | str,
  output_dir: Path | str,
  options: VoiceDatasetExportOptions | None = None,
) -> dict[str, Any]:
  resolved_options = options or VoiceDatasetExportOptions()
  resolved_storage_root = Path(storage_root)
  resolved_output_dir = Path(output_dir)
  resolved_output_dir.mkdir(parents=True, exist_ok=True)

  artifacts, invalid_artifacts = load_voice_attempt_artifacts(resolved_storage_root)
  exported_records: list[dict[str, Any]] = []
  rejected_records: list[dict[str, Any]] = []

  for artifact in artifacts:
    validation = validate_voice_attempt_artifact(artifact, resolved_options)
    record = build_voice_attempt_dataset_record(artifact, validation, resolved_options)
    if validation['datasetReady']:
      exported_records.append(record)
    else:
      rejected_records.append({
        'schemaVersion': VOICE_ATTEMPT_DATASET_SCHEMA_VERSION,
        'recordId': record['recordId'],
        'source': record['source'],
        'dataset': record['dataset'],
      })

  for invalid in invalid_artifacts:
    rejected_records.append({
      'schemaVersion': VOICE_ATTEMPT_DATASET_SCHEMA_VERSION,
      'recordId': None,
      'source': {'file': invalid['file']},
      'dataset': {
        'ready': False,
        'trainingReady': False,
        'evaluationReady': False,
        'allowedUse': {'training': False, 'evaluation': False, 'source': None},
        'exclusionReasons': [invalid['error']],
        'trainingExclusionReasons': [],
        'warnings': [],
        'redactionVersion': VOICE_ATTEMPT_DATASET_REDACTION_VERSION,
      },
    })

  dataset_path = resolved_output_dir / 'voice-attempts.jsonl'
  rejections_path = resolved_output_dir / 'voice-attempt-rejections.jsonl'
  manifest_path = resolved_output_dir / 'manifest.json'

  _write_jsonl(dataset_path, exported_records)
  _write_jsonl(rejections_path, rejected_records)

  manifest = {
    'schemaVersion': VOICE_ATTEMPT_DATASET_SCHEMA_VERSION,
    'redactionVersion': VOICE_ATTEMPT_DATASET_REDACTION_VERSION,
    'createdAt': _utc_now(),
    'storageRoot': str(resolved_storage_root),
    'outputDir': str(resolved_output_dir),
    'files': {
      'dataset': str(dataset_path),
      'rejections': str(rejections_path),
      'manifest': str(manifest_path),
    },
    'options': {
      **asdict(resolved_options),
      'salt': '[redacted]',
    },
    'counts': {
      'totalArtifacts': len(artifacts) + len(invalid_artifacts),
      'validArtifacts': len(artifacts),
      'invalidArtifacts': len(invalid_artifacts),
      'exportedRecords': len(exported_records),
      'rejectedRecords': len(rejected_records),
      'trainingReady': sum(1 for record in exported_records if record['dataset']['trainingReady']),
      'evaluationReady': sum(1 for record in exported_records if record['dataset']['evaluationReady']),
    },
    'breakdown': {
      'splits': _count_by(exported_records, ('split',)),
      'targetPresets': _count_by(exported_records, ('target', 'targetPreset')),
      'analysisVersions': _count_by(exported_records, ('source', 'analysisVersion')),
      'exclusionReasons': _count_by(rejected_records, ('dataset', 'exclusionReasons')),
      'trainingExclusionReasons': _count_by(exported_records + rejected_records, ('dataset', 'trainingExclusionReasons')),
      'warnings': _count_by(exported_records, ('dataset', 'warnings')),
    },
  }

  manifest_path.write_text(
    json.dumps(
      sanitize_non_finite(manifest), indent=2, ensure_ascii=False,
      sort_keys=True, allow_nan=False,
    ),
    encoding='utf-8',
  )
  return manifest


def build_arg_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(description='Export validated SLOANE voice attempt artifacts as JSONL.')
  parser.add_argument('--storage-root', default=str(settings.storage_root), help='VoiceTrainer storage root.')
  parser.add_argument('--output-dir', required=True, help='Directory to write voice-attempts.jsonl and manifest.json.')
  parser.add_argument('--allow-training', action='store_true', help='Operator override allowing exported eligible records for training.')
  parser.add_argument('--allow-eval', action='store_true', help='Operator override allowing exported eligible records for evaluation.')
  parser.add_argument('--consent-source', default=None, help='Consent/source label recorded in exported metadata.')
  parser.add_argument('--salt', default='sloane-voice-attempt-dataset', help='Salt for stable redacted IDs.')
  parser.add_argument('--include-transcript', action='store_true', help='Include redacted transcript text in exported records.')
  parser.add_argument('--min-duration-ms', type=int, default=500)
  parser.add_argument('--min-frame-count', type=int, default=3)
  parser.add_argument('--min-timeline-sampled-frame-count', type=int, default=1)
  parser.add_argument('--min-voiced-frame-pct', type=float, default=0.20)
  parser.add_argument('--min-confident-frame-pct', type=float, default=0.20)
  parser.add_argument('--max-training-strain', type=int, default=3)
  return parser


def main(argv: list[str] | None = None) -> int:
  args = build_arg_parser().parse_args(argv)
  options = VoiceDatasetExportOptions(
    allow_training=args.allow_training,
    allow_evaluation=args.allow_eval,
    consent_source=args.consent_source,
    salt=args.salt,
    min_duration_ms=args.min_duration_ms,
    min_frame_count=args.min_frame_count,
    min_timeline_sampled_frame_count=args.min_timeline_sampled_frame_count,
    min_voiced_frame_pct=args.min_voiced_frame_pct,
    min_confident_frame_pct=args.min_confident_frame_pct,
    max_training_strain=args.max_training_strain,
    include_transcript=args.include_transcript,
  )
  manifest = export_voice_attempt_dataset(args.storage_root, args.output_dir, options)
  print(json.dumps({
    'dataset': manifest['files']['dataset'],
    'manifest': manifest['files']['manifest'],
    'counts': manifest['counts'],
  }, indent=2, sort_keys=True))
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
