from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from src.services.contracts import (
  VOICE_ANALYSIS_VERSION,
  VoiceAttemptAdvancedMetrics,
  VoiceAttemptArtifact,
  VoiceAttemptFormantLiteMetrics,
  VoiceAttemptMetrics,
  VoiceAttemptQualityMetrics,
  VoiceAttemptTarget,
  VoiceRepContext,
  VoiceSelfReport,
)
from src.services.dataset_exporter import (
  VoiceDatasetExportOptions,
  build_voice_attempt_dataset_record,
  export_voice_attempt_dataset,
  validate_voice_attempt_artifact,
)
from src.services.storage import model_to_dict


def build_artifact(**overrides) -> VoiceAttemptArtifact:
  metrics = VoiceAttemptMetrics(
    meanPitchHz=214.0,
    pitchRangeSt=3.4,
    resonanceMean=0.63,
    weightMean=0.42,
    targetHitPct=0.71,
    similarityScore=0.76,
    advanced=VoiceAttemptAdvancedMetrics(
      voicedFramePct=0.86,
      confidentFramePct=0.82,
      scoreConfidence=0.88,
      pitchP10Hz=190.0,
      pitchP90Hz=245.0,
      phraseEndDropHz=4.0,
      quality=VoiceAttemptQualityMetrics(
        breathyRisk=0.18,
        strainRisk=0.12,
      ),
      formantLite=VoiceAttemptFormantLiteMetrics(
        f1MedianHz=650.0,
        f2MedianHz=1850.0,
        frontnessScore=0.71,
        frontnessShift=0.12,
      ),
      reliabilityFlags=[],
    ),
  )
  payload = {
    'attemptArtifactId': 'artifact-1',
    'clientAttemptId': 'client-attempt-1',
    'voiceSessionId': 'voice-session-1',
    'sloaneSessionId': 'sloane-session-secret',
    'lessonId': 'lesson-secret',
    'targetPreset': 'cute-feminine',
    'referenceClipId': 'reference-clip-secret',
    'finalizationAction': 'take',
    'finalizationReason': 'manual take end',
    'sessionCreatedAt': '2026-04-29T01:00:00Z',
    'createdAt': '2026-04-29T01:00:01Z',
    'finalizedAt': '2026-04-29T01:00:02Z',
    'durationMs': 1400,
    'frameCount': 8,
    'timelineFrameCount': 8,
    'timelineSampledFrameCount': 4,
    'timelineCompression': 'sampled:4/8',
    'metrics': metrics,
    'reliabilityFlags': [],
    'issues': ['Keep this private@example.com out of exports.'],
    'nextDrills': ['Short bright phrase loops'],
    'transcript': 'Call me on +1 555 123 4567 after the phrase.',
    'repContext': VoiceRepContext(
      lessonId='lesson-secret',
      targetPreset='cute-feminine',
      targetSource='custom-reference',
      referenceClipId='reference-clip-secret',
      forecastPhrase='hello private@example.com',
      activeLine={
        'id': 'line-secret',
        'intent': 'Practice resonance',
        'teachingFocus': ['resonance', 'light weight'],
      },
    ),
    'selfReport': VoiceSelfReport(
      perceivedDifficulty=3,
      effort=2,
      confidence=4,
      strain=1,
      metadata={'source': 'voice-tab-self-report'},
    ),
    'includesRawAudio': False,
    'analysisVersion': VOICE_ANALYSIS_VERSION,
  }
  payload.update(overrides)
  return VoiceAttemptArtifact(**payload)


