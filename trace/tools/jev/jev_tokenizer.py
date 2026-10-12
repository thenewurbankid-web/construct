#!/usr/bin/env python3
"""The one tokenizer every jev script uses (serve.py, train_context.py, train_intent.py, ...) (#881).

open-jev ships a stand-in whitespace + CRC32 hash tokenizer: `src/ai/provider.mjs` and `apiKey` are one opaque
word each, unrelated words collide in 4096 buckets, and nothing is shared between `contextScore` and `scoreContext`.
This replaces it with a BPE (HuggingFace `tokenizers`, Apache-2.0, fully offline) trained on this
repo's own code, docs and bench logs, behind a code-aware pre-split:

  paths and dotted names   src/ai/provider.mjs   -> src / ai / provider . mjs
  camelCase / PascalCase   scoreContextLines     -> score context lines
  snake_case, kebab-case   max_state_len         -> max _ state _ len
  digits, punctuation      PAGE-008 {"a":1}      -> page - 008 { " a " : 1 }

The vocabulary (tokenizer.json, next to this file, committed) is sized to jev's embedding table (4096). Ids 0 and 1
are [PAD] and [UNK]; [PAD] = 0 matches open-jev's padding_idx.

Versioning: version() names the pre-split rules plus the vocabulary's hash. Weights are saved with it
(`save_weights`) and `load_weights` refuses weights saved under another tokenizer (or the old hash tokenizer, which
saved a bare state_dict) with a message naming both versions: token ids would mean different words, so such weights
answer noise without failing.

  .venv/bin/python tools/jev/jev_tokenizer.py --train          # rebuild tokenizer.json (deterministic)
  .venv/bin/python tools/jev/jev_tokenizer.py "scoreContext in src/ai/provider.mjs"   # show the pieces

In a script:  from jev_tokenizer import new_model, load_weights, save_weights   (tools/jev on sys.path)
"""
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VOCAB_FILE = os.path.join(HERE, "tokenizer.json")
VOCAB_SIZE = 4096
PRESPLIT_RULES = "code-split-v1"
SPECIAL = ["[PAD]", "[UNK]"]
# The context scorer holds this run out; its logs stay out of the vocabulary too, so the held-out eval sees text the
# tokenizer was not fitted on.
DEFAULT_EXCLUDE_RUNS = ("pilot-qwen-7b-r2",)

_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_PIECE = re.compile(r"[A-Za-z]+|[0-9]+|[^\sA-Za-z0-9]")


def presplit(text):
    """Code-aware words: camelCase and acronym boundaries split, letters / digits / each punctuation mark apart, lower-cased."""
    out = []
    for w in str(text if text is not None else "").split():
        for p in _PIECE.findall(w):
            if p[0].isalpha():
                out += [s.lower() for s in _CAMEL.split(p) if s]
            elif p[0].isdigit():
                out.append(p[:6])  # long numbers (ids, timestamps) carry no meaning past their prefix
            else:
                out.append(p)
    return out


def _version(path=VOCAB_FILE):
    with open(path, "rb") as f:
        return f"{PRESPLIT_RULES}+bpe{VOCAB_SIZE}-{hashlib.sha256(f.read()).hexdigest()[:12]}"


class JevTokenizer:
    """Drop-in for open-jev's HashTokenizer (encode / encode_batch / PAD / vocab_size), backed by the trained BPE."""

    PAD = 0

    def __init__(self, path=VOCAB_FILE):
        from tokenizers import Tokenizer

        if not os.path.exists(path):
            raise SystemExit(f"jev tokenizer: {path} is missing; build it with `python tools/jev/jev_tokenizer.py --train`")
        self.tok = Tokenizer.from_file(path)
        self.vocab_size = self.tok.get_vocab_size()
        if self.vocab_size > VOCAB_SIZE:
            raise SystemExit(f"jev tokenizer: vocabulary {self.vocab_size} exceeds jev's embedding table {VOCAB_SIZE}")
        self.version = _version(path)
        self._cache = {}

    def encode(self, text, max_len):
        key = (text, max_len)
        hit = self._cache.get(key)
        if hit is None:
            words = presplit(text)
            ids = self.tok.encode(" ".join(words)).ids[:max_len] if words else []
            hit = ids or [1]
            if len(self._cache) < 200_000:
                self._cache[key] = hit
        return list(hit)

    def encode_batch(self, texts, max_len):
        import torch

        seqs = [self.encode(t, max_len) for t in texts]
        length = max(len(s) for s in seqs)
        ids = torch.full((len(seqs), length), self.PAD, dtype=torch.long)
        for i, s in enumerate(seqs):
            ids[i, : len(s)] = torch.tensor(s, dtype=torch.long)
        return ids, ids.eq(self.PAD)


