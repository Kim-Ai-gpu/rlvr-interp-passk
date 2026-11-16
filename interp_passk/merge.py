"""Merge partial result files of one model (shards, restarts on other machines) and report missing work.

Per (benchmark, stage, problem) the record with the most samples wins. Stage-2 chunks of one problem are appended by
the run that drew them, and a resumed run only draws what its checkpoint lacks, so records never need to be summed.

  python -m interp_passk.merge --out results/mine --arm a25 outputs/a25/eval_*.json other_machine/a25/eval_*.json
  -> results/mine/a25.json.gz + missing-work table
"""
import argparse, glob, gzip, json, os

NN = {"aime24": (64, 1024), "amc23": (64, 1024), "olympiadbench": (32, 128), "minerva_math": (32, 128),
      "math500": (32, 128), "gsm8k": (32, 128)}
N_PROB = {"aime24": 30, "amc23": 40, "olympiadbench": 675, "minerva_math": 272, "math500": 500, "gsm8k": 1319}


def merge(files):
    """-> merged _stream, source file per record, the runs' sampling meta (sets, thr; first file that has them)"""
    M, src, run = {}, {}, {}
    for f in files:
        op = gzip.open if f.endswith(".gz") else open
        with op(f, "rt", encoding="utf-8") as fh:
            res = json.load(fh)
        S = res.get("_stream", {})
        if not run and res.get("meta", {}).get("sets"):
            run = {k: res["meta"][k] for k in ("sets", "thr") if k in res["meta"]}
        for b, d in S.items():
            for k in ("s1", "s2"):
                for i, r in d.get(k, {}).items():
                    old = M.setdefault(b, {"s1": {}, "s2": {}})[k].get(i)
                    if old is None or len(r["lens"]) > len(old["lens"]):
                        M[b][k][i] = r
                        src[(b, k, i)] = f
    return M, src, run


def missing(M, nn=NN, thr=8):
    rows = []
    for b, (n1, n2) in nn.items():
        if b not in M:
            continue
        s1, s2 = M.get(b, {}).get("s1", {}), M.get(b, {}).get("s2", {})
        need = [i for i, r in s1.items() if r["c"] < thr]
        m2 = sum(max(0, n2 - len(s2.get(i, {}).get("lens", []))) for i in need) if n2 > n1 else 0
        rows.append((b, len(s1), N_PROB.get(b, len(s1)), len(need), m2))
    return rows


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--arm", required=True)
    p.add_argument("files", nargs="+", help="result files or globs")
    a = p.parse_args()
    files = sorted({f for g in a.files for f in (glob.glob(g) or [g]) if os.path.exists(f)})
    M, _, run = merge(files)
    sets, thr = run.get("sets"), int(run.get("thr", 8))
    nn = {b: (int(n1), int(n2)) for b, n1, n2 in (x.split(":") for x in sets.split(","))} if sets else NN
    os.makedirs(a.out, exist_ok=True)
    meta = {"name": a.arm, "merged_from": [os.path.basename(f) for f in files]}
    meta.update(run)
    with gzip.open(os.path.join(a.out, f"{a.arm}.json.gz"), "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "_stream": M}, fh)
    print(f"{a.arm}: merged {len(files)} files (sets {sets or 'Yue protocol default'})")
    for b, d1, n, need2, m2 in missing(M, nn, thr):
        print(f"  {b:14s} stage 1 {d1:4d} problems (full set {n}) | stage-2 problems {need2:3d}, missing stage-2 samples {m2}")
