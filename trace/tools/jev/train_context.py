#!/usr/bin/env python3
"""Train open-jev as a context-line scorer for Line's bench builder (#881), from data/context-lines.jsonl.

Each candidate line is one state; jev answers two typed Choice questions over it in one forward pass:
  keep  "Keep this context line for the builder's next step?"  options keep / drop   -> the line's score is P(keep)
  fact  per turn: "Which fact settles the next step?" over the turn's lines (useful lines share the mass)
Targets are soft (0.9 / 0.1), never one-hot, as open-jev's RLCD loss expects. Only USEFUL / NOISE rows train; unclear
rows are scored at eval time like any other line.

The model config and tokenizer come from jev_tokenizer.py (shared with serve.py), so the saved weights load with
`python tools/jev/serve.py --weights <file>`, and weights from another tokenizer refuse to load. The tokenizer splits
paths, camelCase and snake_case itself, so the state carries the line text as is (only truncated).

  heavy.sh tools/jev/.venv/bin/python tools/jev/train_context.py --holdout pilot-qwen-7b-r2
  heavy.sh tools/jev/.venv/bin/python tools/jev/train_context.py --loro       # leave-one-run-out
Writes weights/context-<holdout>.pt and weights/scores-<holdout>.jsonl ({id, score} per held-out line); score them
with `node tools/jev/eval-context.mjs --runs <holdout> --scores weights/scores-<holdout>.jsonl`.
"""
import argparse, json, os, random, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "open-jev"))

import torch
from open_jev.main import Choice, RLCDLoss
from jev_tokenizer import new_model, save_weights, version as tokenizer_version
KEEP = Choice("Keep this context line for the builder's next step?", options=["keep", "drop"], key="keep")


def norm(s, n=400):
    """Truncate only; jev_tokenizer.presplit does the code-aware splitting."""
    return str(s or "")[:n]


def line_state(r):
    return {"attempt": norm(r["attempt"], 240), "outcome": r["outcome"], "code": r.get("code") or "none",
            "said": norm(r.get("said", ""), 200), "line": {"kind": r["kind"], "src": r["src"], "text": norm(r["text"])}}


def turn_items(rows):
    """Per turn with >= 1 useful line: (state, Choice over its lines, soft target)."""
    by = {}
    for r in rows:
        by.setdefault((r["run"], r["action"]), []).append(r)
    out = []
    for ls in by.values():
        opts, seen = [], set()
        for r in ls[:48]:
            t = f"{r['kind']}: {norm(r['text'], 160)}"
            if t in seen:
                continue
            seen.add(t); opts.append((t, r["label"]))
        useful = [i for i, (_, l) in enumerate(opts) if l == "useful"]
        if not useful or len(opts) < 2:
            continue
        tgt = torch.full((len(opts),), 0.1 / len(opts))
        for i in useful:
            tgt[i] += 0.9 / len(useful)
        tgt = tgt / tgt.sum()
        st = {"attempt": norm(ls[0]["attempt"], 240), "outcome": ls[0]["outcome"], "code": ls[0].get("code") or "none"}
        out.append((st, Choice("Which fact settles the next step?", options=[o for o, _ in opts], key="fact"), tgt))
    return out


def train(rows, epochs, seed, log):
    torch.manual_seed(seed); random.seed(seed)
    model = new_model()
    model.train()
    loss_fn = RLCDLoss(w_consistency=0.0)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)
    lab = [r for r in rows if r["label"] in ("useful", "noise")]
    useful = [r for r in lab if r["label"] == "useful"]; noise = [r for r in lab if r["label"] == "noise"]
    # Balance the classes: repeat the smaller class up to the larger one.
    small, big = (noise, useful) if len(noise) < len(useful) else (useful, noise)
    bal = big + (small * (len(big) // max(1, len(small)) + 1))[: len(big)] if small else big
    turns = turn_items(rows)
    t0 = time.time()
    for ep in range(epochs):
        random.shuffle(bal)
        tot = 0.0
        for i in range(0, len(bal), 32):
            b = bal[i:i + 32]
            tgt = torch.tensor([[0.9, 0.1] if r["label"] == "useful" else [0.1, 0.9] for r in b])
            loss = loss_fn(model, [line_state(r) for r in b], [KEEP], [tgt])
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item()
        for st, q, tgt in random.sample(turns, min(len(turns), 64)):
            loss = 0.5 * loss_fn(model, [st], [q], [tgt.unsqueeze(0)])
            opt.zero_grad(); loss.backward(); opt.step()
        if ep % 5 == 4 or ep == epochs - 1:
            log(f"  epoch {ep + 1}/{epochs} keep-loss {tot / max(1, len(bal) // 32):.3f} ({time.time() - t0:.0f}s)")
    model.eval()
    return model


@torch.no_grad()
def score(model, rows):
    out = []
    for i in range(0, len(rows), 64):
        b = rows[i:i + 64]
        probs, _ = model.logits([line_state(r) for r in b], [KEEP])[0]
        out += [{"id": r["id"], "score": round(float(p[0]), 5)} for r, p in zip(b, probs)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "data", "context-lines.jsonl"))
    ap.add_argument("--holdout", default="pilot-qwen-7b-r2")
    ap.add_argument("--loro", action="store_true", help="leave-one-run-out over every run with useful lines")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.data) if l.strip()]
    print(f"tokenizer {tokenizer_version()}", flush=True)
    runs = sorted({r["run"] for r in rows if r["label"] == "useful"}) if a.loro else [a.holdout]
    wdir = os.path.join(HERE, "weights"); os.makedirs(wdir, exist_ok=True)
    for hold in runs:
        tr = [r for r in rows if r["run"] != hold]; te = [r for r in rows if r["run"] == hold]
        print(f"holdout {hold}: train {sum(r['label'] != 'unclear' for r in tr)} labelled lines, test {len(te)} lines", flush=True)
        model = train(tr, a.epochs, a.seed, lambda s: print(s, flush=True))
        save_weights(model, os.path.join(wdir, f"context-{hold}.pt"), task="context", holdout=hold)
        with open(os.path.join(wdir, f"scores-{hold}.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(x) for x in score(model, te)) + "\n")
    print("params", sum(p.numel() for p in model.parameters()))


if __name__ == "__main__":
    main()
