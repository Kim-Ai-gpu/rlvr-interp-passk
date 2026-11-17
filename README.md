# Mix Your Base and RLVR Weights: A Training-Free Knob for Diversity

Code and results for the paper *Mix Your Base and RLVR Weights: A Training-Free Knob for Diversity*
(Youngseong Kim; preprint coming soon on arXiv).

RLVR-trained models beat their base model at pass@1 but lose at large k ([Yue et al., 2025](https://arxiv.org/abs/2504.13837)).
This repository tests a training-free knob: the linear weight interpolation

    W(α) = W_base + α · (W_RL − W_base)

evaluated under Yue et al.'s exact protocol (Qwen2.5-7B ↔ SimpleRL-Zoo-7B, qwen-boxed prompt, T 0.6, top-p 0.95,
16k tokens, pass@k up to k = 128 / 1024 on GSM8K, MATH500, Minerva, OlympiadBench, AMC23, AIME24).

## Main result (Qwen2.5-7B ↔ SimpleRL-Zoo-7B)

pass@k (%), math-verify grading. `python -m interp_passk.score --results results/qwen25-7b-simplerl-zoo/mathverify` prints every k
with paired bootstrap CIs; `results/qwen25-7b-simplerl-zoo/yue_grader` is the same samples regraded with Yue et al.'s grader.

Each cell is pass@1 / pass@k at the largest k (128; AMC23 and AIME24 1024). Bold = best in the row.

| benchmark | Qwen2.5-7B (base) | α = 0.25 | α = 0.5 | α = 0.75 | SimpleRL-Zoo-7B (RL) |
|---|---|---|---|---|---|
| MATH500 ‡ | 62.5 / **96.4** | 75.5 / 95.8 | 77.0 / 95.4 | **78.7** / 94.6 | **78.7** / 94.2 |
| Minerva † | 24.9 / **65.1** | 33.3 / **65.1** | **35.7** / 59.2 | 35.3 / 58.1 | 35.6 / 56.3 |
| OlympiadBench † | 28.1 / 75.6 | 37.1 / **75.7** | 40.3 / 74.8 | 42.0 / 73.9 | **42.3** / 71.4 |
| GSM8K ‡ | 85.2 / **99.2** | 90.0 / 98.5 | 91.1 / 98.1 | 91.7 / 97.7 | **92.2** / 97.5 |
| AMC23 ‡ | 36.2 / **100** | 45.7 / **100** | 54.5 / **100** | 55.8 / **100** | **55.9** / **100** |
| AIME24 | 8.2 / 70.0 | 12.5 / 73.3 | 14.2 / 66.7 | **15.6** / 73.3 | 14.6 / **76.7** |

† judged benchmarks (base ≥ RL at the largest k, both endpoints ≤ 95%). ‡ saturated at the largest k (an endpoint
> 95%), reported only. AIME24 has no crossover (RL ≥ base; 30 problems, so one problem = 3.3 points).

- The base > RL crossover at large k reproduces on 5 of 6 benchmarks (pass@1 within ±2 points of Yue et al.).
- The pre-registered "rescue" test fails: no α beats **both** endpoints by +1 point on the non-saturated benchmarks.
- Exploratory: α = 0.25 keeps the base model's large-k coverage while keeping 65–80% of the RL pass@1 gain. That coverage
  is above what Yue et al. report for the RL model at any temperature. The trade-off matches a pass@1-matched mixture
  of samples from the two models, but needs only one model. α = 0.75 matches RL pass@1 with a small large-k gain
  (Olympiad @128 +2.5 [+1.0, +4.1]).
- Yue et al.'s grader gives the same verdicts, with numbers closer to their paper (base Minerva @128 65.8, Olympiad
  @128 74.8).

## Protocol and checks (fixed before the run)

- Models: `Qwen/Qwen2.5-7B` ↔ `hkust-nlp/Qwen-2.5-7B-SimpleRL-Zoo`, α ∈ {0.25, 0.5, 0.75}, all served in fp16.
- Prompt `qwen-boxed` (0-shot), T 0.6, top-p 0.95, max 16,000 new tokens, no loop cutting.
- Two-stage resampling: stage 1 draws 32 samples per problem (64 for AMC23/AIME24); problems with < 8 correct get a
  fresh stage 2 of 128 (1024). pass@k for k ≤ n1 comes from stage 1, for larger k from stage 2 (problems with ≥ 8
  correct have pass@k ≈ 1 there), which matches drawing n = k samples for every problem.
- Checks at the largest k (128; AMC23/AIME24 1024):
  1. reproduction: base − RL ≥ 0 on at least 4 of 6 benchmarks;
  2. judged benchmarks: crossover and both endpoints ≤ 95% (others are saturated and only reported);
  3. rescue: some α ≥ max(base, RL) + 1 point on a judged benchmark (AIME24: + 1 problem), 95% CI by paired problem
     bootstrap.
- No temperature arms were run; Yue et al.'s fig. 17/18 values for the RL model at higher temperature (same pair) are
  cited, valid because check 1 passed with our endpoints within 2 points of theirs.

## Layout

```
interp_passk/
  data.py          download SimpleRL-Zoo eval sets, prompts (qwen-boxed)
  grading.py       answer extraction + math-verify equivalence
  interpolate.py   build W(alpha) in fp32, save fp16 (never bf16), sharded safetensors
  sample.py        two-stage pass@k sampling streamed through one vLLM engine, checkpoint/resume, shards
  merge.py         merge shards / restarts of one model, report missing work
  passk.py         unbiased pass@k from the two stages, bootstrap CI
  score.py         pass@k tables + pre-registered checks
  mixture.py       exploratory: interpolation vs pass@1-matched sample mixture
  yue_grade.py     regrade stored answers with Yue et al.'s grader (their code, pinned env)
results/qwen25-7b-simplerl-zoo/  merged per-model results (stored answers per sample), math-verify and Yue-grader versions
scripts/reproduce.sh  end-to-end reproduction on a multi-GPU Linux machine
```

## Usage

Score the included results (CPU only, numpy):

```bash
python -m interp_passk.score --results results/qwen25-7b-simplerl-zoo/mathverify
python -m interp_passk.score --results results/qwen25-7b-simplerl-zoo/yue_grader
python -m interp_passk.mixture --results results/qwen25-7b-simplerl-zoo/mathverify
```

Reproduce from scratch (Linux, NVIDIA GPUs with ≥ 40 GB for a 7B model at 16k context; `pip install -r requirements.txt`):

```bash
python -m interp_passk.data --out data
python -m interp_passk.interpolate --base Qwen/Qwen2.5-7B --rl hkust-nlp/Qwen-2.5-7B-SimpleRL-Zoo --alpha 0.25 0.5 0.75 --out models
python -m interp_passk.sample --model models/a25 --name a25 --out outputs        # one model; rerun to resume
python -m interp_passk.merge --out results/mine --arm a25 "outputs/a25/eval_*.json"
python -m interp_passk.score --results results/mine
```

or `bash scripts/reproduce.sh` for all five models (one per GPU). Other model pairs: pass `--base/--rl` to
`interpolate`, then `score --base ... --rl ... --no_yue`.

Notes
- Keep interpolated models in fp16 or fp32. An RLVR update is about one bf16 ULP of the base weights, so bf16 erases
  most of it.
- `sample.py` uses a fork process pool for grading (Linux). Stage-2 requests go in chunks of 128 samples so an
  interruption loses little; restarts use a fresh engine seed.
- Each 7B model is about 2.3e8 generated tokens under this protocol (~5–6 h on one H100 SXM with vLLM 0.30, fp16).

License: MIT (see LICENSE).
