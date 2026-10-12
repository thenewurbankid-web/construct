#!/usr/bin/env python3
"""Train open-jev as the drafter's intent classifier (#892), from data/intent-train.jsonl (build-intent-data.mjs).

Each request is one state ({part, facts}: the normalized request and its slots); jev answers the closed questions over
it in one forward pass, exactly as classifyJev.mjs asks them through the jev provider:
  verb    which change (add, update, ...)            object  which kind of thing (component, page, ...)
  slot    which of the request's slots, or none      layer:* yes/no per layer (ui, workflow, data, api, library)
Targets are soft (0.9 on gold, 0.1 spread over the rest), never one-hot, as open-jev's RLCD loss expects. Rows with
split "test" are held out (the same seeded split eval-intent.mjs reports as "held-out").

The model config and tokenizer come from jev_tokenizer.py (#881, shared with serve.py), so the weights load with
`serve.py --weights weights/intent.pt` and carry the tokenizer version.

  node trace/tools/jev/build-intent-data.mjs --seed 0
  packages/tools/dev/heavy.sh trace/tools/jev/.venv/bin/python trace/tools/jev/train_intent.py
  (cd trace && tools/jev/.venv/bin/python tools/jev/serve.py --weights tools/jev/weights/intent.pt)
  node trace/tools/jev/eval-intent.mjs --seed 0
Writes weights/intent.pt (gitignored) and prints held-out accuracy per question as a quick check (eval-intent is the
real report: it runs the live provider path).
"""
import argparse, json, os, random, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "open-jev"))

import torch
from open_jev.main import Choice, RLCDLoss
from jev_tokenizer import new_model, save_weights


def soft(n, gold):
    t = torch.full((n,), 0.1 / max(1, n - 1))
    t[gold] = 0.9
    return t / t.sum()


def items(rows):
    """(state, Choice, soft target, gold index) per labelled question."""
    out = []
    for r in rows:
        for q in r["questions"]:
            if q["gold"] is None or len(q["options"]) < 2:
                continue
            # key "choice" as the provider sends it; the question text tells the questions apart
            out.append((r["state"], Choice(q["text"], options=q["options"], key="choice"), soft(len(q["options"]), q["gold"]), q["gold"], q["key"]))
    return out


def train(tr, epochs, seed, log):
    torch.manual_seed(seed); random.seed(seed)
    model = new_model()
    model.train()
    loss_fn = RLCDLoss(w_consistency=0.0)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)
    # Group items by question text + option count so a batch shares one Choice (one forward pass per batch).
    groups = {}
    for st, q, tgt, g, key in tr:
        groups.setdefault((q.text, tuple(q.options)), []).append((st, q, tgt))
    batches = []
    for lst in groups.values():
        for i in range(0, len(lst), 16):
            batches.append(lst[i:i + 16])
    t0 = time.time()
    for ep in range(epochs):
        random.shuffle(batches)
        tot = 0.0
        for b in batches:
            q = b[0][1]
            loss = loss_fn(model, [x[0] for x in b], [q], [torch.stack([x[2] for x in b])])
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item()
        if ep % 10 == 9 or ep == epochs - 1:
            log(f"  epoch {ep + 1}/{epochs} loss {tot / max(1, len(batches)):.3f} ({time.time() - t0:.0f}s)")
    model.eval()
    return model


@torch.no_grad()
def accuracy(model, te):
    hit, n = {}, {}
    for st, q, _, g, key in te:
        k = key.split(":")[0]
        probs, _ = model.logits([st], [q])[0]
        n[k] = n.get(k, 0) + 1
        hit[k] = hit.get(k, 0) + int(int(probs[0].argmax()) == g)
    return {k: f"{hit[k]}/{n[k]}" for k in sorted(n)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "data", "intent-train.jsonl"))
    ap.add_argument("--out", default=os.path.join(HERE, "weights", "intent.pt"))
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--all", action="store_true", help="train on every row (no held-out; use once the eval says it wins)")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.data) if l.strip()]
    tr_rows = rows if a.all else [r for r in rows if r["split"] == "train"]
    te_rows = [r for r in rows if r["split"] == "test"]
    tr, te = items(tr_rows), items(te_rows)
    print(f"train {len(tr_rows)} requests ({len(tr)} questions), held-out {len(te_rows)} requests ({len(te)} questions)", flush=True)
    model = train(tr, a.epochs, a.seed, lambda s: print(s, flush=True))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    save_weights(model, a.out, task="intent", seed=a.seed, all=a.all)
    print("held-out accuracy per question:", accuracy(model, te))
    print(f"weights -> {os.path.relpath(a.out)}")


if __name__ == "__main__":
    main()
