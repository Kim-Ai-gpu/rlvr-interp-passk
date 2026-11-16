"""Exploratory baseline: is an interpolation a better pass@1 / pass@k trade-off than mixing samples of the endpoints?

Sample mixture at budget k: k_rl samples from the RL model + (k - k_rl) from the base. Per problem
  pass@k = 1 - q_base(k - k_rl) * q_rl(k_rl),   q(m) = C(n - c, m) / C(n, m)   (models sampled independently)
with q from stage 1 when m <= n1, else from the stage-2 resample (problems with c1 >= thr: q = 0).
The mixture's pass@1 is (1 - w) p_base + w p_rl. For each interpolation we pick w so the mixture has the same pass@1
and compare pass@k at the largest k (paired problem bootstrap).

  python -m interp_passk.mixture --results results/qwen25-7b-simplerl-zoo/mathverify
"""
import argparse
from math import comb

import numpy as np

from .passk import boot, load_result, sets_of, thr_of


def qfun(S, b, n1, n2, thr=8):
    s1, s2 = S[b]["s1"], S[b]["s2"]
    ids = sorted(s1, key=int)

    def q(m):
        if m == 0:
            return np.ones(len(ids))
        if m <= n1:
            return np.array([comb(n1 - s1[i]["c"], m) / comb(n1, m) for i in ids])
        return np.array([comb(n2 - s2[i]["c"], m) / comb(n2, m) if i in s2 and len(s2[i]["lens"]) == n2
                         else (1 - s1[i]["c"] / n1) ** m if s1[i]["c"] < thr else 0.0 for i in ids])
    return ids, q


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--results", required=True)
    p.add_argument("--interps", default="a25,a50,a75")
    p.add_argument("--base", default="base")
    p.add_argument("--rl", default="zoo")
    a = p.parse_args()
    arms = [m for m in a.interps.split(",") if load_result(a.results, m)]
    res = {m: load_result(a.results, m) for m in [a.base, a.rl] + arms}
    E = {m: r["_stream"] for m, r in res.items()}
    for b, (n1, n2) in sets_of(res[a.base]).items():
        if not all(E[m].get(b, {}).get("s1") for m in E) or n2 <= n1:
            continue
        K = n2
        ids, qb = qfun(E[a.base], b, n1, n2, thr_of(res[a.base]))
        _, qz = qfun(E[a.rl], b, n1, n2, thr_of(res[a.rl]))
        pb, pz = 1 - qb(1), 1 - qz(1)
        print(f"\n== {b} @{K}: {a.base} p1 {100 * pb.mean():.2f} p@{K} {100 * (1 - qb(K)).mean():.2f} | "
              f"{a.rl} p1 {100 * pz.mean():.2f} p@{K} {100 * (1 - qz(K)).mean():.2f}")
        print("   mixture " + " | ".join(
            f"w{w}: p1 {100 * ((1 - w) * pb + w * pz).mean():.2f} p@{K} {100 * (1 - qb(K - round(w * K)) * qz(round(w * K))).mean():.2f}"
            for w in (0.25, 0.5, 0.75)))
        for m in arms:
            i2, qa = qfun(E[m], b, n1, n2, thr_of(res[m]))
            if i2 != ids:
                print(f"   {m}: different problem set, skipped")
                continue
            pa = 1 - qa(1)
            den = pz.mean() - pb.mean()
            w = 0.5 if abs(den) < 1e-12 else float(np.clip((pa.mean() - pb.mean()) / den, 0, 1))  # equal ends: any w
            kz = round(w * K)
            mix, arm = 1 - qb(K - kz) * qz(kz), 1 - qa(K)
            d = 100 * (arm - mix)
            lo, hi = boot(d)
            print(f"   {m}: p1 {100 * pa.mean():.2f} (= mixture w {w:.2f}: {kz} {a.rl} + {K - kz} {a.base} samples) "
                  f"p@{K} {100 * arm.mean():.2f} vs mixture {100 * mix.mean():.2f}: {d.mean():+.2f} [{lo:+.1f},{hi:+.1f}]")


if __name__ == "__main__":
    main()
