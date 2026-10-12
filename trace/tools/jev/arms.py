"""NLP arms for the beam (#903, part of #900): closed-choice readers that run beside jev in the same sidecar (serve.py).

Every arm answers CLOSED questions only: the options come from the caller (catalog ids, slot ids, yes/no), and an arm
returns a probability per option, never free text. serve.py routes `POST /choose {"arm": "<name>", ...}` here; without
`arm` (or with "jev") the request goes to open-jev as before.

  lr / nb  scikit-learn logistic regression / naive Bayes over the NORMALIZED request (slot tokens, no project names),
           trained on data/intent-gold.jsonl's train split (train_arms.py). The bar jev must beat.
             req: {read: {tokens: [{t, slot?, kind?}], slots: {id: shape}}, questions: [{key, options}]}
             keys: "intent", "object", "slot" (options: slot ids + "none"), "layer:<l>" (options: yes, no)
  spacy    a dependency parse of the request's own words, with an EntityRuler built from the project's domain map
           (drafter/domainMap.mjs buildDomainMap), so a multi-word name is one token before the parser sees it.
             req: {words: [...], patterns: [{label, pattern, id}], stamp}
             -> {parse: [{i, ws: [start, end), text, lemma, pos, dep, head, ent}]}  (the caller feeds it to classify)
  nli      zero-shot entailment with a small NLI cross-encoder over the closed labels (hypothesis per option).
             req: {premise, questions: [{key, options, hypotheses, multi?}]}

Answers use serve.py's shape: {"answers": [{"key", "choice", "probabilities": {option: p}, "confidence"}]}.
Heavy libraries load lazily, per arm, on first use.
"""
import json
import os
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SKLEARN = os.path.join(HERE, "weights", "arms-sklearn.joblib")
DEFAULT_NLI = os.path.join(HERE, "models", "xtremedistil-zeroshot")
SKLEARN_ARMS = ("lr", "nb")
ARMS = ("lr", "nb", "spacy", "nli")
LAYERS = ("ui", "workflow", "data", "api", "library")


# ------------------------------------------------------------------------------------------------ features

def _norm_word(t):
    return str(t).lower()


def text_features(read):
    """The normalized request as one string of feature words: words as they are, a slot as `slot_<kind>`, and each
    slot's shape facts (item kind, layer, area, what a missing name stands for, a handler prop)."""
    out = []
    for tok in read.get("tokens", []):
        if tok.get("slot"):
            out.append(f"slot_{tok.get('kind') or 'unknown'}")
        else:
            out.append(_norm_word(tok.get("t", "")))
    for sid, sh in sorted((read.get("slots") or {}).items()):
        sh = sh or {}
        for k in ("itemKind", "layer", "area", "of"):
            if sh.get(k):
                out.append(f"{k.lower()}_{sh[k]}")
        if sh.get("handler"):
            out.append("handlerprop")
    return " ".join(w.replace(" ", "_") for w in out if w)


def slot_candidates(read):
    """Each slot of the request (in order of appearance, once) plus "none", with the features a ranker scores."""
    toks = read.get("tokens", [])
    slots = read.get("slots") or {}
    order = []
    for i, tok in enumerate(toks):
        s = tok.get("slot")
        if s and s not in [o for o, _ in order]:
            order.append((s, i))
    n = len(order)
    cands = []
    for j, (s, i) in enumerate(order):
        sh = slots.get(s) or {}
        prev = [_norm_word(toks[k].get("t")) for k in range(max(0, i - 2), i) if not toks[k].get("slot")]
        f = {
            "kind=" + str(sh.get("kind") or s[0]): 1,
            "itemKind=" + str(sh.get("itemKind")): 1,
            "layer=" + str(sh.get("layer")): 1,
            "area=" + str(sh.get("area")): 1,
            "first": int(j == 0),
            "last": int(j == n - 1),
            "fromEnd=" + str(min(n - 1 - j, 3)): 1,
            "n=" + str(min(n, 4)): 1,
        }
        if prev:
            f["prev=" + prev[-1]] = 1
            f["prev:" + "+".join(prev)] = 1
            f["kindPrev=" + str(sh.get("kind")) + "|" + prev[-1]] = 1
        cands.append((s, f))
    cands.append(("none", {"none": 1, "n=" + str(min(n, 4)): 1}))
    return cands


# ------------------------------------------------------------------------------------------------ sklearn

