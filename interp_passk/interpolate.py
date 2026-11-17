"""Build W(alpha) = W_base + alpha * (W_rl - W_base), tensor by tensor (low RAM).

Mixing happens in fp32 and the result is saved in fp16 by default. Do NOT save or serve interpolations in bf16: an RLVR
update is smaller than one bf16 step of the base weights, so bf16 rounding erases most of it (in our check on
Qwen2.5-Math-1.5B <-> Oat-Zero-1.5B, |W_rl - W_base| / |W_base| was 0.0007 and alpha 0.25 kept 29% of the intended
update; fp16 kept all of it). Config and tokenizer files are copied from the RL model. Outputs over 5 GB are
sharded with a model.safetensors.index.json. A base model with a tied lm_head is handled (embed_tokens used as W0).

  python -m interp_passk.interpolate --base Qwen/Qwen2.5-7B --rl hkust-nlp/Qwen-2.5-7B-SimpleRL-Zoo \
      --alpha 0.25 0.5 0.75 --out models
  -> models/a25, models/a50, models/a75
"""
import argparse, glob, json, os, shutil


def resolve(model, cache="models"):
    """local folder as is; a HF hub id is downloaded to <cache>/<repo name lower>"""
    if os.path.isdir(model):
        return model
    d = os.path.join(cache, model.split("/")[-1].lower())
    if not os.path.exists(os.path.join(d, "config.json")):
        from huggingface_hub import snapshot_download
        snapshot_download(model, local_dir=d, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model"])
    return d


def _handles(d):
    from safetensors import safe_open
    h = {}
    for f in sorted(glob.glob(os.path.join(d, "*.safetensors"))):
        fh = safe_open(f, "pt")
        h.update({k: fh for k in fh.keys()})
    return h


def interpolate(d0, d1, alpha, dst, dtype="float16", shard_bytes=5e9):
    import torch
    from safetensors.torch import save_file
    out_dtype = {"float16": torch.float16, "float32": torch.float32}[dtype]
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(d1):
        if os.path.isfile(os.path.join(d1, f)) and not f.endswith((".safetensors", ".index.json")):
            shutil.copy(os.path.join(d1, f), dst)
    if dtype == "float16":  # serve in the dtype we saved (vLLM reads torch_dtype from config.json)
        cfg = json.load(open(os.path.join(dst, "config.json")))
        cfg["torch_dtype"] = "float16"
        json.dump(cfg, open(os.path.join(dst, "config.json"), "w"), indent=2)
    h0, h1 = _handles(d0), _handles(d1)
    out, size, shard, wmap, dn, n0 = {}, 0, 0, {}, 0.0, 0.0

    def flush():
        nonlocal out, size, shard
        if out:
            shard += 1
            name = f"model-{shard:05d}.safetensors"
            save_file(out, os.path.join(dst, name), metadata={"format": "pt"})
            wmap.update({k: name for k in out})
            out, size = {}, 0
    for k, fh in h1.items():
        t1 = fh.get_tensor(k).float()
        k0 = k if k in h0 else ("model.embed_tokens.weight" if k == "lm_head.weight" else None)
        assert k0 in h0, f"{k} missing in the base model"
        t0 = h0[k0].get_tensor(k0).float()
        assert t0.shape == t1.shape, (k, t0.shape, t1.shape)
        out[k] = (t0 + alpha * (t1 - t0)).to(out_dtype).contiguous()
        size += out[k].numel() * out[k].element_size()
        dn += float((t1 - t0).double().norm()) ** 2
        n0 += float(t0.double().norm()) ** 2
        if size > shard_bytes:
            flush()
    flush()
    if shard == 1:
        os.replace(os.path.join(dst, "model-00001.safetensors"), os.path.join(dst, "model.safetensors"))
    else:
        json.dump({"metadata": {}, "weight_map": wmap}, open(os.path.join(dst, "model.safetensors.index.json"), "w"), indent=1)
    print(f"alpha {alpha}: {len(wmap) or 'all'} tensors, |W_rl - W_base| / |W_base| = {(dn / n0) ** 0.5:.4f} -> {dst}", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="HF id or folder")
    p.add_argument("--rl", required=True, help="HF id or folder")
    p.add_argument("--alpha", type=float, nargs="+", required=True)
    p.add_argument("--out", default="models", help="outputs go to <out>/a<100*alpha>; downloads to <out> too")
    p.add_argument("--dtype", default="float16", choices=["float16", "float32"])
    p.add_argument("--force", action="store_true", help="rebuild outputs that already exist")
    a = p.parse_args()
    d0, d1 = resolve(a.base, a.out), resolve(a.rl, a.out)
    for al in a.alpha:
        dst = os.path.join(a.out, f"a{round(100 * al)}")
        if not a.force and any(os.path.exists(os.path.join(dst, f)) for f in ("model.safetensors", "model.safetensors.index.json")):
            print(f"alpha {al}: {dst} exists, skipped (--force to rebuild)")
            continue
        interpolate(d0, d1, al, dst, a.dtype)
