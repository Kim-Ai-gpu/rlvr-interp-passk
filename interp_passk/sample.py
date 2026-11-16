"""Two-stage pass@k sampling for one model over all benchmarks, streamed through one vLLM engine.

Protocol (Yue et al. k, two-stage resampling):
  stage 1: every problem x n1 samples; stage 2: problems with < thr correct in stage 1 get n2 fresh samples.
  pass@k for k <= n1 comes from stage 1, for k > n1 from stage 2 (see passk.py). Problems with >= thr correct of n1
  have pass@k ~ 1 at the large k, so this matches drawing n = k samples for every problem at a fraction of the cost.

Engine organization:
  - all stage-1 requests are queued at start (long benchmarks first); a problem's stage-2 requests are queued as soon
    as its stage-1 samples are graded, so the engine does not drain between stages (the long-output tail is paid once);
  - stage 2 goes in chunks of --chunk samples, so an interruption loses at most one chunk per problem;
  - grading runs in a process pool (math-verify needs a process main thread) while the engine generates;
  - results are checkpointed every --ckpt_sec (atomic replace). Rerunning the same command resumes from the checkpoint
    with a new engine seed (seed + 7919 * starts), so a restart never replays an earlier random stream;
  - --shard i/N keeps problems with index % N == i (one process per GPU or per machine; merge with merge.py).

  python -m interp_passk.sample --model models/a25 --name a25 --out outputs           # Yue et al. protocol is the default
  python -m interp_passk.sample --model Qwen/Qwen2.5-7B --name base --out outputs --tp 2

Linux only (fork process pool). Output: <out>/<name>/eval_<i>of<N>.json, then DONE_<i>of<N> when finished.
"""
import argparse, collections, json, multiprocessing as mp, os, queue, subprocess, time

os.environ.setdefault("VLLM_USE_FLASHINFER_SAMPLER", "0")  # its sampler JIT-compiles with nvcc, often absent

from .data import EOS_IDS, load_bench, make_prompt  # noqa: E402
from .grading import correct, extract  # noqa: E402

ORDER = ["aime24", "amc23", "olympiadbench", "minerva_math", "math500", "gsm8k"]  # long outputs first
SETS = "aime24:64:1024,amc23:64:1024,olympiadbench:32:128,minerva_math:32:128,math500:32:128,gsm8k:32:128"


def _grade(job):
    text, gold = job
    try:
        return bool(correct(text, gold)), extract(text)[:256]
    except Exception:
        return False, ""