def _make(kind):
    from sklearn.feature_extraction.text import CountVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.naive_bayes import MultinomialNB
    from sklearn.pipeline import make_pipeline

    vec = CountVectorizer(ngram_range=(1, 2), binary=True, token_pattern=r"[^ ]+")
    clf = LogisticRegression(C=4.0, max_iter=4000) if kind == "lr" else MultinomialNB(alpha=0.3)
    return make_pipeline(vec, clf)


def _make_ranker(kind):
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.naive_bayes import BernoulliNB
    from sklearn.pipeline import make_pipeline

    return make_pipeline(DictVectorizer(), LogisticRegression(C=4.0, max_iter=4000) if kind == "lr" else BernoulliNB(alpha=0.3))


class _Const:
    """A label that never varied in training: its one value with probability 1."""

    def __init__(self, value):
        self.classes_ = [value]

    def predict_proba(self, X):
        return [[1.0] for _ in X]


def _fit(model, X, y):
    if len(set(y)) < 2:
        return _Const(y[0] if y else "none")
    model.fit(X, y)
    return model


def train(rows, kind):
    """Fit one sklearn arm ("lr" or "nb") on training rows: {read, gold: {intent, object, slot (slot id|null), layers}}."""
    X = [text_features(r["read"]) for r in rows]
    bundle = {"kind": kind, "intent": _fit(_make(kind), X, [r["gold"]["intent"] for r in rows]),
              "object": _fit(_make(kind), X, [r["gold"]["object"] or "none" for r in rows]), "layers": {}}
    for l in LAYERS:
        bundle["layers"][l] = _fit(_make(kind), X, ["yes" if l in r["gold"]["layers"] else "no" for r in rows])
    RX, Ry = [], []
    for r in rows:
        gold = r["gold"]["slot"] or "none"
        for s, f in slot_candidates(r["read"]):
            RX.append(f)
            Ry.append("yes" if s == gold else "no")
    bundle["slot"] = _fit(_make_ranker(kind), RX, Ry)
    return bundle


def _dist(model, x, options):
    probs = model.predict_proba([x])[0]
    by = {str(c): float(p) for c, p in zip(model.classes_, probs)}
    d = {o: by.get(o, 0.0) for o in options}
    z = sum(d.values())
    return {o: (p / z if z else 1.0 / len(options)) for o, p in d.items()}


def _answer(key, dist):
    choice = max(dist, key=lambda o: dist[o])
    return {"key": key, "choice": choice, "probabilities": dist, "confidence": round(dist[choice], 4)}


def answer_sklearn(bundle, req):
    read = req["read"]
    x = text_features(read)
    out = []
    for q in req["questions"]:
        key, options = q["key"], list(q["options"])
        if key == "intent":
            d = _dist(bundle["intent"], x, options)
        elif key == "object":
            d = _dist(bundle["object"], x, options)
        elif key.startswith("layer:"):
            m = bundle["layers"].get(key[6:])
            d = _dist(m, x, options) if m is not None else {o: 1.0 / len(options) for o in options}
        elif key == "slot":
            cands = dict(slot_candidates(read))
            m = bundle["slot"]
            raw = {}
            for o in options:
                f = cands.get(o)
                if f is None:
                    raw[o] = 0.0
                    continue
                pr = dict(zip([str(c) for c in m.classes_], m.predict_proba([f])[0]))
                raw[o] = float(pr.get("yes", 0.0))
            z = sum(raw.values())
            d = {o: (p / z if z else 1.0 / len(options)) for o, p in raw.items()}
        else:
            raise ValueError(f"{bundle['kind']} cannot answer question {key!r}")
        out.append(_answer(key, d))
    return {"answers": out}


# ------------------------------------------------------------------------------------------------ spaCy

