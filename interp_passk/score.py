"""pass@k tables and the pre-registered checks (README, "Protocol and checks").

  python -m interp_passk.score --results results/qwen25-7b-simplerl-zoo/mathverify
  python -m interp_passk.score --results results/qwen25-7b-simplerl-zoo/yue_grader
  python -m interp_passk.score --results results/mine --arms base,a50,zoo --base base --rl zoo --no_yue

Sample sizes (n1, n2) per benchmark come from each run's meta (sample.py --sets); Yue protocol defaults otherwise.
Checks, at the largest k of each benchmark:
  1 reproduction: base - RL >= 0 (point estimate) on >= 2/3 of the benchmarks (4 of 6 for the six default benchmarks);
  2 judged benchmarks: crossover and both endpoints <= 95% (others are saturated: report only);
  3 rescue: an interpolation >= max(base, RL) + 1 point on a judged benchmark (AIME24: + 1 problem), 95% CI from a
    paired problem bootstrap; also the share of the base - RL gap recovered and the gap to Yue et al.'s RL at high
    temperature (their fig. 18) when the reference values apply (Qwen2.5-7B <-> SimpleRL-Zoo-7B).
"""
import argparse, math

import numpy as np

from .passk import boot, ks_for, load_result, per_problem, sets_of, thr_of

# Yue et al. (arXiv 2504.13837), Qwen2.5-7B <-> SimpleRL-Zoo-7B, read from the SVGs of fig. 2/10/18:
# (base @1, RL @1, base @max k, RL @max k, RL at high temperature @max k)
YUE = {"gsm8k": (85.2, 92.2, 99.5, 97.6, 98.0), "math500": (61.6, 78.0, 96.0, 93.4, 93.8),
       "minerva_math": (23.1, 35.1, 65.8, 58.4, 59.9), "olympiadbench": (28.2, 41.3, 74.8, 71.8, 72.4),
       "amc23": (36.5, 55.9, 100.0, 100.0, 97.5), "aime24": (7.3, 15.4, 76.7, 63.3, 73.2)}


