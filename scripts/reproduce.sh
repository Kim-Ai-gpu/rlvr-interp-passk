#!/usr/bin/env bash
# Reproduce the main result end to end on one machine: Qwen2.5-7B <-> SimpleRL-Zoo-7B, Yue et al. protocol, 5 arms.
# One arm per GPU; with fewer GPUs the arms queue up. Each arm is ~2.3e8 generated tokens (~5-6 h on one H100).
#   bash scripts/reproduce.sh                 # all GPUs, all arms
#   ARMS="base zoo a25" GPUS="0 1" bash scripts/reproduce.sh
# Rerunning resumes every unfinished arm from its checkpoint.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE=${BASE:-Qwen/Qwen2.5-7B}
RL=${RL:-hkust-nlp/Qwen-2.5-7B-SimpleRL-Zoo}
ARMS=${ARMS:-"base zoo a25 a50 a75"}
GPUS=${GPUS:-$(nvidia-smi --query-gpu=index --format=csv,noheader | tr '\n' ' ')}
OUT=${OUT:-outputs}

[ -f data/bench_math500.json ] || python -m interp_passk.data --out data
python -m interp_passk.interpolate --base "$BASE" --rl "$RL" --alpha 0.25 0.5 0.75 --out models  # skips built ones

model_of() {
  case "$1" in
    base) echo "models/$(basename "$BASE" | tr 'A-Z' 'a-z')" ;;
    zoo)  echo "models/$(basename "$RL" | tr 'A-Z' 'a-z')" ;;
    *)    echo "models/$1" ;;
  esac
}

run_queue() {  # one GPU works through its share of the arms
  local gpu=$1; shift
  for arm in "$@"; do
    [ -f "$OUT/$arm/DONE_0of1" ] && continue
    CUDA_VISIBLE_DEVICES=$gpu python -m interp_passk.sample --model "$(model_of "$arm")" --name "$arm" --out "$OUT" \
      > "$OUT/$arm.log" 2>&1 || echo "arm $arm failed (see $OUT/$arm.log); rerun to resume"
  done
}

mkdir -p "$OUT"
gpus=($GPUS); arms=($ARMS); n=${#gpus[@]}
for g in $(seq 0 $((n - 1))); do
  share=(); for i in "${!arms[@]}"; do [ $((i % n)) -eq "$g" ] && share+=("${arms[$i]}"); done
  [ ${#share[@]} -gt 0 ] && run_queue "${gpus[$g]}" "${share[@]}" &
done
wait

for arm in $ARMS; do
  python -m interp_passk.merge --out results/mine --arm "$arm" "$OUT/$arm/eval_*.json"
done
python -m interp_passk.score --results results/mine --arms "$(echo $ARMS | tr ' ' ',')"
python -m interp_passk.mixture --results results/mine