def gpu_name():
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader", "-i",
                               os.environ.get("CUDA_VISIBLE_DEVICES", "0").split(",")[0]],
                              capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:
        return "?"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="folder or HF id")
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--data_dir", default="data")
    p.add_argument("--sets", default=SETS, help="bench:n1:n2,... (n2 <= n1 skips stage 2)")
    p.add_argument("--shard", default="0/1")
    p.add_argument("--temp", type=float, default=0.6)
    p.add_argument("--top_p", type=float, default=0.95)
    p.add_argument("--max_new", type=int, default=16000)
    p.add_argument("--template", default="qwenboxed", choices=["qwenboxed", "abel", "none"])
    p.add_argument("--thr", type=int, default=8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--dtype", default="float16", help="keep float16 (or float32) for interpolated models, never bfloat16")
    p.add_argument("--gpu_util", type=float, default=0.92)
    p.add_argument("--max_num_seqs", type=int, default=512)
    p.add_argument("--tp", type=int, default=1, help="tensor-parallel GPUs")
    p.add_argument("--chunk", type=int, default=128, help="stage-2 samples per request")
    p.add_argument("--ckpt_sec", type=float, default=300)
    p.add_argument("--workers", type=int, default=0, help="grading processes (default: CPUs - 1, max 16)")
    p.add_argument("--max_hours", type=float, default=0, help="save and exit (no DONE) after this many hours; rerun to resume")
    a = p.parse_args()
    t_start = time.time()

    pool = mp.get_context("fork").Pool(a.workers or max(1, min(16, (os.cpu_count() or 2) - 1)))  # before the engine
    import vllm
    from vllm import LLM, SamplingParams
    try:
        from vllm.sampling_params import RequestOutputKind
    except ImportError:
        RequestOutputKind = None
    si, sn = (int(x) for x in a.shard.split("/"))
    outd = os.path.join(a.out, a.name)
    os.makedirs(outd, exist_ok=True)
    res_path = os.path.join(outd, f"eval_{si}of{sn}.json")
    sets = sorted(((b, int(n1), int(n2)) for b, n1, n2 in (s.split(":") for s in a.sets.split(","))),
                  key=lambda x: ORDER.index(x[0]) if x[0] in ORDER else 99)
    data = {b: load_bench(b, a.data_dir) for b, _, _ in sets}

    st = json.load(open(res_path)) if os.path.exists(res_path) else {}
    meta = st.setdefault("meta", {})
    S = st.setdefault("_stream", {})  # bench -> {"s1": {idx: rec}, "s2": {idx: rec}}
    for b, _, _ in sets:
        S.setdefault(b, {"s1": {}, "s2": {}})
    starts = meta.get("starts", 0)
    seed = a.seed + 7919 * starts + (104729 * (si + 1) if sn > 1 else 0)  # parallel shards get their own streams
    fmt, stop = make_prompt(a.template)

    t = time.time()
    llm = LLM(a.model, dtype=a.dtype, max_model_len=a.max_new + 1024, gpu_memory_utilization=a.gpu_util,
              max_num_seqs=a.max_num_seqs, seed=seed, tensor_parallel_size=a.tp)
    eng, tok = llm.llm_engine, llm.get_tokenizer()
    meta.update(model=a.model, name=a.name, temp=a.temp, top_p=a.top_p, max_new=a.max_new, template=a.template,
                seed=a.seed, dtype=a.dtype, shard=a.shard, thr=a.thr, sets=a.sets, vllm=vllm.__version__,
                gpu=gpu_name(), starts=starts + 1, engine_seeds=meta.get("engine_seeds", []) + [seed])
    print(f"[{a.name}] engine up in {time.time() - t:.0f}s on {meta['gpu']} (vllm {vllm.__version__}, seed {seed}, "
          f"start {starts + 1})", flush=True)

    def sp(n):
        s = SamplingParams(n=n, temperature=a.temp, top_p=a.top_p, top_k=-1, max_tokens=a.max_new, stop=stop,
                           stop_token_ids=EOS_IDS, detokenize=False)
        if RequestOutputKind is not None:
            s.output_kind = RequestOutputKind.FINAL_ONLY
        return s

    pending = set()

    def add(stage, b, i, n):
        rid = f"{stage}|{b}|{i}|{starts}"
        try:
            eng.add_request(rid, fmt(data[b][i]["q"]), sp(n))
        except TypeError:  # older vLLM signature
            eng.add_request(rid, {"prompt": fmt(data[b][i]["q"])}, sp(n))
        pending.add(rid)

    n_of = {b: (n1, n2) for b, n1, n2 in sets}

    def add2(b, i, have):
        need, k = n_of[b][1] - have, 0
        while need > 0:
            m = min(a.chunk, need)
            add(f"s2c{k}", b, i, m)
            need -= m
            k += 1
    need2 = lambda b, rec: n_of[b][1] > n_of[b][0] and rec["c"] < a.thr
    for b, n1, n2 in sets:  # missing stage 1; missing or partial stage 2 of graded problems
        for i in range(len(data[b])):
            if i % sn != si:
                continue
            r1 = S[b]["s1"].get(str(i))
            if r1 is None:
                add("s1", b, i, n1)
            elif need2(b, r1):
                have = len(S[b]["s2"][str(i)]["lens"]) if str(i) in S[b]["s2"] else 0
                if have < n2:
                    add2(b, i, have)
    print(f"[{a.name}] queued {len(pending)} requests", flush=True)

    graded, in_grading = queue.Queue(), [0]
    tok_total, t0, last_ck = 0, time.time(), time.time()

    def save(final=False):
        if final:
            meta["done"] = time.time()
        tmp = res_path + ".tmp"
        json.dump(st, open(tmp, "w"))
        os.replace(tmp, res_path)

    def on_graded(stage, b, i, lens, fin):
        return lambda results: graded.put((stage, b, i, lens, fin, results))

    while pending or in_grading[0] or not graded.empty():
        if pending:
            for o in eng.step():
                if not o.finished or o.request_id not in pending:
                    continue
                pending.discard(o.request_id)
                stage, b, i = o.request_id.split("|")[:3]
                ids = [c.token_ids for c in o.outputs]
                tok_total += sum(len(x) for x in ids)
                texts = tok.batch_decode(ids, skip_special_tokens=True)
                in_grading[0] += 1
                pool.map_async(_grade, [(x, data[b][int(i)]["gold"]) for x in texts], chunksize=32,
                               callback=on_graded(stage, b, i, [len(x) for x in ids],
                                                  [c.finish_reason != "length" for c in o.outputs]),
                               error_callback=lambda e: graded.put(("err", repr(e), None, None, None, None)))
        else:
            time.sleep(0.2)
        while not graded.empty():
            stage, b, i, lens, fin, results = graded.get()
            in_grading[0] -= 1
            if stage == "err":
                print(f"[{a.name}] grading error {b}", flush=True)
                continue
            rec = dict(c=sum(r[0] for r in results), ans=[r[1] for r in results], lens=lens, trunc=sum(not f for f in fin))
            if stage.startswith("s2"):  # a stage-2 chunk: append
                old = S[b]["s2"].setdefault(i, dict(c=0, ans=[], lens=[], trunc=0))
                old.update(c=old["c"] + rec["c"], ans=old["ans"] + rec["ans"], lens=old["lens"] + rec["lens"],
                           trunc=old["trunc"] + rec["trunc"])
                continue
            S[b]["s1"][i] = rec
            if need2(b, rec):
                add2(b, int(i), 0)
        if a.max_hours and time.time() - t_start > a.max_hours * 3600:
            print(f"[{a.name}] max_hours reached: saved, exiting without DONE (rerun to resume)", flush=True)
            save()
            return
        if time.time() - last_ck > a.ckpt_sec:
            el = time.time() - t0
            print(f"[{a.name}] {el / 60:.0f} min: {tok_total} tokens ({tok_total / max(1, el):.0f} tok/s), stage-1 done "
                  f"{sum(len(S[b]['s1']) for b in S)}, stage-2 records {sum(len(S[b]['s2']) for b in S)}, "
                  f"in engine {len(pending)}", flush=True)
            save()
            last_ck = time.time()
    save(final=True)
    el = time.time() - t0
    print(f"[{a.name}] done: {tok_total} tokens in {el / 60:.1f} min ({tok_total / max(1, el):.0f} tok/s) -> {res_path}", flush=True)
    open(os.path.join(outd, f"DONE_{si}of{sn}"), "w").write(str(time.time()))


if __name__ == "__main__":  # vLLM's engine core is a spawned process that re-imports this module
    main()
