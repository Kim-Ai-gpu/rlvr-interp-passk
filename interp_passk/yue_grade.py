"""Regrade stored answers with Yue et al.'s grader (limit-of-RLVR, math/examples/math_eval: extract_answer +
strip_string + math_equal, 3 s per call as in their pebble pool; over time = wrong) and write a copy of the results
with the counts replaced, so score.py can score the same samples under their grader.

Their code is not vendored here. Clone it and use their pinned packages in a separate environment:
  git clone https://github.com/LeapLabTHU/limit-of-RLVR
  python -m venv .yuevenv && .yuevenv/bin/pip install -r scripts/requirements-yue-grader.txt
  .yuevenv/bin/python -m interp_passk.yue_grade --yue_dir limit-of-RLVR/math/examples/math_eval \
      --results results/mine --out results/mine_yue

What is reproduced: their normalization and math_equal on our stored answer (our extraction uses the same order as
theirs: last \\boxed{} > "the answer is" > "final answer is" > last number; 256 chars kept). Their extraction from the
full text is not rerun (texts are not stored). Gold: their parse_ground_truth rules (OlympiadBench: first answer only).
"""
import argparse, gzip, json, multiprocessing as mp, os, queue, sys, time, types

BENCH = ["aime24", "amc23", "olympiadbench", "minerva_math", "math500", "gsm8k"]
STRIP_EXC = ["carp_en", "minerva_math"]


def _setup(yue_dir):
    sys.path[:0] = [yue_dir, os.path.join(yue_dir, "latex2sympy")]
    e = types.ModuleType("examples")  # their utils.py imports few-shot examples we never use
    e.get_examples = lambda *a, **k: {}
    sys.modules.setdefault("examples", e)
    import warnings
    warnings.filterwarnings("ignore")


def yue_pred(ans, b):
    import parser as yp  # theirs (on sys.path after _setup)
    return yp.strip_string(yp.extract_answer("\\boxed{" + (ans or "") + "}", b), skip_unit=b in STRIP_EXC)


def yue_gold(g, b):
    import parser as yp
    if b in ("math500", "minerva_math"):  # theirs: extract_answer(solution)
        return yp.extract_answer("\\boxed{" + g + "}", b)
    return yp.strip_string(str(g).strip("$"))


def _worker(yue_dir, tq, rq):
    import contextlib, io
    _setup(yue_dir)
    import grader
    rq.put(("__ready__", os.getpid()))  # the timeout clock starts only after the slow sympy/antlr import
    while True:
        job = tq.get()
        if job is None:
            return
        key, p, g = job
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                ok = bool(grader.math_equal(p, g))
        except Exception:
            ok = False
        rq.put((key, ok))


def grade_all(jobs, yue_dir, nproc=None, timeout=3.0):
    """jobs {key: (pred, gold)} -> {key: bool}; a call over `timeout` s is wrong and its worker is replaced"""
    nproc = nproc or max(1, (os.cpu_count() or 2) - 1)
    out, todo, rq = {}, list(jobs.items()), mp.Queue()

    def spawn():
        tq = mp.Queue()
        p = mp.Process(target=_worker, args=(yue_dir, tq, rq), daemon=True)
        p.start()
        return [p, tq, None, 0.0, False]  # process, task queue, current key, start time, ready
    W = [spawn() for _ in range(nproc)]
    t0, n_to, last = time.time(), 0, 0
    while len(out) < len(jobs):
        for w in W:
            if w[4] and w[2] is None and todo:
                k, (p, g) = todo.pop()
                w[1].put((k, p, g))
                w[2], w[3] = k, time.time()
        try:
            while True:
                k, ok = rq.get(timeout=0.05)
                if k == "__ready__":
                    for w in W:
                        if w[0].pid == ok:
                            w[4] = True
                    continue
                out[k] = ok
                for w in W:
                    if w[2] == k:
                        w[2] = None
        except queue.Empty:
            pass
        now = time.time()
        for i, w in enumerate(W):
            if w[2] is not None and now - w[3] > timeout and w[2] not in out:
                out[w[2]] = False
                n_to += 1
                w[0].terminate()
                W[i] = spawn()
        if len(out) - last >= 20000:
            last = len(out)
            print(f"  graded {len(out)}/{len(jobs)} ({time.time() - t0:.0f}s, timeouts {n_to})", flush=True)
    for w in W:
        w[1].put(None)
    print(f"  done {len(out)} in {time.time() - t0:.0f}s, timeouts {n_to}")
    return out


def main():
    from .data import load_bench
    from .passk import load_result
    p = argparse.ArgumentParser()
    p.add_argument("--yue_dir", required=True, help="limit-of-RLVR/math/examples/math_eval")
    p.add_argument("--results", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--arms", default="base,a25,a50,a75,zoo")
    p.add_argument("--data_dir", default="data")
    a = p.parse_args()
    _setup(os.path.abspath(a.yue_dir))
    arms = [m for m in a.arms.split(",") if load_result(a.results, m)]
    S = {m: load_result(a.results, m)["_stream"] for m in arms}
    present = [b for b in BENCH if any(S[m].get(b) for m in arms)]
    gold = {b: [yue_gold(r["gold"][0], b) for r in load_bench(b, a.data_dir)] for b in present}
    os.makedirs(a.out, exist_ok=True)
    cache_f = os.path.join(a.out, "cache.json")
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    jobs = {}
    for m in arms:
        for b in present:
            for st in ("s1", "s2"):
                for i, r in S[m].get(b, {}).get(st, {}).items():
                    for ans in set(r["ans"]):
                        k = f"{b}|{i}|{ans}"
                        if k not in cache and k not in jobs:
                            jobs[k] = (yue_pred(ans, b), gold[b][int(i)])
    print(f"unique (benchmark, problem, answer) to grade: {len(jobs)} (cached {len(cache)})")
    cache.update(grade_all(jobs, os.path.abspath(a.yue_dir)))
    json.dump(cache, open(cache_f, "w"))
    for m in arms:
        diff = []
        for b in present:
            nd = tot = dc = 0
            for st in ("s1", "s2"):
                for i, r in S[m].get(b, {}).get(st, {}).items():
                    c = sum(cache[f"{b}|{i}|{ans}"] for ans in r["ans"])
                    nd += c != r["c"]
                    tot += 1
                    dc += c - r["c"]
                    r["c_mathverify"], r["c"] = r["c"], c
            diff.append(f"{b} {nd}/{tot} records differ, net {dc:+d}")
        with gzip.open(os.path.join(a.out, f"{m}.json.gz"), "wt", encoding="utf-8") as fh:
            json.dump({"meta": {"name": m, "grader": "Yue et al. math_equal"}, "_stream": S[m]}, fh)
        print(f"{m}: " + "; ".join(diff))


if __name__ == "__main__":
    main()