_SHARED = None


def get_tokenizer():
    global _SHARED
    if _SHARED is None:
        _SHARED = JevTokenizer()
    return _SHARED


def version():
    return get_tokenizer().version


# The model config every jev script shares; serve.py loads any weights saved with it.
CONFIG = dict(vocab_size=VOCAB_SIZE, d_model=128, n_heads=4, d_ff=512, n_state_layers=3, n_readout_layers=4)


def _open_jev():
    sys.path.insert(0, os.path.join(HERE, "open-jev"))
    from open_jev.main import Jev, JevConfig

    return Jev, JevConfig


def new_model(config=None):
    """A Jev with the shared config and this tokenizer (random weights until trained or loaded)."""
    Jev, JevConfig = _open_jev()
    return Jev(JevConfig(**(config or CONFIG)), tokenizer=get_tokenizer())


def save_weights(model, path, **meta):
    import torch

    torch.save({"tokenizer": version(), "config": CONFIG, "state_dict": model.state_dict(), **meta}, path)


def load_weights(model, path):
    """Load weights saved by save_weights; refuse weights from another tokenizer with a clear message."""
    import torch

    blob = torch.load(path, map_location="cpu", weights_only=False)
    saved = blob.get("tokenizer") if isinstance(blob, dict) and "state_dict" in blob else None
    if saved != version():
        was = saved or "open-jev's whitespace hash tokenizer (a bare state_dict, saved before #881's tokenizer)"
        raise SystemExit(
            f"jev: {path} was trained with tokenizer {was}, but this checkout uses {version()}. Token ids would mean "
            "different words, so the weights would answer noise. Retrain them (e.g. "
            "tools/jev/train_context.py) or check out the tokenizer.json they were trained with."
        )
    model.load_state_dict(blob["state_dict"])
    return blob


# ---- training the vocabulary ------------------------------------------------------------------------------------

CODE_EXT = (".mjs", ".js", ".ts", ".tsx", ".jsx", ".py", ".md", ".yml", ".yaml")
CODE_ROOTS = ("trace/src", "trace/tools", "packages", "docs", "ui/client/src", "ui/server")


def corpus(exclude_runs=DEFAULT_EXCLUDE_RUNS, max_file=200_000):
    """Repo code + docs (tracked files only) and the bench logs under data/runs (minus exclude_runs)."""
    root = subprocess.run(["git", "-C", HERE, "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
    files = subprocess.run(["git", "-C", root, "ls-files", "--", *CODE_ROOTS], capture_output=True, text=True, check=True).stdout.split("\n")
    files = sorted(f for f in files if f.endswith(CODE_EXT) and "/data/runs/" not in f and "node_modules" not in f)
    runs = os.path.join(HERE, "data", "runs")
    logs = sorted(
        os.path.join(runs, r, n) for r in os.listdir(runs) if r not in exclude_runs
        for n in os.listdir(os.path.join(runs, r)) if n.endswith(".jsonl")
    )
    for p in [os.path.join(root, f) for f in files] + logs:
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                text = fh.read(max_file)
        except OSError:
            continue
        for line in text.split("\n"):
            words = presplit(line)
            if words:
                yield words


def train_vocab(out=VOCAB_FILE, exclude_runs=DEFAULT_EXCLUDE_RUNS):
    from tokenizers import Tokenizer, models, pre_tokenizers, trainers

    tok = Tokenizer(models.BPE(unk_token="[UNK]"))
    tok.pre_tokenizer = pre_tokenizers.WhitespaceSplit()  # presplit() output joined by spaces
    trainer = trainers.BpeTrainer(vocab_size=VOCAB_SIZE, min_frequency=2, special_tokens=SPECIAL, show_progress=False)
    n = 0

    def it():
        nonlocal n
        for words in corpus(exclude_runs):
            n += 1
            yield " ".join(words)

    tok.train_from_iterator(it(), trainer=trainer)
    tok.save(out)
    return n, tok.get_vocab_size()


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--train", action="store_true", help="rebuild tokenizer.json from the repo and data/runs")
    ap.add_argument("--exclude-run", action="append", default=None, help=f"bench runs kept out (default {DEFAULT_EXCLUDE_RUNS})")
    ap.add_argument("text", nargs="*")
    a = ap.parse_args()
    if a.train:
        lines, size = train_vocab(exclude_runs=tuple(a.exclude_run or DEFAULT_EXCLUDE_RUNS))
        print(f"tokenizer.json: {size} tokens from {lines} lines, version {_version()}")
    for t in a.text:
        tk = get_tokenizer()
        ids = tk.encode(t, 256)
        print(json.dumps({"version": tk.version, "words": presplit(t), "pieces": [tk.tok.id_to_token(i) for i in ids], "ids": ids}))
