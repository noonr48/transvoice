#!/usr/bin/env python3
"""
Praat vs VoiceTrainer acoustic analysis engineering validation.

Runs Praat and VoiceTrainer on the same WAV file and compares pitch, formants,
HNR, jitter, shimmer, and CPPS. This is a known-answer engineering oracle, not
clinical or perceptual validation of gender, safety, or voice quality.

Usage:
    python validate-acoustic-analysis.py <wav_file> [--voicetrainer-root PATH]
                                              [--praat-binary PATH]
                                              [--output PATH] [--strict]

Environment:
    VOICETRAINER_ROOT  Override the VoiceTrainer install path
                       (default: <repo>/VoiceTrainer next to this script)
"""

import json
import argparse
import os
import subprocess
import sys
import numpy as np
import parselmouth
from pathlib import Path

# ─── Praat Analysis ───────────────────────────────────────────────────────────


def finite_round(value, digits: int) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    return round(numeric, digits) if np.isfinite(numeric) else None


def praat_analyze(wav_path: str) -> dict:
    """Run the frozen Parselmouth/Praat continuity lane on a WAV file."""
    snd = parselmouth.Sound(wav_path)
    duration = snd.get_total_duration()
    sr = snd.sampling_frequency

    # Match VoiceTrainer's supported F0 contract rather than allowing octave
    # candidates that VoiceTrainer intentionally rejects.
    pitch = snd.to_pitch_ac(
        time_step=0.01,
        pitch_floor=80.0,
        pitch_ceiling=400.0,
    )
    pitch_values = pitch.selected_array["frequency"]
    voiced_pitch = pitch_values[pitch_values > 0]

    # Formant analysis (Burg method, 5 formants, 5500 Hz ceiling for 16kHz)
    formant = snd.to_formant_burg(
        time_step=0.01,
        max_number_of_formants=5.0,
        maximum_formant=5500.0,
        window_length=0.025,
        pre_emphasis_from=50.0,
    )

    # Sample formants only where the pitch lane says the frame is voiced. Burg
    # will otherwise return plausible-looking poles for silence/frication,
    # which makes whole-file medians an invalid comparison to VoiceTrainer's
    # voiced-window formant analysis.
    f1_values = []
    f2_values = []
    n_samples = int(duration / 0.01)
    for i in range(n_samples):
        t = i * 0.01
        pitch_at_time = pitch.get_value_at_time(t)
        if not np.isfinite(pitch_at_time) or pitch_at_time <= 0:
            continue
        f1 = formant.get_value_at_time(1, t)
        f2 = formant.get_value_at_time(2, t)
        if not np.isnan(f1) and f1 > 0:
            f1_values.append(f1)
        if not np.isnan(f2) and f2 > 0:
            f2_values.append(f2)

    # Harmonicity (HNR) — autocorrelation method
    harmonicity = snd.to_harmonicity_ac(
        time_step=0.01,
        minimum_pitch=80.0,
        silence_threshold=0.1,
        periods_per_window=4.5,
    )
    # harmonicity.values is (1, n_frames) array
    hnr_all = harmonicity.values[0]
    hnr_values = hnr_all[np.isfinite(hnr_all) & (hnr_all > -199.0)]

    # Point process for jitter and shimmer (needs pitch)
    try:
        point_process = parselmouth.praat.call(
            snd, "To PointProcess (periodic, cc)", 80.0, 400.0
        )

        # Jitter (local, 0.0001-0.02s periods)
        jitter_local = parselmouth.praat.call(
            point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3
        )
        jitter_rap = parselmouth.praat.call(
            point_process, "Get jitter (rap)", 0, 0, 0.0001, 0.02, 1.3
        )
        jitter_ppq5 = parselmouth.praat.call(
            point_process, "Get jitter (ppq5)", 0, 0, 0.0001, 0.02, 1.3
        )

        # Shimmer (local, 0.0001-0.02s periods)
        shimmer_local = parselmouth.praat.call(
            [snd, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6
        )
        shimmer_apq3 = parselmouth.praat.call(
            [snd, point_process], "Get shimmer (apq3)", 0, 0, 0.0001, 0.02, 1.3, 1.6
        )
        shimmer_apq5 = parselmouth.praat.call(
            [snd, point_process], "Get shimmer (apq5)", 0, 0, 0.0001, 0.02, 1.3, 1.6
        )
    except Exception as e:
        jitter_local = jitter_rap = jitter_ppq5 = None
        shimmer_local = shimmer_apq3 = shimmer_apq5 = None

    # CPPS (via custom cepstral analysis)
    cpps = _praat_cpps(snd)

    return {
        "duration_s": round(duration, 3),
        "sample_rate": int(sr),
        "pitch": {
            "mean_hz": round(float(np.mean(voiced_pitch)), 2)
            if len(voiced_pitch) > 0
            else None,
            "median_hz": round(float(np.median(voiced_pitch)), 2)
            if len(voiced_pitch) > 0
            else None,
            "std_hz": round(float(np.std(voiced_pitch)), 2)
            if len(voiced_pitch) > 0
            else None,
            "p10_hz": round(float(np.percentile(voiced_pitch, 10)), 2)
            if len(voiced_pitch) > 0
            else None,
            "p90_hz": round(float(np.percentile(voiced_pitch, 90)), 2)
            if len(voiced_pitch) > 0
            else None,
            "voiced_frames": int(len(voiced_pitch)),
            "total_frames": int(len(pitch_values)),
            "voiced_pct": round(len(voiced_pitch) / max(len(pitch_values), 1), 3),
        },
        "formants": {
            "f1_median_hz": round(float(np.median(f1_values)), 2)
            if f1_values
            else None,
            "f1_mean_hz": round(float(np.mean(f1_values)), 2) if f1_values else None,
            "f2_median_hz": round(float(np.median(f2_values)), 2)
            if f2_values
            else None,
            "f2_mean_hz": round(float(np.mean(f2_values)), 2) if f2_values else None,
            "f1_count": len(f1_values),
            "f2_count": len(f2_values),
        },
        "hnr": {
            "mean_db": round(float(np.mean(hnr_values)), 2)
            if len(hnr_values) > 0
            else None,
            "median_db": round(float(np.median(hnr_values)), 2)
            if len(hnr_values) > 0
            else None,
            "voiced_frames": int(len(hnr_values)),
        },
        "jitter": {
            "local": finite_round(jitter_local, 6),
            "rap": finite_round(jitter_rap, 6),
            "ppq5": finite_round(jitter_ppq5, 6),
        },
        "shimmer": {
            "local": finite_round(shimmer_local, 6),
            "apq3": finite_round(shimmer_apq3, 6),
            "apq5": finite_round(shimmer_apq5, 6),
        },
        "cpps": cpps,
    }


def _praat_cpps(snd) -> dict:
    """Compute CPPS using Praat's cepstral analysis."""
    try:
        # Use Praat's built-in CPPS computation
        # To PowerCepstrogram: time_step=0.002, pitch_floor=60, pre-emphasis_from=50
        power_cepstrogram = parselmouth.praat.call(
            snd, "To PowerCepstrogram", 60, 0.002, 5000, 50
        )
        # Get CPPS (peak prominence)
        cpps = parselmouth.praat.call(
            power_cepstrogram,
            "Get CPPS",
            "no",
            0.01,
            0.0001,
            60,
            333.3,
            0.05,
            "Parabolic",
            0.001,
            0.05,
            "Straight",
            "Robust",
        )
        return {
            "cpps_db": round(float(cpps), 2),
            "method": "praat_power_cepstrogram",
        }
    except Exception as e:
        return {
            "cpps_db": None,
            "method": "failed",
            "error": str(e),
        }


def current_praat_analyze(wav_path: str, praat_binary: Path) -> dict:
    """Run the installed current Praat binary through the checked-in script."""
    binary = praat_binary.expanduser().resolve()
    if not binary.is_file():
        raise FileNotFoundError(f"Praat binary not found: {binary}")
    script_path = Path(__file__).with_name("praat-acoustic-reference.praat").resolve()
    command = [
        str(binary),
        "--run",
        "--no-pref-files",
        "--no-plugins",
        str(script_path),
        str(Path(wav_path).resolve()),
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    values: dict[str, float | None] = {}
    for line in completed.stdout.splitlines():
        key, separator, raw_value = line.partition("\t")
        if not separator:
            continue
        try:
            numeric = float(raw_value.strip())
            values[key.strip()] = numeric if np.isfinite(numeric) else None
        except ValueError:
            values[key.strip()] = None
    version = subprocess.run(
        [str(binary), "--version"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    required = ["duration_s", "sample_rate"]
    missing = [key for key in required if values.get(key) is None]
    if missing:
        raise RuntimeError(f"Current Praat output missing: {', '.join(missing)}")
    def rounded_optional(key: str) -> float | None:
        value = values.get(key)
        return round(float(value), 2) if value is not None else None

    return {
        "runtime": {
            "lane": "current-praat-cli",
            "version": version,
            "binary": str(binary),
            "script": str(script_path),
        },
        "duration_s": round(float(values["duration_s"]), 3),
        "sample_rate": int(values["sample_rate"]),
        "pitch": {
            "mean_hz": rounded_optional("pitch_mean_hz"),
            "median_hz": rounded_optional("pitch_median_hz"),
            "p10_hz": rounded_optional("pitch_p10_hz"),
            "p90_hz": rounded_optional("pitch_p90_hz"),
        },
        "hnr": {"mean_db": rounded_optional("hnr_mean_db")},
        "cpps": {
            "cpps_db": rounded_optional("cpps_db"),
            "method": "current_praat_power_cepstrogram",
        },
    }


def merge_praat_lanes(frozen: dict, current: dict | None) -> dict:
    """Use current Praat for shared metrics; keep Parselmouth for continuity."""
    merged = json.loads(json.dumps(frozen))
    merged["runtime"] = {
        "lane": "parselmouth-continuity",
        "parselmouthVersion": parselmouth.__version__,
        "embeddedPraatVersion": getattr(parselmouth, "PRAAT_VERSION", None),
        "embeddedPraatDate": getattr(parselmouth, "PRAAT_VERSION_DATE", None),
        "authority": "frozen-continuity-only" if current is None else "current-praat-cli-with-frozen-supplement",
    }
    if current is None:
        return merged
    merged["currentPraat"] = current["runtime"]
    for key in ("mean_hz", "median_hz", "p10_hz", "p90_hz"):
        merged["pitch"][key] = current["pitch"][key]
    merged["hnr"]["mean_db"] = (
        current["hnr"]["mean_db"]
        if merged["pitch"].get("voiced_frames", 0) > 0
        else None
    )
    merged["cpps"] = current["cpps"]
    return merged


# ─── VoiceTrainer Analysis ────────────────────────────────────────────────────


def voicetrainer_analyze(wav_path: str, vt_root: Path | None = None) -> dict:
    """Run VoiceTrainer analysis by importing its audio_analysis module.

    Resolution order for the VoiceTrainer root:
      1. Explicit ``vt_root`` argument (from --voicetrainer-root flag)
      2. ``VOICETRAINER_ROOT`` environment variable
      3. Vendored copy: ``<app>/services/voice-trainer`` (the independent app
         ships its own DSP service code)
      4. Fallback: sibling ``<repo_root>/VoiceTrainer`` checkout
    """
    import importlib.util

    if vt_root is None:
        env_root = os.environ.get("VOICETRAINER_ROOT")
        if env_root:
            vt_root = Path(env_root)
        else:
            app_root = Path(__file__).resolve().parent.parent
            vendored = app_root / "services" / "voice-trainer"
            if (vendored / "src" / "services" / "audio_analysis.py").exists():
                vt_root = vendored
            else:
                # Fallback: sibling VoiceTrainer checkout next to the app dir.
                vt_root = app_root.parent / "VoiceTrainer"
    vt_path = vt_root / "src" / "services" / "audio_analysis.py"
    if not vt_path.exists():
        return {"error": f"VoiceTrainer not found at {vt_path}"}

    # Add VoiceTrainer root to sys.path so 'src.services.contracts' resolves
    sys.path.insert(0, str(vt_root))
    try:
        import src.services.audio_analysis as mod
    finally:
        sys.path.pop(0)

    # Load audio
    import soundfile as sf

    samples, sr = sf.read(wav_path, dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)

    # Resample to 16kHz if needed
    if sr != 16000:
        from scipy.signal import resample

        target_len = int(len(samples) * 16000 / sr)
        samples = resample(samples, target_len).astype(np.float32)
        sr = 16000

    # Use the same 30 ms / 10 ms offline analysis resolution as finalized takes,
    # not the coarse 64 ms non-overlapping live-display timeline.
    timeline = mod.build_timeline_from_samples(
        samples,
        "cute-feminine",
        sample_rate=sr,
        frame_size=mod.ANALYSIS_FRAME_SIZE,
        hop_size=mod.ANALYSIS_HOP_SIZE,
    )

    # Get per-frame metrics
    frames = []
    for frame in timeline:
        if frame.voiced and frame.pitchHz and frame.pitchHz > 0:
            frames.append(
                {
                    "pitch_hz": frame.pitchHz,
                    "resonance": frame.resonanceScore,
                    "weight": frame.weightScore,
                }
            )

    # Get formant and quality metrics from raw samples
    formant_result = None
    quality_result = None
    if len(samples) > 0:
        # Sample analysis windows
        windows = mod._sample_analysis_windows(
            samples,
            timeline,
            sr,
            frame_size=mod.ANALYSIS_FRAME_SIZE,
            max_windows=48,
        )
        if windows:
            f1_values = []
            f2_values = []
            cpps_values = []
            for _frame, win in windows:
                if len(win) < 320:
                    continue
                f1, f2 = mod._estimate_lpc_formants(win, sr)
                if f1:
                    f1_values.append(f1)
                if f2:
                    f2_values.append(f2)
                cpps_val = mod._cpps_like(win, sr)
                if cpps_val > 0:
                    cpps_values.append(cpps_val)

            formant_result = {
                "f1_median_hz": round(float(np.median(f1_values)), 2)
                if f1_values
                else None,
                "f1_mean_hz": round(float(np.mean(f1_values)), 2)
                if f1_values
                else None,
                "f2_median_hz": round(float(np.median(f2_values)), 2)
                if f2_values
                else None,
                "f2_mean_hz": round(float(np.mean(f2_values)), 2)
                if f2_values
                else None,
                "f1_count": len(f1_values),
                "f2_count": len(f2_values),
            }
            quality_result = {
                "cpps_like_mean": round(float(np.mean(cpps_values)), 2)
                if cpps_values
                else None,
                "cpps_like_count": len(cpps_values),
            }

    # Use the public finalized-summary path so the harness exercises the same
    # reanalysis and validity contract as a real take.
    summary = mod.build_attempt_summary(
        voice_session_id="validation-session",
        target_preset="cute-feminine",
        timeline=timeline,
        duration_ms=int(round(len(samples) * 1000 / sr)),
        raw_samples=samples,
        sample_rate=sr,
    )
    attempt = summary.metrics
    adv = attempt.advanced
    quality = adv.quality if adv else None
    formant_lite = adv.formantLite if adv else None

    pitch_values = [f["pitch_hz"] for f in frames]
    voiced_pct = len(frames) / max(len(timeline), 1)

    measurement_available = bool(adv and adv.measurementAvailable)
    return {
        "duration_s": round(len(samples) / sr, 3),
        "sample_rate": sr,
        "pitch": {
            "mean_hz": round(float(np.mean(pitch_values)), 2) if pitch_values else None,
            "median_hz": round(float(adv.medianPitchHz), 2)
            if measurement_available and adv.medianPitchHz
            else None,
            "std_hz": round(float(adv.pitchStdSt), 2)
            if adv and adv.pitchStdSt
            else None,
            "p10_hz": round(float(adv.pitchP10Hz), 2)
            if measurement_available and adv.pitchP10Hz
            else None,
            "p90_hz": round(float(adv.pitchP90Hz), 2)
            if measurement_available and adv.pitchP90Hz
            else None,
            "voiced_frames": len(frames),
            "total_frames": len(timeline),
            "voiced_pct": round(voiced_pct, 3),
        },
        "formants": formant_result or {},
        "advanced": {
            "measurement_available": adv.measurementAvailable if adv else False,
            "measurement_rejection_reasons": adv.measurementRejectionReasons if adv else ["no_advanced_metrics"],
            "pitch_valid_frame_count": adv.pitchValidFrameCount if adv else 0,
            "hnr_valid_frame_count": adv.hnrValidFrameCount if adv else 0,
            "hnr_voiced_coverage_pct": adv.hnrVoicedCoveragePct if adv else 0,
            "spectral_centroid_mean_hz": round(float(adv.spectralCentroidMeanHz), 2)
            if adv and adv.spectralCentroidMeanHz is not None else None,
            "spectral_tilt_mean_db_per_oct": round(float(adv.spectralTiltMeanDbPerOct), 2)
            if adv and adv.spectralTiltMeanDbPerOct is not None else None,
            "harmonic_ratio_mean": round(float(adv.harmonicRatioMean), 4)
            if adv and adv.harmonicRatioMean is not None else None,
            "stability_mean": round(float(adv.stabilityMean), 4)
            if adv and adv.stabilityMean is not None else None,
        },
        "quality": {
            "cpps_like": round(float(quality.cppsLike), 2)
            if quality and quality.cppsLike is not None else None,
            "hnr_like": round(float(quality.harmonicStrength), 2)
            if quality and quality.harmonicStrength is not None else None,
            "breathy_risk": round(float(quality.breathyRisk), 4)
            if quality and quality.breathyRisk is not None else None,
            "strain_risk": round(float(quality.strainRisk), 4)
            if quality and quality.strainRisk is not None else None,
            "jitter_local": round(float(quality.jitterLocal or 0), 5)
            if quality and quality.jitterLocal
            else None,
            "jitter_rap": round(float(quality.jitterRap or 0), 5)
            if quality and quality.jitterRap
            else None,
            "jitter_ppq5": round(float(quality.jitterPpq5 or 0), 5)
            if quality and quality.jitterPpq5
            else None,
            "shimmer_local": round(float(quality.shimmerLocal or 0), 5)
            if quality and quality.shimmerLocal
            else None,
            "shimmer_apq3": round(float(quality.shimmerApq3 or 0), 5)
            if quality and quality.shimmerApq3
            else None,
            "shimmer_apq5": round(float(quality.shimmerApq5 or 0), 5)
            if quality and quality.shimmerApq5
            else None,
        },
        "formant_lite": {
            "f1_median_hz": round(float(formant_lite.f1MedianHz), 2)
            if formant_lite and formant_lite.f1MedianHz
            else None,
            "f2_median_hz": round(float(formant_lite.f2MedianHz), 2)
            if formant_lite and formant_lite.f2MedianHz
            else None,
            "frontness_score": round(float(formant_lite.frontnessScore), 4)
            if formant_lite and formant_lite.frontnessScore is not None
            else None,
        },
    }


# ─── Comparison ───────────────────────────────────────────────────────────────


def compare(praat: dict, vt: dict) -> dict:
    """Compare Praat and VoiceTrainer results."""
    comparisons = []

    def add_cmp(metric, praat_val, vt_val, unit="", tolerance_pct=10):
        if praat_val is None or vt_val is None:
            status = "SKIP"
            diff_pct = None
        else:
            diff = abs(praat_val - vt_val)
            base = max(abs(praat_val), abs(vt_val), 1e-6)
            diff_pct = (diff / base) * 100
            status = (
                "PASS"
                if diff_pct <= tolerance_pct
                else "WARN"
                if diff_pct <= 25
                else "FAIL"
            )
        comparisons.append(
            {
                "metric": metric,
                "praat": praat_val,
                "voicetrainer": vt_val,
                "unit": unit,
                "diff_pct": round(diff_pct, 1) if diff_pct is not None else None,
                "status": status,
            }
        )

    # Pitch
    add_cmp(
        "pitch_mean_hz", praat["pitch"]["mean_hz"], vt["pitch"]["mean_hz"], "Hz", 10
    )
    add_cmp(
        "pitch_median_hz",
        praat["pitch"]["median_hz"],
        vt["pitch"]["median_hz"],
        "Hz",
        10,
    )
    add_cmp(
        "voiced_pct", praat["pitch"]["voiced_pct"], vt["pitch"]["voiced_pct"], "%", 15
    )

    # Formants
    add_cmp(
        "f1_median_hz",
        praat["formants"]["f1_median_hz"],
        vt.get("formant_lite", {}).get("f1_median_hz")
        or vt.get("formants", {}).get("f1_median_hz"),
        "Hz",
        15,
    )
    add_cmp(
        "f2_median_hz",
        praat["formants"]["f2_median_hz"],
        vt.get("formant_lite", {}).get("f2_median_hz")
        or vt.get("formants", {}).get("f2_median_hz"),
        "Hz",
        15,
    )

    # HNR (Praat true HNR vs VoiceTrainer harmonicStrength)
    add_cmp("hnr_db", praat["hnr"]["mean_db"], vt["quality"]["hnr_like"], "dB", 25)

    # CPPS
    add_cmp("cpps_db", praat["cpps"]["cpps_db"], vt["quality"]["cpps_like"], "dB", 30)

    # Jitter (Praat vs VoiceTrainer)
    jitter_praat = praat["jitter"]["local"]
    jitter_vt = vt["quality"].get("jitter_local")
    if jitter_vt is not None and jitter_praat is not None:
        add_cmp("jitter_local", jitter_praat, jitter_vt, "", 50)

    # Shimmer (Praat vs VoiceTrainer)
    shimmer_praat = praat["shimmer"]["local"]
    shimmer_vt = vt["quality"].get("shimmer_local")
    if shimmer_vt is not None and shimmer_praat is not None:
        add_cmp("shimmer_local", shimmer_praat, shimmer_vt, "", 50)

    return {
        "comparisons": comparisons,
        "praat_only": {
            "jitter_local": jitter_praat,
            "shimmer_local": shimmer_praat,
        },
        "summary": {
            "total": len(comparisons),
            "pass": sum(1 for c in comparisons if c["status"] == "PASS"),
            "warn": sum(1 for c in comparisons if c["status"] == "WARN"),
            "fail": sum(1 for c in comparisons if c["status"] == "FAIL"),
            "skip": sum(1 for c in comparisons if c["status"] == "SKIP"),
        },
    }


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Validate VoiceTrainer acoustic analysis against version-witnessed Praat reference lanes."
    )
    parser.add_argument(
        "wav_path",
        help="Path to a WAV file to analyze",
    )
    parser.add_argument(
        "--voicetrainer-root",
        type=Path,
        default=None,
        help="Path to the VoiceTrainer install (default: $VOICETRAINER_ROOT or <repo>/VoiceTrainer)",
    )
    parser.add_argument(
        "--praat-binary",
        type=Path,
        default=Path(os.environ["PRAAT_BINARY"]) if os.environ.get("PRAAT_BINARY") else None,
        help="Current Praat CLI binary. When supplied, shared metrics come from this version-witnessed lane.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional JSON receipt path. No file is written unless this is supplied.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with non-zero status on WARN rows in addition to FAIL rows",
    )
    args = parser.parse_args()

    wav_path = args.wav_path
    if not Path(wav_path).exists():
        print(f"File not found: {wav_path}")
        sys.exit(1)

    print(f"Analyzing: {wav_path}")
    print()

    # Run both analyzers
    print("Running frozen Parselmouth/Praat continuity analysis...")
    frozen_praat_results = praat_analyze(wav_path)
    current_praat_results = None
    if args.praat_binary is not None:
        print(f"Running current Praat CLI analysis ({args.praat_binary})...")
        try:
            current_praat_results = current_praat_analyze(wav_path, args.praat_binary)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            print(f"Current Praat error: {error}")
            sys.exit(1)
    praat_results = merge_praat_lanes(frozen_praat_results, current_praat_results)

    print("Running VoiceTrainer analysis...")
    vt_results = voicetrainer_analyze(wav_path, vt_root=args.voicetrainer_root)

    if "error" in vt_results:
        print(f"VoiceTrainer error: {vt_results['error']}")
        sys.exit(1)

    # Compare
    comparison = compare(praat_results, vt_results)

    # Print results
    print()
    print("=" * 80)
    print("PRAAT REFERENCE")
    print("=" * 80)
    runtime = praat_results.get("runtime", {})
    print(
        f"  Lane: {runtime.get('authority')} | embedded Praat: {runtime.get('embeddedPraatVersion')}"
    )
    if praat_results.get("currentPraat"):
        print(f"  Current lane: {praat_results['currentPraat'].get('version')}")
    print(
        f"  Duration: {praat_results['duration_s']}s | Sample rate: {praat_results['sample_rate']}Hz"
    )
    print(
        f"  Pitch: mean={praat_results['pitch']['mean_hz']}Hz, median={praat_results['pitch']['median_hz']}Hz, std={praat_results['pitch']['std_hz']}Hz"
    )
    print(
        f"  Voiced: {praat_results['pitch']['voiced_frames']}/{praat_results['pitch']['total_frames']} frames ({praat_results['pitch']['voiced_pct'] * 100:.1f}%)"
    )
    print(
        f"  F1: median={praat_results['formants']['f1_median_hz']}Hz, mean={praat_results['formants']['f1_mean_hz']}Hz"
    )
    print(
        f"  F2: median={praat_results['formants']['f2_median_hz']}Hz, mean={praat_results['formants']['f2_mean_hz']}Hz"
    )
    print(
        f"  HNR: mean={praat_results['hnr']['mean_db']}dB, median={praat_results['hnr']['median_db']}dB"
    )
    print(
        f"  Jitter: local={praat_results['jitter']['local']}, RAP={praat_results['jitter']['rap']}, PPQ5={praat_results['jitter']['ppq5']}"
    )
    print(
        f"  Shimmer: local={praat_results['shimmer']['local']}, APQ3={praat_results['shimmer']['apq3']}, APQ5={praat_results['shimmer']['apq5']}"
    )
    print(
        f"  CPPS: {praat_results['cpps']['cpps_db']}dB ({praat_results['cpps']['method']})"
    )

    print()
    print("=" * 80)
    print("VOICE TRAINER")
    print("=" * 80)
    print(
        f"  Duration: {vt_results['duration_s']}s | Sample rate: {vt_results['sample_rate']}Hz"
    )
    print(
        f"  Pitch: mean={vt_results['pitch']['mean_hz']}Hz, median={vt_results['pitch']['median_hz']}Hz"
    )
    print(
        f"  Voiced: {vt_results['pitch']['voiced_frames']}/{vt_results['pitch']['total_frames']} frames ({vt_results['pitch']['voiced_pct'] * 100:.1f}%)"
    )
    fl = vt_results.get("formant_lite", {})
    print(f"  F1: median={fl.get('f1_median_hz')}Hz")
    print(f"  F2: median={fl.get('f2_median_hz')}Hz")
    print(f"  Frontness: {fl.get('frontness_score')}")
    q = vt_results["quality"]
    print(f"  Harmonic-strength: {q['hnr_like']}dB | CPPS-like: {q['cpps_like']}dB")
    print(f"  Breathy risk: {q['breathy_risk']} | Strain risk: {q['strain_risk']}")
    a = vt_results["advanced"]
    print(
        f"  Measurement available: {a['measurement_available']} | rejection reasons: {a['measurement_rejection_reasons']}"
    )
    print(
        f"  Spectral centroid: {a['spectral_centroid_mean_hz']}Hz | Tilt: {a['spectral_tilt_mean_db_per_oct']}dB/oct"
    )
    print(
        f"  Harmonic ratio: {a['harmonic_ratio_mean']} | Stability: {a['stability_mean']}"
    )

    print()
    print("=" * 80)
    print("COMPARISON")
    print("=" * 80)
    for c in comparison["comparisons"]:
        icon = {"PASS": "✓", "WARN": "⚠", "FAIL": "✗", "SKIP": "○"}[c["status"]]
        praat_str = f"{c['praat']}" if c["praat"] is not None else "N/A"
        vt_str = f"{c['voicetrainer']}" if c["voicetrainer"] is not None else "N/A"
        diff_str = f"{c['diff_pct']:.1f}%" if c["diff_pct"] is not None else ""
        print(
            f"  {icon} {c['metric']:30s}  Praat={praat_str:>10s}  VT={vt_str:>10s}  Diff={diff_str:>8s}  [{c['status']}]"
        )

    print()
    s = comparison["summary"]
    print(
        f"  Summary: {s['pass']} PASS, {s['warn']} WARN, {s['fail']} FAIL, {s['skip']} SKIP out of {s['total']}"
    )

    # Praat-only metrics
    po = comparison["praat_only"]
    print()
    print("  Praat-only (VoiceTrainer does not compute):")
    print(f"    Jitter (local): {po['jitter_local']}")
    print(f"    Shimmer (local): {po['shimmer_local']}")

    receipt = {
        "scope": "engineering-known-answer-only",
        "limitations": [
            "not clinical validation",
            "not perceptual gender validation",
            "not device or microphone calibration",
            "jitter and shimmer at 16 kHz are continuity diagnostics only",
        ],
        "praat": praat_results,
        "voicetrainer": vt_results,
        "comparison": comparison,
    }
    if args.output is not None:
        output_path = args.output.expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as output_file:
            json.dump(receipt, output_file, indent=2)
            output_file.write("\n")
        print(f"\nFull results saved to: {output_path}")
    else:
        print("\nNo JSON written (use --output PATH for a durable receipt).")

    # Exit code:
    #   0  → all PASS / SKIP, or only WARN rows (and not --strict)
    #   2  → at least one FAIL row
    #   3  → --strict and at least one WARN row
    s = comparison["summary"]
    if s["fail"] > 0:
        sys.exit(2)
    if args.strict and s["warn"] > 0:
        sys.exit(3)
    sys.exit(0)


if __name__ == "__main__":
    main()
