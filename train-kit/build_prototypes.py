#!/usr/bin/env python3
"""Build the prototype set of Construct's local embedding classifier (#645), on THIS machine, from a dataset bundle.

A dataset bundle is what `construct traces export --yes` wrote. This script reads it (verified against its manifest hash, by the same
code as train_features.py), collects for every closed question ("route") the words people chose each option for on the TRAIN split,
keeps the most frequent ones as PROTOTYPES (at most `max_per_class` per option), optionally merges a curated seed file first, evaluates
on the validation and test splits against the rules baseline, and writes a model bundle:

    prototypes.json    the prototype words per option and the embedder settings, plain JSON (schema construct.prototypes-model.v1)
    eval-report.json   accuracy per chooser against the rules baseline, on validation and test
    MODEL_CARD.md      what it is, the dataset hash, base model (none), licence note, limits
    manifest.json      schema construct.model-bundle.v1, kind "prototypes", name, version, dataset hash, sha256 of the files
    checksums.txt      sha256 of every other file (sha256sum format)

Nothing is learned by gradient descent: a prototype set is a list of words, reviewed like a rule fixture. The embedding (`embed.v1`, signed
hashing of character n-grams) repeats packages/core/decision-prototypes.mjs exactly, so what is measured here is what Construct scores
after the import; the tests on both sides prove the two agree on the fixture. Pure Python 3 standard library, no Construct code, no network.

    python3 build_prototypes.py --dataset <bundle dir> --out <model dir> [--config prototypes.config.json] [--seed seed.json] [--created-at ISO]

The curated seed (`--seed`) is JSON: { "routes": { "<route>": { "<option id>": ["word", ...] } } } where a route is the question with quoted
words blanked plus its option ids (see `route_of`), for example the 3-5 example words per layer of the project's real layer graph.

Exit codes: 0 done, 2 the dataset or the arguments are refused (message on stderr), 124 the time limit was hit.
"""
import argparse
import json
import math
import os
import re
import sys
import time

import train_features as tf

PROTOTYPES_SCHEMA = 'construct.prototypes-model.v1'
EMBED_KIND = 'char-ngram-hash'
EMBED_VERSION = 'embed.v1'
TRAINER = {'name': 'train-kit/build_prototypes.py', 'version': '1'}
HERE = os.path.dirname(os.path.abspath(__file__))
PROTOTYPE_RE = re.compile(r'^[a-z0-9]+(?: [a-z0-9]+)*$')
LIMITS = {'routes': 64, 'classes': 8, 'per_class': 100, 'total': 5000, 'word': 40}

DEFAULTS = {
    'min_score': 0.1,
    'min_margin': 0.0,
    'min_train_per_route': 5,
    'max_per_class': 30,
    'dim': 256,
    'ngrams': [2, 3, 4],
    'model_name': 'layer-proto',
    'time_limit_seconds': 600,
}


# ---------------------------------------------------------------- embed.v1 (mirror of packages/core/decision-prototypes.mjs)

def fnv1a(text):
    h = 0x811C9DC5
    for byte in text.encode('ascii'):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def embed_text(text, dim, ngrams):
    ws = tf.words(text)
    if not ws:
        return None
    vec = [0.0] * dim
    for w in ws:
        s = '<' + w + '>'
        for n in ngrams:
            for i in range(len(s) - n + 1):
                h = fnv1a(s[i:i + n])
                vec[h % dim] += -1.0 if (h >> 31) else 1.0
    total = 0.0
    for x in vec:
        total += x * x
    if total == 0.0:
        return None
    norm = math.sqrt(total)
    return [x / norm for x in vec]


def dot(a, b):
    s = 0.0
    for x, y in zip(a, b):
        s += x * y
    return s


def subject_of(summary):
    quoted = re.search(r'"([^"]{1,40})"', tf.ascii_only(summary.get('question')))
    if not quoted:
        return None
    subject = ' '.join(tf.words(quoted.group(1)))
    return subject or None


def compile_model(model):
    """Embed every prototype once: route -> [(option, [words], [vectors])]."""
    emb = model['embedder']
    compiled = {}
    for route, r in model['routes'].items():
        classes = []
        for option in r['classes']:
            kept, vectors = [], []
            for word in r['prototypes'].get(option, []):
                v = embed_text(word, emb['dim'], emb['ngrams'])
                if v is not None:
                    kept.append(word)
                    vectors.append(v)
            classes.append((option, kept, vectors))
        compiled[route] = classes
    return compiled


