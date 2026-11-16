"""Answer extraction and grading.

Extraction follows the Qwen-math / SimpleRL evaluation order: last \\boxed{} > "the answer is" > "final answer is" >
last number. Equivalence: normalized string match, else math-verify (parse + verify). 1 correct / 0 otherwise.
The extracted answer of every sample is stored, so results can be regraded offline (see yue_grade.py).

  python -m interp_passk.grading     self-test (CPU)
"""
import os, re


def last_boxed(t):
    i = t.rfind("\\boxed")
    if i < 0:
        i = t.rfind("\\fbox")
        if i < 0:
            return None
    j = t.find("{", i)
    if j < 0:
        return None
    depth, k = 0, j
    while k < len(t):
        if t[k] == "{":
            depth += 1
        elif t[k] == "}":
            depth -= 1
            if depth == 0:
                return t[j + 1:k]
        k += 1
    return None


def extract(t):
    t = t.replace("\u043a\u0438", "")
    if "boxed" in t:
        b = last_boxed(t)
        if b is not None:
            return b.strip()
    for key in ("he answer is", "final answer is"):
        if key in t:
            s = t.split(key)[-1].strip().split("\n")[0].strip()
            s = s[1:].strip() if s.startswith(":") else s
            s = re.sub(r"^\$+|\$+$", "", s.rstrip(".").strip()).strip()
            return s.rstrip(".").strip()
    nums = re.findall(r"-?\d*\.?\d+", t.replace(",", ""))
    return nums[-1] if nums else ""


def norm(s):
    s = str(s).strip()
    for a in ("\\left", "\\right", "\\!", "\\,", "\\;", "\\ ", "$", " ", "^\\circ", "^{\\circ}", "\\%", "%", "\\dfrac", "\\tfrac"):
        s = s.replace(a, "\\frac" if a in ("\\dfrac", "\\tfrac") else "")
    s = re.sub(r"\\text\{([^}]*)\}", r"\1", s)
    s = re.sub(r"\\mbox\{([^}]*)\}", r"\1", s)
    s = s.rstrip(".")
    if re.fullmatch(r"-?\d+\.0+", s):
        s = s.split(".")[0]
    return s


_mv = None


def _math_verify():
    global _mv
    if _mv is None:
        try:
            from math_verify import parse, verify
            _mv = (parse, verify)
        except ImportError:
            _mv = False
    return _mv


def equal(pred, gold):
    if pred is None or pred == "":
        return False
    if norm(pred) == norm(gold):
        return True
    mv = _math_verify()
    if not mv:
        return False
    parse, verify = mv
    # math-verify's timeouts use signal.alarm on Linux (main thread only) and break on Windows: disabled there
    kw_p, kw_v = ({}, {}) if os.name != "nt" else (dict(parsing_timeout=None), dict(timeout_seconds=None))
    try:
        g = parse("$" + str(gold) + "$", **kw_p)
        p = parse("$" + str(pred) + "$", **kw_p)
        return bool(g) and bool(p) and verify(g, p, **kw_v)
    except Exception:
        return False


def correct_answer(pred, golds):
    """golds: list; several golds (OlympiadBench) must all match, in order, against a comma-separated prediction."""
    if len(golds) > 1:
        parts = [x.strip() for x in pred.split(",")]
        return len(parts) == len(golds) and all(equal(a, b) for a, b in zip(parts, golds))
    return equal(pred, golds[0])


def correct(text, golds):
    return correct_answer(extract(text), golds)


if __name__ == "__main__":
    cases = [("so the answer is $\\boxed{\\frac{1}{2}}$.", "\\frac12", True), ("Thus the answer is 0.5.", "\\frac{1}{2}", True),
             ("1+1=2, then 2*3=6", "6", True), ("The final answer is 27.", "27", True), ("The answer is 26.", "27", False),
             ("We get \\boxed{10\\%}", "10", True), ("no numbers here", "3", False)]
    bad = 0
    for t, g, want in cases:
        got = correct(t, [g]); bad += got != want
        print(("ok  " if got == want else "FAIL"), repr(extract(t)), "vs", g, "->", got)
    print("multi:", correct("The answer is 2, 3", ["2", "3"]), correct("The answer is 2", ["2", "3"]))
    print("math-verify available:", bool(_math_verify()), "| failures:", bad)
