# Quantization & Calibration — the standing calibrator for every voice-tutor quant

*2026-06-11. Why the teacher (and every future deploy quant) is an
imatrix-calibrated IQ4_NL, what the calibrator contains, and how to rebuild it.
Companion to V3-DATASET-SPEC.md (the corpus this calibrates against).*

## Rulings

1. **Never quantize the KV cache for teacher generation.** The teacher fleet
   serves with explicit `-ctk f16 -ctv f16`. (2026-06-11 user ruling. Audit
   note: the prior Q8_0 fleet already ran f16 KV — no `-ctk/-ctv` flags, f16
   is llama.cpp's default — but the explicit flags make the ruling visible in
   `ps` output and survive future flag-default changes.)
2. **Weights: plain imatrix-calibrated IQ4_NL — no manual tensor promotion.**
   Evidence (0p34 DECKARD-e4b evaluation, 2026-06-09): calibrated IQ4_NL
   scored statistically identical to Q8_0 on the full voice-coaching benchmark
   (76.98±2.96 vs 77.62±2.99), so promotion has no headroom to recover — and
   BROAD promotion of high-importance gating/attn tensors actively crashed
   direction-correctness (bidi 99.3→80). The imatrix improves rounding within
   the chosen type; the type's own static mixture already keeps norms f32,
   embed/output Q6_K, attn_v q5_K.
3. **Quality gate before swap:** perplexity A/B on the disjoint domain holdout
   — ship IQ4_NL if ΔPPL vs Q8_0 ≤ ~4%. Fallback ladder if it fails:
   Q5_K_M → IQ4_NL+attnQ8last6 → keep Q8_0 on the big GPUs only.

## Why IQ4_NL for the teacher at all

Decode is memory-bandwidth-bound: halving weight bytes (~12.4G Q8_0 → ~6.5G
IQ4_NL) roughly doubles per-instance decode speed, which directly multiplies
campaign throughput across the 10-instance fleet — while the e4b evidence says
the calibrated quant sits at the Q8 quality ceiling for exactly this domain.
The freed VRAM also lets every instance (including the 16G 5060 Tis) run
uniform `-c 16384 -np 2` with full-f16 KV instead of the old split
(16384 on big GPUs / 4096 on small).

## The calibrator (the part designed "for our goal")

The imatrix calibration corpus must exercise the activation paths the tutor
actually uses, so the quantizer spends its error budget where the product
lives. Composition (`render_calib_v3.py`, seed 42, domain-only):

| Slice | Records | Covers |
|---|---|---|
| v2-filtered corpus sample | 1,600 | base competence: 9 v2 modes, bidirectional MTF/FTM, signal-grounded cues, Hz-grounding |
| v3.1 corpus, stratified ≤130/mode | ~1,100 | the new contracts: ```card-ops``` and ```remember-ops``` trailing fenced blocks, signal JSON snapshots, situation-room scenes, multi-day-arc greetings, persistence, memory-write restraint |

- Rendered through the **merged model's own chat template**
  (`apply_chat_template`, fold-system fallback) so `<start_of_turn>` special
  tokens and the fence-token sequences are part of the measured activations —
  these are precisely the tokens the runtime parses mechanically, where quant
  damage would be costliest.
- **Domain-only on purpose**: the deployed tutor and the teacher only ever do
  this task; the prior pure-domain calibrator (calib_v2_0p34) carried IQ4_NL
  to the Q8 ceiling. General-text padding would dilute importance mass over
  paths we never use.
- A **disjoint holdout** (~80 v2 + ~80 v3 records) is emitted alongside for
  the PPL gate — never fed to the imatrix.

## Reuse for the next design implementations

This calibrator is the **standing calibration artifact** for the whole model
line, not a one-off:

- **v3-finetuned tutor deploy quant** (the eventual :8019 swap): rebuild the
  calibrator from the FINAL 70k v3.1 corpus (same script, same proportions —
  by then every mode has full representation), fresh imatrix on that model's
  F16, same IQ4_NL + PPL gate.
- **E4B low-VRAM deploys** (laptop/phone path): same calibrator text; imatrix
  must be recomputed per model (it measures activations, not data).
- **Memory-ops/card-ops contract changes**: any new fenced-block vocabulary
  must enter the calibrator before the next quant (add a stratified slice).

## Artifacts & reproduction

- Scripts (versioned in `sloane-ui/backend/voice-tutor-v2/tools/`, run on the
  training box at `~/voice-tutor-train/`): `render_calib_v3.py`,
  `quant_v3_teacher.sh`, `serve_12b_teacher.sh`.
- Server artifacts: `~/voice-tutor-train/calib_v3_teacher.txt` + holdout;
  `~/models/voice-tutor-12b-v3teacher/imatrix_12b_v3teacher.dat`;
  `voice-tutor-12b-merged-IQ4_NL.gguf` (+ F16 and Q8_0 kept as
  ceiling/fallback).
- Pipeline: `quant_v3_teacher.sh` = render → `llama-imatrix` (≤1200 chunks,
  ctx 512, 5090) → `llama-quantize --imatrix … IQ4_NL 24` → PPL A/B
  (F16/Q8_0/IQ4_NL) on the holdout.

## Results (v3-teacher run, 2026-06-11) — gate fired, ladder decided

Holdout PPL (ctx 512, 144 disjoint records, same imatrix for all candidates):

| Quant | Size | PPL | vs Q8_0 | Verdict |
|---|---|---|---|---|
| F16 (ceiling) | 22.7G | 142.49 ±3.56 | — | reference |
| Q8_0 | 12.4G | 142.13 ±3.55 | at ceiling | old fleet quant |
| IQ4_NL (plain, calibrated) | 6.5G | 161.06 ±4.13 | **+13.3%** | **REJECTED by gate** |
| IQ4_NL+attnQ8last6 | 6.7G | 149.97 ±3.77 | +5.5% | rejected (marginal) |
| Q6_K | 9.2G | 144.25 ±3.61 | +1.5% | pass |
| **Q5_K_M** | **8.0G** | **136.36 ±3.36** | **−4.1%** | **SHIPPED** |

Findings of record:

1. **The e4b precedent did not transfer.** Calibrated IQ4_NL was at the Q8
   ceiling on DECKARD-e4b but lost +13.3% PPL on this 12B merge — quant
   sensitivity is model-specific; the per-model gate is mandatory, never ship
   on precedent.
2. **Promotion recovered ~60% of the gap once the base was off-ceiling**
   (161.06 → 149.97 with last-6 attn at Q8), consistent with the corollary
   that promotion only helps when there is quality to recover — still not
   enough to pass.
3. **Q5_K_M reads at-or-above Q8_0** (−4.1% is within measurement noise; the
   honest claim is "indistinguishable from Q8_0"), at 35% smaller weights →
   ~1.5× fleet decode throughput.
4. Ladder cost: ~2 min per candidate quant + ~30 s per PPL run on the 5090 —
   sweeping candidates is always affordable; never skip the gate to save
   time.

Deployed: `voice-tutor-12b-merged-Q5_K_M.gguf` on all 10 instances, explicit
`-ctk f16 -ctv f16`, uniform `-c 16384 -np 2`. Q8_0 and F16 retained on disk
as fallback/ceiling; the failed IQ4_NL variants retained as evidence.