def make_scorer(model):
    """The scorer of decision-prototypes.mjs: {option, score, runnerUp} or None (abstain)."""
    compiled = compile_model(model)
    emb = model['embedder']

    def scorer(_model, summary):
        classes = compiled.get(tf.route_of(summary))
        if classes is None:
            return None
        subject = subject_of(summary)
        if subject is None:
            return None
        query = embed_text(subject, emb['dim'], emb['ngrams'])
        if query is None:
            return None
        enabled = set(o['id'] for o in summary.get('options', []) if isinstance(o, dict) and o.get('enabled') is True)
        ranked = []
        for option, _words, vectors in classes:
            if option not in enabled or not vectors:
                continue
            ranked.append((option, max(dot(query, v) for v in vectors)))
        if not ranked:
            return None
        ranked.sort(key=lambda x: (-x[1], x[0]))
        best = ranked[0]
        second = ranked[1] if len(ranked) > 1 else None
        sim = max(0.0, min(1.0, best[1]))
        if sim < model['minScore']:
            return None
        if second is not None and best[1] - second[1] < model['minMargin']:
            return None
        return {'option': best[0], 'score': sim, 'runnerUp': second[0] if second else None}

    return scorer


# ---------------------------------------------------------------- building the prototype set

def load_seed(path):
    if not path:
        return {}
    try:
        with open(path, 'rb') as f:
            seed = json.loads(f.read().decode('utf-8'))
    except (OSError, ValueError, UnicodeDecodeError):
        raise tf.Refused('the seed file is not readable JSON')
    routes = seed.get('routes') if isinstance(seed, dict) else None
    if not isinstance(routes, dict):
        raise tf.Refused('the seed file must be { "routes": { "<route>": { "<option>": ["word", ...] } } }')
    out = {}
    for route, classes in routes.items():
        if not isinstance(classes, dict):
            raise tf.Refused('seed route %r must map option ids to word lists' % route[:40])
        for option, words in classes.items():
            if not isinstance(words, list):
                raise tf.Refused('seed %r / %r must be a list of words' % (route[:40], option))
            for word in words:
                clean = ' '.join(tf.words(word))
                if not clean or len(clean) > LIMITS['word'] or not PROTOTYPE_RE.match(clean):
                    raise tf.Refused('seed word %r is not a lowercase word of letters and digits' % str(word)[:40])
                out.setdefault(route, {}).setdefault(option, []).append(clean)
    return out


def build_model(records, cfg, dataset_hash, seed):
    counts = {}
    chooser_ids = {}
    examples = {}
    for split, trace in records:
        if split != 'train' or trace.get('by') != 'person':
            continue
        summary = trace['summary']
        chosen = trace.get('chosen')
        if chosen not in trace.get('options', []):
            continue  # an "exit" is not a class of the question
        subject = subject_of(summary)
        route = tf.route_of(summary)
        chooser_ids.setdefault(route, set()).add(trace['chooser']['id'])
        examples[route] = examples.get(route, 0) + 1
        if subject is None or len(subject) > LIMITS['word']:
            continue
        per = counts.setdefault(route, {}).setdefault(chosen, {})
        per[subject] = per.get(subject, 0) + 1
    routes, skipped = {}, {}
    for route in sorted(set(counts) | set(seed)):
        if route not in seed and examples.get(route, 0) < cfg['min_train_per_route']:
            skipped[route] = examples.get(route, 0)
            continue
        prototypes = {}
        for option in sorted(set(counts.get(route, {})) | set(seed.get(route, {}))):
            curated = list(dict.fromkeys(seed.get(route, {}).get(option, [])))
            seen = counts.get(route, {}).get(option, {})
            ranked = [w for w, _ in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0])) if w not in curated]
            words = (curated + ranked[:max(0, cfg['max_per_class'] - len(curated))])[:LIMITS['per_class']]
            if words:
                prototypes[option] = words
        if not prototypes:
            continue
        entry = {'classes': sorted(prototypes), 'prototypes': prototypes, 'trainCount': examples.get(route, 0)}
        if route in chooser_ids:
            entry['choosers'] = sorted(chooser_ids[route])
        routes[route] = entry
    if len(routes) > LIMITS['routes']:
        raise tf.Refused('more than %d routes; raise min_train_per_route' % LIMITS['routes'])
    total = sum(len(w) for r in routes.values() for w in r['prototypes'].values())
    if total > LIMITS['total']:
        raise tf.Refused('more than %d prototypes; lower max_per_class' % LIMITS['total'])
    model = {
        'schema': PROTOTYPES_SCHEMA,
        'embedder': {'kind': EMBED_KIND, 'version': EMBED_VERSION, 'dim': cfg['dim'], 'ngrams': cfg['ngrams']},
        'minScore': cfg['min_score'],
        'minMargin': cfg['min_margin'],
        'trainedOn': {'datasetHash': dataset_hash},
        'routes': routes,
    }
    return model, skipped, total


