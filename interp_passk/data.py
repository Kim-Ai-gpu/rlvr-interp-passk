"""Benchmarks and prompts.

Benchmarks are SimpleRL-Zoo's evaluation files (the same files Yue et al. use): aime24, amc23, math500, minerva_math,
olympiadbench, gsm8k. `python -m interp_passk.data --out data` downloads them and writes data/bench_<name>.json as
[{"q": question, "gold": [answer, ...]}] (OlympiadBench may list several answers, all of which must match).
"""
import argparse, json, os, urllib.request

from .grading import last_boxed

BENCH = ["aime24", "amc23", "olympiadbench", "minerva_math", "math500", "gsm8k"]
GH = "https://raw.githubusercontent.com/hkust-nlp/simpleRL-reason/HEAD/examples/simplelr_math_eval/data"

# Yue et al. 'qwen-boxed' prompt (limit-of-RLVR math/README, Qwen2.5-7B and SimpleRL-Zoo settings), 0-shot
QWEN_BOXED = ("<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n"
              "<|im_start|>user\n{q}\nPlease reason step by step, and put your final answer within \\boxed{{}}.<|im_end|>\n"
              "<|im_start|>assistant\n")
# SimpleRL-Zoo small-model training/eval template (raw text, no chat template)
ABEL = "Question:\n{q}\nAnswer:\nLet's think step by step.\n"
TEMPLATES = {"qwenboxed": (QWEN_BOXED, None), "abel": (ABEL, ["Question:", "Answer:"]), "none": ("{q}", None)}
EOS_IDS = [151643, 151645]  # <|endoftext|>, <|im_end|> (Qwen2.5 family)


def make_prompt(template):
    """-> (format function, stop strings)"""
    t, stop = TEMPLATES[template]
    return (lambda q: t.format(q=q)), stop


def _gold(name, r):
    if name == "gsm8k":
        return [r["answer"].split("####")[-1].strip().replace(",", "")]
    if name == "minerva_math":
        return [last_boxed(r["solution"])]
    if name == "olympiadbench":
        fa = r["final_answer"]
        fa = fa if isinstance(fa, list) else [fa]
        return [str(x).strip().strip("$") for x in fa]
    a = r["answer"]
    if isinstance(a, float) and a.is_integer():
        a = int(a)
    return [str(a)]


def download(out):
    os.makedirs(out, exist_ok=True)
    for name in BENCH:
        with urllib.request.urlopen(f"{GH}/{name}/test.jsonl", timeout=120) as f:
            raw = f.read().decode("utf-8")
        rs = [json.loads(l) for l in raw.splitlines() if l.strip()]
        rows = [dict(q=r.get("problem") or r.get("question"), gold=_gold(name, r)) for r in rs]
        assert all(o["q"] and o["gold"] and all(o["gold"]) for o in rows), name
        json.dump(rows, open(os.path.join(out, f"bench_{name}.json"), "w", encoding="utf-8"), ensure_ascii=False)
        print(f"{name}: {len(rows)} problems, e.g. gold {rows[0]['gold']}")


def load_bench(name, data_dir="data"):
    return json.load(open(os.path.join(data_dir, f"bench_{name}.json"), encoding="utf-8"))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data")
    download(p.parse_args().out)
