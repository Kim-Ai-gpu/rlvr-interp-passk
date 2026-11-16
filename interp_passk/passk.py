"""pass@k from two-stage resampling, result loading, bootstrap.

Result file layout (written by sample.py, merged by merge.py):
  {"meta": {...}, "_stream": {bench: {"s1": {idx: rec}, "s2": {idx: rec}}}},  rec = {c, ans, lens, trunc}
Stage 1 draws n1 samples for every problem; stage 2 draws n2 fresh samples for problems with c1 < thr (default 8).
Per problem: pass@k for k <= n1 from stage 1 (unbiased estimator 1 - C(n-c, k)/C(n, k)); for k > n1 from the stage-2
resample when present, else 1 - (1 - c1/n1)^k (problems with c1 >= thr give ~1; also covers problems whose count drops
below thr after a regrade). Stage-2 samples are independent of the stage-1 selection, so the estimate is unbiased.
"""
import gzip, json, os
from math import comb

import numpy as np

N_PROB = {"aime24": 30, "amc23": 40, "olympiadbench": 675, "minerva_math": 272, "math500": 500, "gsm8k": 1319}
# Yue et al. protocol (default): bench -> (n1, n2) and the k columns reported
YUE_SETS = {"aime24": (64, 1024), "amc23": (64, 1024), "olympiadbench": (32, 128), "minerva_math": (32, 128),
           "math500": (32, 128), "gsm8k": (32, 128)}
YUE_KS = {b: ([1, 4, 16, 64, 128, 256, 512, 1024] if n2 == 1024 else [1, 4, 8, 16, 32, 64, 128]) for b, (_, n2) in YUE_SETS.items()}


def sets_of(result):
    """bench -> (n1, n2) from the run's meta ("bench:n1:n2,..." as passed to sample.py); Yue protocol sets if absent"""
    s = (result or {}).get("meta", {}).get("sets")
    if not s:
        return dict(YUE_SETS)
    return {b: (int(n1), int(n2)) for b, n1, n2 in (x.split(":") for x in s.split(","))}


def thr_of(result):
    return int((result or {}).get("meta", {}).get("thr", 8))


def ks_for(bench, n1, n2):
    if YUE_SETS.get(bench) == (n1, n2):
        return YUE_KS[bench]
    n = max(n1, n2)
    return sorted({1, n1, n} | {2 ** i for i in range(1, 21) if 2 ** i <= n})


def load_result(results, arm):
    """results: a folder holding <arm>.json[.gz] or <arm>/eval.json, or a file path"""
    for f in ([results] if os.path.isfile(results) else
              [os.path.join(results, f"{arm}.json.gz"), os.path.join(results, f"{arm}.json"),
               os.path.join(results, arm, "eval.json")]):
        if os.path.exists(f):
            op = gzip.open if f.endswith(".gz") else open
            with op(f, "rt", encoding="utf-8") as fh:
                return json.load(fh)
    return None


def pass_k(c, n, k):
    return 1.0 - comb(n - c, k) / comb(n, k)


def per_problem(S, bench, n1, n2, ks, thr=8):
    """-> dict(tab={k: per-problem array or None}, ids, n, len, trunc, s2 status) for one benchmark"""
    s1, s2 = S.get(bench, {}).get("s1", {}), S.get(bench, {}).get("s2", {})
    ids = sorted(s1, key=int)
    full1 = all(len(s1[i]["lens"]) == n1 for i in ids)
    has2 = {i for i in ids if i in s2 and len(s2[i]["lens"]) == n2}
    need = [i for i in ids if s1[i]["c"] < thr]
    extrap = [i for i in need if i not in has2]
    tab = {}
    for k in ks:
        if k <= n1:
            tab[k] = np.array([pass_k(s1[i]["c"], n1, k) for i in ids]) if full1 else None
            continue
        if n2 <= n1:  # no stage 2 in this run: k > n1 cannot be estimated
            tab[k] = None
            continue
        v = np.ones(len(ids))
        for j, i in enumerate(ids):
            if i in has2:
                v[j] = pass_k(s2[i]["c"], n2, k)
            elif s1[i]["c"] < thr:
                v[j] = 1.0 - (1.0 - s1[i]["c"] / n1) ** k
        tab[k] = v
    L = [x for i in ids for x in s1[i]["lens"]]
    return dict(tab=tab, ids=ids, n=len(ids), len=float(np.mean(L)) if L else 0.0,
                trunc=sum(s1[i]["trunc"] for i in ids) / max(1, len(L)),
                s2=f"{sum(i in has2 for i in need)}/{len(need)}" + (f" extrap {len(extrap)}" if extrap else ""),
                incomplete2=len(extrap))


def boot(d, B=2000, seed=0):
    """95% percentile CI of the mean of per-problem values d (problem bootstrap)"""
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(d), (B, len(d)))
    m = d[idx].mean(1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))