def load_all(results, arms):
    """-> R[arm][bench] = per_problem(...), KS[bench] (benchmarks with stage-1 data in any arm)"""
    R, KS = {}, {}
    for a in arms:
        r = load_result(results, a)
        if not r:
            continue
        R[a] = {}
        for b, (n1, n2) in sets_of(r).items():
            if r["_stream"].get(b, {}).get("s1"):
                KS.setdefault(b, ks_for(b, n1, n2))
                R[a][b] = per_problem(r["_stream"], b, n1, n2, KS[b], thr_of(r))
    return R, KS


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--results", required=True)
    p.add_argument("--arms", default="base,a25,a50,a75,zoo")
    p.add_argument("--base", default="base")
    p.add_argument("--rl", default="zoo")
    p.add_argument("--no_yue", action="store_true", help="hide Yue et al. reference values (other model pairs)")
    a = p.parse_args()
    arms = list(dict.fromkeys(a.arms.split(",")))
    interps = [x for x in arms if x not in (a.base, a.rl)]
    R, KS = load_all(a.results, arms)
    print(f"arms found: {sorted(R)}")
    N = {b: max(R[m][b]["n"] for m in R if b in R[m]) for b in KS}  # problems per benchmark (most complete arm)
    full = lambda m, b: m in R and b in R[m] and R[m][b]["n"] == N[b] and R[m][b]["tab"][KS[b][-1]] is not None
    yue = lambda b: not a.no_yue and b in YUE
    for b, ks in KS.items():
        print(f"\n== {b} pass@k (%)\narm    " + " ".join(f"{k:>7}" for k in ks) + "    len  trunc  stage-1   stage-2")
        for m in arms:
            if m in R and b in R[m]:
                o = R[m][b]
                print(f"{m:<6} " + " ".join(f"{100 * x.mean():7.2f}" if x is not None else "    ---" for x in o["tab"].values())
                      + f"  {o['len']:5.0f} {o['trunc']:.3f}  {o['n']:4d}/{N[b]:<4d}  {o['s2']}")
        if yue(b):
            y = YUE[b]
            print(f"Yue    base @1 {y[0]}  RL @1 {y[1]}  base @max {y[2]}  RL @max {y[3]}  RL high-T @max {y[4]}")
        for m in [a.base] + interps:
            if m != a.rl and full(m, b) and full(a.rl, b):
                cells = []
                for k in ks:
                    d = 100 * (R[m][b]["tab"][k] - R[a.rl][b]["tab"][k])
                    lo, hi = boot(d)
                    cells.append(f"@{k} {d.mean():+.2f}[{lo:+.1f},{hi:+.1f}]")
                print(f"  {m} - {a.rl}: " + "  ".join(cells))

    print("\nchecks (pre-registered, see README):")
    K = {b: ks[-1] for b, ks in KS.items()}
    val = lambda m, b: 100 * R[m][b]["tab"][K[b]].mean()
    cross, judged, n_done = [], [], 0
    for b in KS:
        if not (full(a.base, b) and full(a.rl, b)):
            print(f"  1 {b}: incomplete")
            continue
        n_done += 1
        d = 100 * (R[a.base][b]["tab"][K[b]] - R[a.rl][b]["tab"][K[b]])
        lo, hi = boot(d)
        sat = max(val(a.base, b), val(a.rl, b)) > 95
        ref = f"  (Yue {YUE[b][2] - YUE[b][3]:+.1f})" if yue(b) else ""
        print(f"  1 {b}@{K[b]}: {a.base} {val(a.base, b):.2f} {a.rl} {val(a.rl, b):.2f}  diff {d.mean():+.2f} "
              f"[{lo:+.1f},{hi:+.1f}]{ref}  {'CROSS' if d.mean() >= 0 else 'no'}{'  saturated (>95%)' if sat else ''}")
        if d.mean() >= 0:
            cross.append(b)
            if not sat:
                judged.append(b)
    need = math.ceil(2 * len(KS) / 3)
    print(f"  1 reproduction: {len(cross)}/{n_done} benchmarks with base >= RL (need >= {need} of {len(KS)}) -> "
          f"{'REPRODUCED' if len(cross) >= need else 'not reproduced' if n_done == len(KS) else 'pending'}")
    print(f"  2 judged benchmarks (crossover, both ends <= 95%): {judged}")
    for b in judged:
        margin = 100 / N[b] if b == "aime24" else 1.0
        ends = {e: val(e, b) for e in (a.base, a.rl)}
        top = max(ends, key=ends.get)
        gap = ends[a.base] - ends[a.rl]
        for m in interps:
            if not full(m, b):
                print(f"  3 rescue {m} {b}: incomplete")
                continue
            d = 100 * (R[m][b]["tab"][K[b]] - R[top][b]["tab"][K[b]])
            lo, hi = boot(d)
            v = val(m, b)
            rec = (v - ends[a.rl]) / gap if gap > 0 else float("nan")
            ref = f" | vs Yue RL high-T {YUE[b][4]}: {v - YUE[b][4]:+.2f}" if yue(b) else ""
            print(f"  3 rescue {m} {b}@{K[b]}: {v:.2f} vs max end {ends[top]:.2f} ({top}), diff {d.mean():+.2f} "
                  f"[{lo:+.1f},{hi:+.1f}] need +{margin:.2f} -> {'PASS' if d.mean() >= margin else 'fail'} "
                  f"| gap recovered {100 * rec:.0f}%{ref}")
    if "math500" in KS:
        p1 = lambda m: 100 * R[m]["math500"]["tab"][1].mean()
        for m in interps:
            if all(x in R and "math500" in R[x] for x in (m, a.base, a.rl)):
                print(f"  cost {m}: MATH500 pass@1 {p1(m):.2f} vs {a.rl} {p1(a.rl):.2f}, {a.base} {p1(a.base):.2f}")


if __name__ == "__main__":
    main()