# ---------------------------------------------------------------- the bundle

def model_card(name, version, dataset_hash, cfg, counts, routes, skipped, total, seeded):
    lines = [
        '# Model card: %s %s' % (name, version), '',
        'A local nearest-prototype classifier for Construct\'s decision seam. For each closed question ("route") it holds example words per',
        'option (prototypes). A new word is embedded (`embed.v1`: signed hashing of its character n-grams, no dictionary, no model download)',
        'and compared with them by cosine similarity; it suggests the option of the closest example or abstains. It never executes anything.', '',
        '- **Trained on:** dataset `%s` (%d train / %d validation / %d test records), the TRAIN split only.' % (dataset_hash, counts['train'], counts['validation'], counts['test']),
        '- **Prototypes:** %d words over %d routes (%s), at most %d per option%s.' % (total, len(routes), ', '.join(sorted(set(c for r in routes.values() for c in r.get('choosers', [])))) or 'none', cfg['max_per_class'], '; a curated seed file was merged first' if seeded else ''),
        '- **Base model:** none. No pretrained weights and no embedding table: the embedding is a fixed function (`embed.v1`, MIT, Construct).',
        '- **Licence note:** the prototypes come only from the decision traces of the project that exported the dataset%s. They carry no third-party model or dataset licence; who may use them is decided by whoever owns those traces.' % (' and the curated seed (reviewed like a rule fixture)' if seeded else ''),
        '- **Routes skipped for too little data:** %d.' % len(skipped), '',
        '## Limits', '',
        '- It knows only the questions it saw at least %d times (or that the seed names); on any other question, or one that quotes no word, it abstains.' % cfg['min_train_per_route'],
        '- Character n-grams capture shared stems and endings ("invoices", "invoice"), not meaning: an unrelated synonym is not close. A neural embedding (a static table, bge-small, MiniLM) would, and belongs in a later `embedder.version` that must beat this one on replay.',
        '- Read eval-report.json before trusting it. `construct model import` replays held-out records against the rules baseline and stays disabled until you enable it.', '',
    ]
    return '\n'.join(lines)


def write_bundle(out_dir, manifest_in, records, model, skipped, total, cfg, created_at, started, seeded):
    dataset_hash = manifest_in['datasetHash']
    counts = manifest_in['counts']
    scorer = make_scorer(model)
    validation_by, validation_all = tf.evaluate(records, model, 'validation', scorer)
    test_by, test_all = tf.evaluate(records, model, 'test', scorer)
    name = cfg['model_name']
    version = '%s-%s' % (TRAINER['version'], dataset_hash[:8])
    report = {
        'schema': 'construct.eval-report.v1',
        'datasetHash': dataset_hash,
        'trainer': TRAINER,
        'config': {k: cfg[k] for k in sorted(DEFAULTS)},
        'splits': {'train': counts['train'], 'validation': counts['validation'], 'test': counts['test']},
        'routes': {'built': len(model['routes']), 'skippedForTooLittleData': len(skipped), 'prototypes': total},
        'validation': {'overall': validation_all, 'byChooser': validation_by},
        'test': {'overall': test_all, 'byChooser': test_by},
        'note': 'accuracy counts an abstention as a miss; rulesAgreement is the baseline (first enabled option); recordedSuggestionAgreement is how often the recorded suggestion was the chosen option',
        'peakMemoryMB': tf.peak_memory_mb(),
        'elapsedSeconds': round(time.time() - started, 2),
    }
    texts = {'prototypes.json': tf.dump(model), 'eval-report.json': tf.dump(report), 'MODEL_CARD.md': model_card(name, version, dataset_hash, cfg, counts, model['routes'], skipped, total, seeded)}
    manifest = {
        'schema': tf.MODEL_SCHEMA, 'kind': 'prototypes', 'name': name, 'version': version, 'createdAt': created_at,
        'trainer': TRAINER, 'base': None, 'embedVersion': EMBED_VERSION,
        'license': 'derived from the exporting project\'s own traces (and a curated seed); no third-party weights',
        'datasetHash': dataset_hash, 'datasetSchema': tf.DATASET_SCHEMA, 'traceVersion': tf.TRACE_VERSION,
        'files': {n: {'sha256': tf.sha256_bytes(t.encode('utf-8')), 'bytes': len(t.encode('utf-8'))} for n, t in sorted(texts.items())},
    }
    texts['manifest.json'] = tf.dump(manifest)
    texts['checksums.txt'] = ''.join('%s  %s\n' % (tf.sha256_bytes(texts[n].encode('utf-8')), n) for n in sorted(texts))
    os.makedirs(out_dir, exist_ok=True)
    for file_name, text in texts.items():
        with open(os.path.join(out_dir, file_name), 'wb') as f:
            f.write(text.encode('utf-8'))
    return report


