#!/usr/bin/env python3
"""A tiny HTTP wrapper around open-jev (https://github.com/kyegomez/open-jev), so line-matcher can call it.

  POST /choose  {"state": {...}, "questions": [{"key": "q1", "text": "...", "options": ["a", "b"]}, ...]}
             -> {"answers": [{"key", "choice", "probabilities", "confidence"}], "ms": 1.2}
  POST /choose  {"arm": "lr"|"nb"|"spacy"|"nli", ...}  -> the NLP arms (arms.py, #903): the same closed-choice endpoint,
             answered by scikit-learn, spaCy or a small NLI model instead of open-jev (no "arm", or "jev": open-jev)
  GET  /health -> {"ok": true, "weights": "random (seed 0)" | "<file>", "arms": {"lr": bool, ...}}

IMPORTANT: open-jev ships with RANDOM weights. It is an architecture, not a trained model, so its answers are
noise until it is trained. With random weights the answers are deterministic (fixed seed) but meaningless, and
the epistemic confidence is ~0. Pass --weights <file.pt> once you have trained weights.
"""
import argparse, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "open-jev"))
sys.path.insert(0, HERE)

import torch
from open_jev.main import Choice, Jev, JevConfig

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--weights", default="")
ap.add_argument("--arms-weights", default="", help="sklearn arms (train_arms.py); default weights/arms-sklearn.joblib")
ap.add_argument("--nli-model", default="", help="NLI arm model dir; default models/xtremedistil-zeroshot")
args = ap.parse_args()

from arms import Arms, DEFAULT_NLI, DEFAULT_SKLEARN  # noqa: E402

ARMS = Arms(args.arms_weights or DEFAULT_SKLEARN, args.nli_model or DEFAULT_NLI)

torch.manual_seed(args.seed)
model = Jev(JevConfig(vocab_size=4096, d_model=128, n_heads=4, d_ff=512, n_state_layers=3, n_readout_layers=4)).eval()
if args.weights:
    model.load_state_dict(torch.load(args.weights, map_location="cpu"))
WEIGHTS = args.weights or f"random (seed {args.seed})"


def answer(state, questions):
    qs = [Choice(q["text"], options=q["options"], key=q.get("key", f"q{i}")) for i, q in enumerate(questions)]
    t0 = time.perf_counter()
    with torch.no_grad():
        out = model([state], qs)[0]
    ms = (time.perf_counter() - t0) * 1000
    return {
        "answers": [{"key": a.key, "choice": a.choice, "probabilities": a.probabilities, "confidence": a.confidence} for a in out],
        "ms": round(ms, 2),
    }


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"ok": True, "weights": WEIGHTS, "arms": ARMS.health()}) if self.path == "/health" else self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/choose":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            arm = req.get("arm") or "jev"
            if arm == "jev":
                self._send(200, answer(req.get("state", {}), req["questions"]))
            else:
                t0 = time.perf_counter()
                out = ARMS.answer(arm, req)
                self._send(200, {**out, "arm": arm, "ms": round((time.perf_counter() - t0) * 1000, 2)})
        except Exception as e:  # a bad request must not kill the server
            self._send(400, {"error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"open-jev on http://127.0.0.1:{args.port}  weights: {WEIGHTS}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()
