#!/usr/bin/env python3
"""Train the scikit-learn arms (#903): logistic regression and naive Bayes on the gold labels' TRAIN split.

  node trace/tools/jev/build-arms-data.mjs --seed 0                     # gold -> data/arms-train.jsonl (same split as eval-intent)
  packages/tools/dev/heavy.sh trace/tools/jev/.venv/bin/python trace/tools/jev/train_arms.py
  -> weights/arms-sklearn.joblib (gitignored), loaded by serve.py's lr / nb arms

Only rows with split "train" are fitted; held-out rows stay for eval-intent.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from arms import DEFAULT_SKLEARN, SKLEARN_ARMS, load_rows, train  # noqa: E402

if __name__ == "__main__":
    import joblib

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "data", "arms-train.jsonl"))
    ap.add_argument("--out", default=DEFAULT_SKLEARN)
    ap.add_argument("--all", action="store_true", help="fit every row (no held-out); only for a shipped model after the eval")
    args = ap.parse_args()
    rows = [r for r in load_rows(args.data) if args.all or r["split"] == "train"]
    if not rows:
        sys.exit(f"no training rows in {args.data}")
    bundle = {k: train(rows, k) for k in SKLEARN_ARMS}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    joblib.dump(bundle, args.out)
    print(f"{len(rows)} rows -> {os.path.relpath(args.out)} ({', '.join(SKLEARN_ARMS)})")