def load_config(path):
    cfg = dict(DEFAULTS)
    if path and os.path.isfile(path):
        with open(path, 'rb') as f:
            given = json.loads(f.read().decode('utf-8'))
        unknown = sorted(set(given) - set(DEFAULTS))
        if unknown:
            raise tf.Refused('prototypes.config.json has unknown keys: %s' % ', '.join(unknown))
        cfg.update(given)
    if not re.match(r'^[a-z][a-z0-9._-]{0,39}$', str(cfg['model_name'])):
        raise tf.Refused('model_name must be lowercase letters, digits and . _ - (at most 40 characters)')
    if not (isinstance(cfg['dim'], int) and 16 <= cfg['dim'] <= 1024):
        raise tf.Refused('dim must be a whole number from 16 to 1024')
    if not (isinstance(cfg['ngrams'], list) and 1 <= len(cfg['ngrams']) <= 4 and all(isinstance(n, int) and 1 <= n <= 6 for n in cfg['ngrams']) and cfg['ngrams'] == sorted(set(cfg['ngrams']))):
        raise tf.Refused('ngrams must be 1-4 increasing whole numbers from 1 to 6')
    for key in ('min_score', 'min_margin'):
        if not (isinstance(cfg[key], (int, float)) and 0 <= cfg[key] <= 1):
            raise tf.Refused('%s must be a number from 0 to 1' % key)
    if not (isinstance(cfg['max_per_class'], int) and 1 <= cfg['max_per_class'] <= LIMITS['per_class']):
        raise tf.Refused('max_per_class must be a whole number from 1 to %d' % LIMITS['per_class'])
    return cfg


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build the prototype set of the local embedding classifier from a Construct dataset bundle.')
    parser.add_argument('--dataset', help='the dataset bundle folder (from construct traces export --yes)')
    parser.add_argument('--out', help='the folder to write the model bundle to')
    parser.add_argument('--config', default=os.path.join(HERE, 'prototypes.config.json'), help='prototypes.config.json')
    parser.add_argument('--seed', help='a curated prototype file merged before the words from the traces')
    parser.add_argument('--created-at', default=os.environ.get('TRAIN_CREATED_AT'), help='ISO time for the manifest (default: now, UTC); fixed for reproducible bundles')
    parser.add_argument('--time-limit', type=float, default=None, help='hard limit in seconds (default: from the config)')
    args = parser.parse_args(argv)
    started = time.time()
    try:
        if not args.dataset or not args.out:
            raise tf.Refused('--dataset and --out are needed')
        cfg = load_config(args.config)
        manifest, records = tf.load_dataset(args.dataset)
        seed = load_seed(args.seed)
        tf.arm_time_limit(args.time_limit if args.time_limit is not None else cfg['time_limit_seconds'])
        model, skipped, total = build_model(records, cfg, manifest['datasetHash'], seed)
        created_at = args.created_at or time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        report = write_bundle(args.out, manifest, records, model, skipped, total, cfg, created_at, started, bool(seed))
        if hasattr(tf.signal, 'setitimer'):
            tf.signal.setitimer(tf.signal.ITIMER_REAL, 0)
    except tf.Refused as e:
        sys.stderr.write('refused: %s\n' % e)
        return 2
    except tf.TimeLimit:
        sys.stderr.write('time limit reached; nothing was written\n')
        return 124
    t = report['test']['overall']
    print('built %s from %d train records (%d routes, %d prototypes); test: accuracy %s vs rules %s, coverage %s' % (
        cfg['model_name'], manifest['counts']['train'], len(model['routes']), total, t['accuracy'], t['rulesAgreement'], t['coverage']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