class VoiceDatasetExporterTests(unittest.TestCase):
  def test_target_contract_is_preserved_in_dataset_record(self) -> None:
    target = VoiceAttemptTarget(
      source='custom-handmade',
      targetPreset='everyday-feminine',
      targetProfileId='custom-asymmetric',
      direction='feminine',
      pitchFloorHz=121.2345,
      pitchCeilingHz=287.6543,
      resonanceFloor=0.12345,
      resonanceCeiling=0.67891,
      weightFloor=0.23456,
      weightCeiling=0.78912,
    )
    artifact = build_artifact(
      targetPreset='everyday-feminine',
      target=target,
    )

    record = build_voice_attempt_dataset_record(artifact)

    self.assertEqual(record['target']['targetProfileId'], 'custom-asymmetric')
    self.assertEqual(record['target']['source'], 'custom-handmade')
    self.assertEqual(record['target']['direction'], 'feminine')
    self.assertEqual(record['target']['pitchFloorHz'], 121.2345)
    self.assertEqual(record['target']['pitchCeilingHz'], 287.6543)
    self.assertEqual(record['target']['resonanceFloor'], 0.12345)
    self.assertEqual(record['target']['resonanceCeiling'], 0.67891)
    self.assertEqual(record['target']['weightFloor'], 0.23456)
    self.assertEqual(record['target']['weightCeiling'], 0.78912)

  def test_validation_requires_explicit_consent_or_operator_override(self) -> None:
    artifact = build_artifact()

    validation = validate_voice_attempt_artifact(artifact)

    self.assertFalse(validation['datasetReady'])
    self.assertIn('missing_consent', validation['exclusionReasons'])

  def test_export_writes_redacted_jsonl_and_manifest(self) -> None:
    artifact = build_artifact()
    with tempfile.TemporaryDirectory() as temp_dir:
      storage_root = Path(temp_dir) / 'voice-storage'
      attempts_dir = storage_root / 'attempt_artifacts'
      output_dir = Path(temp_dir) / 'dataset'
      attempts_dir.mkdir(parents=True)
      (attempts_dir / 'artifact-1.json').write_text(json.dumps(model_to_dict(artifact)), encoding='utf-8')

      manifest = export_voice_attempt_dataset(
        storage_root,
        output_dir,
        VoiceDatasetExportOptions(
          allow_training=True,
          allow_evaluation=True,
          consent_source='operator_test',
          salt='test-salt',
        ),
      )

      self.assertEqual(manifest['counts']['exportedRecords'], 1)
      self.assertEqual(manifest['counts']['rejectedRecords'], 0)
      dataset_lines = (output_dir / 'voice-attempts.jsonl').read_text(encoding='utf-8').splitlines()
      self.assertEqual(len(dataset_lines), 1)
      record = json.loads(dataset_lines[0])
      serialized = json.dumps(record, sort_keys=True)
      self.assertTrue(record['dataset']['ready'])
      self.assertTrue(record['dataset']['trainingReady'])
      self.assertTrue(record['dataset']['evaluationReady'])
      self.assertEqual(record['dataset']['allowedUse']['source'], 'operator_test')
      self.assertIn('[email]', serialized)
      self.assertNotIn('sloane-session-secret', serialized)
      self.assertNotIn('reference-clip-secret', serialized)
      self.assertTrue((output_dir / 'manifest.json').exists())
      self.assertNotIn('transcript', record)

  def test_transcript_export_is_optional_and_redacted_when_enabled(self) -> None:
    artifact = build_artifact()
    options = VoiceDatasetExportOptions(
      allow_evaluation=True,
      consent_source='operator_test',
      salt='test-salt',
      include_transcript=True,
    )
    validation = validate_voice_attempt_artifact(artifact, options)

    record = build_voice_attempt_dataset_record(artifact, validation, options)

    self.assertEqual(record['transcript'], 'Call me on [phone] after the phrase.')

  def test_metadata_consent_can_allow_eval_without_operator_override(self) -> None:
    artifact = build_artifact(
      selfReport=VoiceSelfReport(
        effort=2,
        strain=1,
        confidence=4,
        metadata={
          'datasetUse': {
            'evaluation': True,
            'source': 'review board 12345678901234567890',
          },
        },
      )
    )

    validation = validate_voice_attempt_artifact(artifact)
    record = build_voice_attempt_dataset_record(artifact, validation)

    self.assertTrue(validation['datasetReady'])
    self.assertFalse(validation['trainingReady'])
    self.assertTrue(validation['evaluationReady'])
    self.assertEqual(record['split'], 'eval')
    self.assertEqual(validation['allowedUse']['source'], 'review board [id]')

  def test_high_strain_remains_eval_ready_but_not_training_ready(self) -> None:
    artifact = build_artifact(selfReport=VoiceSelfReport(effort=4, strain=5, confidence=2))
    options = VoiceDatasetExportOptions(
      allow_training=True,
      allow_evaluation=True,
      consent_source='operator_test',
    )

    validation = validate_voice_attempt_artifact(artifact, options)
    record = build_voice_attempt_dataset_record(artifact, validation, options)

    self.assertTrue(validation['datasetReady'])
    self.assertFalse(validation['trainingReady'])
    self.assertTrue(validation['evaluationReady'])
    self.assertIn('high_strain', validation['warnings'])
    self.assertIn('high_strain', validation['trainingExclusionReasons'])
    self.assertEqual(record['split'], 'eval')

  def test_high_strain_training_only_artifact_is_rejected(self) -> None:
    artifact = build_artifact(selfReport=VoiceSelfReport(effort=5, strain=5, confidence=1))
    options = VoiceDatasetExportOptions(
      allow_training=True,
      allow_evaluation=False,
      consent_source='operator_test',
    )

    validation = validate_voice_attempt_artifact(artifact, options)

    self.assertFalse(validation['datasetReady'])
    self.assertFalse(validation['trainingReady'])
    self.assertFalse(validation['evaluationReady'])
    self.assertIn('training_high_strain', validation['exclusionReasons'])
    self.assertIn('high_strain', validation['trainingExclusionReasons'])

  def test_low_quality_artifact_is_rejected(self) -> None:
    artifact = build_artifact(
      durationMs=120,
      frameCount=1,
      timelineSampledFrameCount=0,
      includesRawAudio=True,
    )
    options = VoiceDatasetExportOptions(
      allow_training=True,
      allow_evaluation=True,
      consent_source='operator_test',
    )

    validation = validate_voice_attempt_artifact(artifact, options)

    self.assertFalse(validation['datasetReady'])
    self.assertIn('too_short', validation['exclusionReasons'])
    self.assertIn('too_few_frames', validation['exclusionReasons'])
    self.assertIn('missing_timeline_sample', validation['exclusionReasons'])
    self.assertIn('raw_audio_present', validation['exclusionReasons'])

  def test_missing_advanced_metrics_is_rejected(self) -> None:
    metrics = VoiceAttemptMetrics(
      meanPitchHz=214.0,
      pitchRangeSt=3.4,
      resonanceMean=0.63,
      weightMean=0.42,
      targetHitPct=0.71,
      similarityScore=0.76,
      advanced=None,
    )
    artifact = build_artifact(metrics=metrics)
    options = VoiceDatasetExportOptions(
      allow_training=True,
      allow_evaluation=True,
      consent_source='operator_test',
    )

    validation = validate_voice_attempt_artifact(artifact, options)

    self.assertFalse(validation['datasetReady'])
    self.assertIn('missing_advanced_metrics', validation['exclusionReasons'])

  def test_critical_root_reliability_flags_are_rejected(self) -> None:
    artifact = build_artifact(reliabilityFlags=['low_confidence'])
    options = VoiceDatasetExportOptions(
      allow_training=True,
      allow_evaluation=True,
      consent_source='operator_test',
    )

    validation = validate_voice_attempt_artifact(artifact, options)

    self.assertFalse(validation['datasetReady'])
    self.assertIn('reliability:low_confidence', validation['exclusionReasons'])

  def test_cli_export_rejects_invalid_artifacts_without_leaking_full_paths(self) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
      storage_root = Path(temp_dir) / 'voice-storage'
      attempts_dir = storage_root / 'attempt_artifacts'
      output_dir = Path(temp_dir) / 'dataset'
      attempts_dir.mkdir(parents=True)
      invalid_path = attempts_dir / 'bad-private-artifact.json'
      invalid_path.write_text('{not json', encoding='utf-8')

      manifest = export_voice_attempt_dataset(
        storage_root,
        output_dir,
        VoiceDatasetExportOptions(
          allow_training=True,
          allow_evaluation=True,
          consent_source='operator_test',
        ),
      )

      self.assertEqual(manifest['counts']['invalidArtifacts'], 1)
      self.assertEqual(manifest['counts']['rejectedRecords'], 1)
      rejected = json.loads((output_dir / 'voice-attempt-rejections.jsonl').read_text(encoding='utf-8'))
      serialized = json.dumps(rejected, sort_keys=True)
      self.assertIn('invalid_json', rejected['dataset']['exclusionReasons'])
      self.assertNotIn(str(invalid_path), serialized)
      self.assertNotIn(temp_dir, serialized)

  def test_export_manifest_breaks_down_splits_rejections_and_warnings(self) -> None:
    clean_artifact = build_artifact(attemptArtifactId='artifact-clean')
    eval_artifact = build_artifact(
      attemptArtifactId='artifact-eval',
      selfReport=VoiceSelfReport(effort=5, strain=5, confidence=1),
    )
    rejected_artifact = build_artifact(
      attemptArtifactId='artifact-rejected',
      durationMs=120,
      reliabilityFlags=['quiet_input'],
    )
    with tempfile.TemporaryDirectory() as temp_dir:
      storage_root = Path(temp_dir) / 'voice-storage'
      attempts_dir = storage_root / 'attempt_artifacts'
      output_dir = Path(temp_dir) / 'dataset'
      attempts_dir.mkdir(parents=True)
      for artifact in (clean_artifact, eval_artifact, rejected_artifact):
        (attempts_dir / f'{artifact.attemptArtifactId}.json').write_text(
          json.dumps(model_to_dict(artifact)),
          encoding='utf-8',
        )

      manifest = export_voice_attempt_dataset(
        storage_root,
        output_dir,
        VoiceDatasetExportOptions(
          allow_training=True,
          allow_evaluation=True,
          consent_source='operator_test',
          salt='test-salt',
        ),
      )

      self.assertEqual(manifest['counts']['totalArtifacts'], 3)
      self.assertEqual(manifest['counts']['exportedRecords'], 2)
      self.assertEqual(manifest['counts']['rejectedRecords'], 1)
      self.assertEqual(manifest['counts']['trainingReady'], 1)
      self.assertEqual(manifest['counts']['evaluationReady'], 2)
      self.assertEqual(manifest['breakdown']['splits']['eval'], 1)
      self.assertGreaterEqual(sum(manifest['breakdown']['splits'].values()), 2)
      self.assertEqual(manifest['breakdown']['exclusionReasons']['too_short'], 1)
      self.assertEqual(manifest['breakdown']['exclusionReasons']['reliability:quiet_input'], 1)
      self.assertEqual(manifest['breakdown']['trainingExclusionReasons']['high_strain'], 1)

  def test_record_ids_are_stable_per_salt_and_change_with_salt(self) -> None:
    artifact = build_artifact()
    validation_a = validate_voice_attempt_artifact(
      artifact,
      VoiceDatasetExportOptions(allow_training=True, consent_source='operator_test', salt='salt-a'),
    )
    record_a = build_voice_attempt_dataset_record(
      artifact,
      validation_a,
      VoiceDatasetExportOptions(allow_training=True, consent_source='operator_test', salt='salt-a'),
    )
    record_a_again = build_voice_attempt_dataset_record(
      artifact,
      validation_a,
      VoiceDatasetExportOptions(allow_training=True, consent_source='operator_test', salt='salt-a'),
    )
    validation_b = validate_voice_attempt_artifact(
      artifact,
      VoiceDatasetExportOptions(allow_training=True, consent_source='operator_test', salt='salt-b'),
    )
    record_b = build_voice_attempt_dataset_record(
      artifact,
      validation_b,
      VoiceDatasetExportOptions(allow_training=True, consent_source='operator_test', salt='salt-b'),
    )

    self.assertEqual(record_a['recordId'], record_a_again['recordId'])
    self.assertNotEqual(record_a['recordId'], record_b['recordId'])


if __name__ == '__main__':
  unittest.main()