class SpacyArm:
    """en_core_web_sm with an EntityRuler (patterns from the domain map) and merge_entities before the parser."""

    def __init__(self, model="en_core_web_sm"):
        import spacy

        self.nlp = spacy.load(model, exclude=["ner"])
        self.ruler = self.nlp.add_pipe("entity_ruler", first=True, config={"phrase_matcher_attr": "LOWER", "overwrite_ents": True})
        self.nlp.add_pipe("merge_entities", after="entity_ruler")
        self.stamp = None
        self.lock = threading.Lock()

    def set_patterns(self, patterns, stamp):
        if stamp is not None and stamp == self.stamp:
            return
        self.ruler.clear()
        if patterns:
            self.ruler.add_patterns([{"label": p["label"], "pattern": p["pattern"], "id": p.get("id", "")} for p in patterns])
        self.stamp = stamp

    def parse(self, req):
        from spacy.tokens import Doc

        words = [str(w).replace(" ", "_") or "_" for w in req["words"]]
        with self.lock:
            self.set_patterns(req.get("patterns") or [], req.get("stamp"))
            doc = self.nlp(Doc(self.nlp.vocab, words=words))
        # Map each (possibly merged) token back to the caller's word indices through character offsets.
        starts, pos = [], 0
        for w in words:
            starts.append(pos)
            pos += len(w) + 1
        def word_at(ch):
            j = 0
            for k, s in enumerate(starts):
                if s <= ch:
                    j = k
            return j
        out = []
        for t in doc:
            a = word_at(t.idx)
            b = word_at(t.idx + max(len(t.text) - 1, 0)) + 1
            out.append({"i": t.i, "ws": [a, b], "text": t.text, "lemma": t.lemma_.lower(), "pos": t.pos_, "dep": t.dep_, "head": t.head.i,
                        "ent": (t.ent_id_ or t.ent_type_ or None) if t.ent_type_ else None})
        return {"parse": out}


# ------------------------------------------------------------------------------------------------ NLI zero-shot

class NliArm:
    """A small NLI cross-encoder as a zero-shot classifier: P(entailment) of "premise => hypothesis" per option."""

    def __init__(self, path=DEFAULT_NLI):
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(path)
        self.model = AutoModelForSequenceClassification.from_pretrained(path).eval()
        l2i = {k.lower(): v for k, v in self.model.config.label2id.items()}
        self.ent = l2i.get("entailment", 0)
        self.neg = l2i.get("contradiction", l2i.get("not_entailment", 1 if self.ent == 0 else 0))
        self.name = os.path.basename(os.path.normpath(path))

    def logits(self, premise, hypotheses):
        import torch

        enc = self.tok([premise] * len(hypotheses), hypotheses, return_tensors="pt", padding=True, truncation=True, max_length=128)
        with torch.no_grad():
            return self.model(**enc).logits

    def answer(self, req):
        import torch

        out = []
        for q in req["questions"]:
            options, hyps = list(q["options"]), list(q["hypotheses"])
            if len(options) != len(hyps):
                raise ValueError(f"question {q['key']}: one hypothesis per option")
            lg = self.logits(req["premise"], hyps)
            if q.get("multi"):
                # Each option on its own: entailment against its negative class.
                pr = torch.softmax(lg[:, [self.ent, self.neg]], dim=-1)[:, 0].tolist()
            else:
                pr = torch.softmax(lg[:, self.ent], dim=-1).tolist()
            out.append(_answer(q["key"], {o: float(p) for o, p in zip(options, pr)}))
        return {"answers": out}


# ------------------------------------------------------------------------------------------------ dispatch

class Arms:
    """The sidecar's arms, each loaded on first use. A missing model or weights file is an error for that arm only."""

    def __init__(self, sklearn_path=DEFAULT_SKLEARN, nli_path=DEFAULT_NLI):
        self.sklearn_path, self.nli_path = sklearn_path, nli_path
        self._sk, self._spacy, self._nli = None, None, None
        self.lock = threading.Lock()

    def sklearn(self):
        with self.lock:
            if self._sk is None:
                import joblib

                if not os.path.exists(self.sklearn_path):
                    raise FileNotFoundError(f"no sklearn arms at {self.sklearn_path}: run train_arms.py")
                self._sk = joblib.load(self.sklearn_path)
            return self._sk

    def spacy(self):
        with self.lock:
            if self._spacy is None:
                self._spacy = SpacyArm()
            return self._spacy

    def nli(self):
        with self.lock:
            if self._nli is None:
                self._nli = NliArm(self.nli_path)
            return self._nli

    def answer(self, arm, req):
        if arm in SKLEARN_ARMS:
            return answer_sklearn(self.sklearn()[arm], req)
        if arm == "spacy":
            return self.spacy().parse(req)
        if arm == "nli":
            return self.nli().answer(req)
        raise ValueError(f"unknown arm {arm!r} (one of {', '.join(ARMS)}, or jev)")

    def health(self):
        return {"lr": os.path.exists(self.sklearn_path), "nb": os.path.exists(self.sklearn_path),
                "spacy": _has_module("en_core_web_sm"), "nli": os.path.isdir(self.nli_path)}


def _has_module(name):
    import importlib.util

    return importlib.util.find_spec(name) is not None


def load_rows(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]
