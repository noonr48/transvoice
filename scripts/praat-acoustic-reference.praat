form Current Praat acoustic reference
    sentence wav_path
endform

sound = Read from file: wav_path$
selectObject: sound
duration = Get total duration
sampleRate = Get sampling frequency

pitch = To Pitch (raw autocorrelation): 0.01, 80, 400, 15, "off", 0.03, 0.45, 0.01, 0.35, 0.14
selectObject: pitch
pitchMean = Get mean: 0, 0, "Hertz"
pitchMedian = Get quantile: 0, 0, 0.5, "Hertz"
pitchP10 = Get quantile: 0, 0, 0.1, "Hertz"
pitchP90 = Get quantile: 0, 0, 0.9, "Hertz"

selectObject: sound
harmonicity = To Harmonicity (ac): 0.01, 80, 0.1, 4.5
selectObject: harmonicity
hnrMean = Get mean: 0, 0

selectObject: sound
powerCepstrogram = To PowerCepstrogram: 60, 0.002, 5000, 50
selectObject: powerCepstrogram
cpps = Get CPPS: "no", 0.01, 0.0001, 60, 333.3, 0.05, "Parabolic", 0.001, 0.05, "Straight", "Robust slow"

writeInfoLine: "duration_s", tab$, duration
appendInfoLine: "sample_rate", tab$, sampleRate
appendInfoLine: "pitch_mean_hz", tab$, pitchMean
appendInfoLine: "pitch_median_hz", tab$, pitchMedian
appendInfoLine: "pitch_p10_hz", tab$, pitchP10
appendInfoLine: "pitch_p90_hz", tab$, pitchP90
appendInfoLine: "hnr_mean_db", tab$, hnrMean
appendInfoLine: "cpps_db", tab$, cpps
