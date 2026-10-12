"""Unit tests for the sidecar arms (#903) on tiny fixtures. Run: tools/jev/.venv/bin/python -m pytest tools/jev/test_arms.py"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arms  # noqa: E402


def tok(t, slot=None, kind=None):
    return {"t": t, "slot": slot, "kind": kind} if slot else {"t": t}


def row(words, slots, intent, slot, layers):
    tokens = [tok(w) if not w.startswith("<") else tok(w, w[1:-1].split(":")[1], w[1:-1].split(":")[0]) for w in words]
    return {"read": {"tokens": tokens, "slots": slots}, "gold": {"intent": intent, "object": intent.split(".")[1], "slot": slot, "layers": layers}}


F = {"F1": {"kind": "feature", "layers": ["ui"]}}
P = {"P1": {"kind": "page", "itemKind": "pages", "layer": "ui", "area": "feature"}}
L = {"L1": {"kind": "library", "itemKind": "components", "layer": "library", "area": "library"}}
ROWS = [
    row(["add", "a", "<library:L1>", "to", "<feature:F1>"], {**L, **F}, "add.component", "F1", ["ui"]),
    row(["add", "<library:L1>", "to", "the", "<page:P1>"], {**L, **P}, "add.component", "P1", ["ui"]),
    row(["put", "a", "<library:L1>", "on", "<feature:F1>"], {**L, **F}, "add.component", "F1", ["ui"]),
    row(["fix", "the", "problem", "in", "<feature:F1>"], F, "fix.problem", "F1", ["ui", "workflow"]),
    row(["fix", "the", "errors"], {}, "fix.problem", None, ["ui", "workflow"]),
    row(["repair", "the", "<page:P1>", "problem"], P, "fix.problem", "P1", ["ui"]),
]
Q = [
    {"key": "intent", "options": ["add.component", "fix.problem", "update.prop", "unknown"]},
    {"key": "object", "options": ["component", "problem", "prop", "none"]},
    {"key": "layer:workflow", "options": ["yes", "no"]},
    {"key": "layer:api", "options": ["yes", "no"]},
]


def test_text_features_hide_names_and_keep_slot_kinds():
    f = arms.text_features(ROWS[1]["read"])
    assert "slot_library" in f and "slot_page" in f and "itemkind_pages" in f
    assert "<" not in f


@pytest.mark.parametrize("kind", ["lr", "nb"])
def test_sklearn_arm_answers_closed_options(kind):
    bundle = arms.train(ROWS, kind)
    probe = row(["add", "a", "<library:L1>", "to", "<feature:F1>"], {**L, **F}, "add.component", "F1", ["ui"])["read"]
    out = arms.answer_sklearn(bundle, {"read": probe, "questions": Q + [{"key": "slot", "options": ["L1", "F1", "none"]}]})
    by = {a["key"]: a for a in out["answers"]}
    assert by["intent"]["choice"] == "add.component"
    assert set(by["intent"]["probabilities"]) == set(Q[0]["options"])
    assert by["intent"]["probabilities"]["update.prop"] == 0.0  # never seen in training: no mass
    assert abs(sum(by["intent"]["probabilities"].values()) - 1) < 1e-6
    assert by["layer:api"]["choice"] == "no"  # a label that never varied is a constant
    assert by["slot"]["choice"] == "F1"


def test_slot_candidates_end_with_none():
    c = arms.slot_candidates(ROWS[0]["read"])
    assert [s for s, _ in c] == ["L1", "F1", "none"]
    assert c[1][1]["prev=to"] == 1


@pytest.mark.skipif(not arms._has_module("en_core_web_sm"), reason="spaCy model not installed")
def test_spacy_ruler_merges_a_name_before_the_parse():
    a = arms.SpacyArm()
    words = ["please", "add", "a", "Button", "to", "the", "orders", "page"]
    out = a.parse({"words": words, "stamp": "s1", "patterns": [{"label": "ITEM", "pattern": "orders page", "id": "item:orders/pages/OrdersPage"}]})["parse"]
    page = next(t for t in out if t["ws"] == [6, 8])
    assert page["ent"] == "item:orders/pages/OrdersPage"
    root = next(t for t in out if t["dep"] == "ROOT")
    assert root["lemma"] == "add"


@pytest.mark.skipif(not os.path.isdir(arms.DEFAULT_NLI), reason="NLI model not fetched")
def test_nli_arm_single_and_multi():
    a = arms.NliArm()
    out = a.answer({"premise": "add a Button to the orders page", "questions": [
        {"key": "verb", "options": ["add", "remove"], "hypotheses": ["The request asks to add something new.", "The request asks to remove something."]},
        {"key": "layers", "multi": True, "options": ["ui", "api"], "hypotheses": ["It changes what is shown on screen.", "It changes a backend service."]},
    ]})["answers"]
    assert out[0]["choice"] == "add"
    assert abs(sum(out[0]["probabilities"].values()) - 1) < 1e-6
    assert all(0 <= p <= 1 for p in out[1]["probabilities"].values())


def test_unknown_arm_is_an_error():
    with pytest.raises(ValueError):
        arms.Arms().answer("gpt", {})
