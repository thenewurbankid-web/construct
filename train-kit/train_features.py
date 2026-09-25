#!/usr/bin/env python3
"""Train the structured-feature decision model of Construct (#647), on THIS machine, from a dataset bundle.

A dataset bundle is what `construct traces export --yes` wrote: dataset.jsonl, schema.json, manifest.json, README.md. This script
reads it, trains one multinomial logistic regression (softmax over the options of a question) per closed question, on the TRAIN
split only, with fixed seeds, evaluates on the validation and test splits against the rules baseline, and writes a model bundle:

    features.json      the weights, plain JSON (schema construct.features-model.v1)
    eval-report.json   accuracy per chooser vs the rules baseline, on validation and test, and the peak memory
    MODEL_CARD.md      what it is, the data hash, base = none, licence note, limits
    manifest.json      schema construct.model-bundle.v1, name, version, dataset hash, sha256 of the files
    checksums.txt      sha256 of every other file (sha256sum format)

Pure Python 3 standard library: no numpy, no scikit-learn, no network, no Construct code. The feature extraction (features.v1) and
the scorer repeat packages/core/decision-features.mjs exactly, so what is measured here is what Construct scores after the import;
train-kit's own test and Construct's tests prove the two agree on the fixture.

    python3 train_features.py --dataset <bundle dir> --out <model dir> [--config train.config.json] [--created-at ISO] [--time-limit S]
    python3 train_features.py --print-dataset-hash <bundle dir>

Exit codes: 0 done, 2 the dataset is refused (message on stderr), 124 the time limit was hit.
"""
import argparse
import hashlib
import json
import math
import os
import random
import re
import signal
import sys
import time

try:
    import resource
except ImportError:  # Windows
    resource = None

DATASET_SCHEMA = 'construct.dataset-bundle.v1'
MODEL_SCHEMA = 'construct.model-bundle.v1'
FEATURES_SCHEMA = 'construct.features-model.v1'
FEATURE_VERSION = 'features.v1'
TRACE_VERSION = 'decision-trace.v1'
TRAINER = {'name': 'train-kit/train_features.py', 'version': '1'}
SPLITS = ('train', 'validation', 'test')
HERE = os.path.dirname(os.path.abspath(__file__))
WS = ' \t\n\r\f\v'

DEFAULTS = {
    'seed': 1,
    'epochs': 60,
    'learning_rate': 0.5,
    'lr_decay': 0.05,
    'l2': 0.001,
    'min_score': 0.4,
    'min_train_per_route': 5,
    'min_feature_count': 1,
    'max_features_per_route': 5000,
    'model_name': 'features-lr',
    'time_limit_seconds': 1800,
}


class Refused(Exception):
    """The dataset or the arguments are not acceptable: a message for the person, never a traceback."""


# ---------------------------------------------------------------- features.v1 (mirror of packages/core/decision-features.mjs)

def ascii_only(value):
    return re.sub(r'[^\x00-\x7f]', ' ', '' if value is None else str(value))


def words(value):
    return re.findall(r'[a-z0-9]+', ascii_only(value).lower())


def route_of(summary):
    options = summary.get('options') if isinstance(summary.get('options'), list) else []
    ids = [str(o.get('id', '')) if isinstance(o, dict) else '' for o in options]
    template = re.sub(r'"[^"]*"', '"_"', ascii_only(summary.get('question'))).lower()
    template = re.sub('[' + WS + ']+', ' ', template).strip(WS)
    return (template + '|' + ','.join(ids))[:200]


def extract_features(summary):
    feats = set()
    options = summary.get('options') if isinstance(summary.get('options'), list) else []
    enabled = [o['id'] for o in options if isinstance(o, dict) and o.get('enabled') is True and isinstance(o.get('id'), str)]
    for option_id in enabled:
        feats.add('enabled:' + option_id)
    feats.add('n:%d' % len(enabled))
    question = ascii_only(summary.get('question'))
    quoted = re.search(r'"([^"]{1,40})"', question)
    rest = question
    if quoted:
        word = '_'.join(words(quoted.group(1)))
        if word:
            feats.add('word:' + word)
            feats.add('len:%d' % min(len(word), 12))
            feats.add('suf1:' + word[-1:])
            if len(word) >= 2:
                feats.add('suf2:' + word[-2:])
            if len(word) >= 3:
                feats.add('suf3:' + word[-3:])
            if word.endswith('s') and not word.endswith('ss'):
                feats.add('plural')
        rest = question.replace(quoted.group(0), ' ', 1)
    for token in list(dict.fromkeys(words(rest)))[:24]:
        feats.add('tok:' + token)
    return sorted(feats)


def score_summary(model, summary):
    """The scorer of decision-features.mjs: {option, score, runnerUp} or None (abstain)."""
    routes = model['routes']
    route = routes.get(route_of(summary))
    if route is None:
        return None
    enabled = set(o['id'] for o in summary.get('options', []) if isinstance(o, dict) and o.get('enabled') is True)
    logits = list(route['bias'])
    for feature in extract_features(summary):
        w = route['weights'].get(feature)
        if w is None:
            continue
        for i in range(len(logits)):
            logits[i] += w[i]
    candidates = [(option, logits[i]) for i, option in enumerate(route['classes']) if option in enabled]
    if not candidates:
        return None
    top = max(logit for _, logit in candidates)
    exps = [math.exp(logit - top) for _, logit in candidates]
    total = sum(exps)
    ranked = sorted(((option, exps[i] / total) for i, (option, _) in enumerate(candidates)), key=lambda x: (-x[1], x[0]))
    best = ranked[0]
    if best[1] < model['minScore']:
        return None
    return {'option': best[0], 'score': best[1], 'runnerUp': ranked[1][0] if len(ranked) > 1 else None}


# ---------------------------------------------------------------- the dataset

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def load_dataset(directory):
    """Verify a dataset bundle and return (manifest, records). Refuses on any disagreement; nothing is repaired."""
    manifest_path = os.path.join(directory, 'manifest.json')
    dataset_path = os.path.join(directory, 'dataset.jsonl')
    if not os.path.isfile(manifest_path) or not os.path.isfile(dataset_path):
        raise Refused('%s is not a dataset bundle (manifest.json and dataset.jsonl are needed)' % directory)
    try:
        with open(manifest_path, 'rb') as f:
            manifest = json.loads(f.read().decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        raise Refused('manifest.json is not valid JSON')
    if manifest.get('schema') != DATASET_SCHEMA:
        raise Refused('manifest.json schema must be %s' % DATASET_SCHEMA)
    if manifest.get('traceVersion') != TRACE_VERSION:
        raise Refused('the dataset holds %s records, this kit reads %s' % (manifest.get('traceVersion'), TRACE_VERSION))
    with open(dataset_path, 'rb') as f:
        data = f.read()
    digest = sha256_bytes(data)
    listed = (manifest.get('files') or {}).get('dataset.jsonl', {}).get('sha256')
    if digest != listed or digest != manifest.get('datasetHash'):
        raise Refused('dataset.jsonl does not match the hash in manifest.json (a partial copy or a changed file)')
    records = []
    for number, line in enumerate(data.decode('utf-8').split('\n'), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            split, trace = entry['split'], entry['trace']
        except (ValueError, KeyError, TypeError):
            raise Refused('dataset.jsonl line %d is not a { split, trace } record' % number)
        if split not in SPLITS or not isinstance(trace, dict) or trace.get('version') != TRACE_VERSION:
            raise Refused('dataset.jsonl line %d has an unknown split or a record that is not %s' % (number, TRACE_VERSION))
        records.append((split, trace))
    if len(records) != manifest.get('counts', {}).get('records'):
        raise Refused('dataset.jsonl holds %d records, manifest.json says %s' % (len(records), manifest.get('counts', {}).get('records')))
    return manifest, records


# ---------------------------------------------------------------- training

def train_route(route, examples, cfg):
    """One softmax regression. examples: list of (features, chosen). Returns the route entry, or None when there is too little data."""
    if len(examples) < cfg['min_train_per_route']:
        return None
    classes = sorted(set(chosen for _, chosen in examples))
    index = {c: i for i, c in enumerate(classes)}
    k = len(classes)
    counts = {}
    for feats, _ in examples:
        for f in feats:
            counts[f] = counts.get(f, 0) + 1
    vocab = [f for f, n in counts.items() if n >= cfg['min_feature_count']]
    vocab.sort(key=lambda f: (-counts[f], f))
    vocab = sorted(vocab[:cfg['max_features_per_route']])
    known = set(vocab)
    weights = {f: [0.0] * k for f in vocab}
    bias = [0.0] * k
    data = [([f for f in feats if f in known], index[chosen]) for feats, chosen in examples]
    rng = random.Random('%s:%s' % (cfg['seed'], route))
    order = list(range(len(data)))
    for epoch in range(cfg['epochs']):
        rng.shuffle(order)
        lr = cfg['learning_rate'] / (1.0 + cfg['lr_decay'] * epoch)
        for i in order:
            feats, y = data[i]
            logits = list(bias)
            for f in feats:
                w = weights[f]
                for c in range(k):
                    logits[c] += w[c]
            top = max(logits)
            exps = [math.exp(x - top) for x in logits]
            total = sum(exps)
            for c in range(k):
                grad = exps[c] / total - (1.0 if c == y else 0.0)
                bias[c] -= lr * grad
                for f in feats:
                    w = weights[f]
                    w[c] -= lr * (grad + cfg['l2'] * w[c])
    out_weights = {}
    for f in vocab:
        rounded = [round(x, 6) + 0.0 for x in weights[f]]
        if any(abs(x) > 0 for x in rounded):
            out_weights[f] = rounded
    return {'classes': classes, 'bias': [round(x, 6) + 0.0 for x in bias], 'weights': out_weights, 'trainCount': len(examples)}


def build_model(records, cfg, dataset_hash):
    grouped = {}
    chooser_ids = {}
    for split, trace in records:
        if split != 'train' or trace.get('by') != 'person':
            continue
        summary = trace['summary']
        chosen = trace.get('chosen')
        if chosen not in trace.get('options', []):
            continue  # an "exit" is not a class of the question
        route = route_of(summary)
        grouped.setdefault(route, []).append((extract_features(summary), chosen))
        chooser_ids.setdefault(route, set()).add(trace['chooser']['id'])
    routes = {}
    skipped = {}
    for route in sorted(grouped):
        entry = train_route(route, grouped[route], cfg)
        if entry is None:
            skipped[route] = len(grouped[route])
            continue
        entry['choosers'] = sorted(chooser_ids[route])
        routes[route] = entry
    model = {'schema': FEATURES_SCHEMA, 'featureVersion': FEATURE_VERSION, 'minScore': cfg['min_score'], 'trainedOn': {'datasetHash': dataset_hash, 'seed': cfg['seed']}, 'routes': routes}
    return model, skipped


# ---------------------------------------------------------------- evaluation (the numbers construct traces replay computes)

def first_enabled(summary):
    for o in summary.get('options', []):
        if isinstance(o, dict) and o.get('enabled') is True:
            return o.get('id')
    return None


def ratio(n, d):
    return None if not d else round(n / d, 6)


def evaluate(records, model, split):
    per = {}
    for s, trace in records:
        if s != split:
            continue
        m = per.setdefault(trace['chooser']['id'], {'traces': 0, 'persons': 0, 'hits': 0, 'answered': 0, 'rulesHits': 0, 'suggested': 0, 'suggestedHits': 0})
        pick = score_summary(model, trace['summary'])
        m['traces'] += 1
        if pick is not None:
            m['answered'] += 1
        if trace.get('by') == 'person':
            m['persons'] += 1
            if pick is not None and pick['option'] == trace['chosen']:
                m['hits'] += 1
            if first_enabled(trace['summary']) == trace['chosen']:
                m['rulesHits'] += 1
            if isinstance(trace.get('suggestion'), dict):
                m['suggested'] += 1
                if trace['suggestion'].get('option') == trace['chosen']:
                    m['suggestedHits'] += 1
    total = {'traces': 0, 'persons': 0, 'hits': 0, 'answered': 0, 'rulesHits': 0, 'suggested': 0, 'suggestedHits': 0}
    for m in per.values():
        for key in total:
            total[key] += m[key]
    return {chooser: summarize(m) for chooser, m in sorted(per.items())}, summarize(total)


def summarize(m):
    verdict = 'beats' if m['hits'] > m['rulesHits'] else 'ties' if m['hits'] == m['rulesHits'] else 'loses'
    return {
        'traces': m['traces'], 'persons': m['persons'], 'hits': m['hits'],
        'accuracy': ratio(m['hits'], m['persons']),
        'coverage': ratio(m['answered'], m['traces']),
        'rulesHits': m['rulesHits'], 'rulesAgreement': ratio(m['rulesHits'], m['persons']),
        'recordedSuggestionAgreement': ratio(m['suggestedHits'], m['suggested']),
        'verdict': verdict,
    }


def peak_memory_mb():
    if resource is None:
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(peak / (1048576.0 if sys.platform == 'darwin' else 1024.0), 1)


# ---------------------------------------------------------------- the bundle

def dump(obj):
    return json.dumps(obj, sort_keys=True, indent=1) + '\n'


def model_card(name, version, dataset_hash, cfg, counts, routes, skipped):
    lines = [
        '# Model card: %s %s' % (name, version), '',
        'A structured-feature classifier for Construct\'s decision seam: a multinomial logistic regression per closed question ("route"), over',
        'features of the question as it was offered (option ids that were enabled, the quoted word and its ending, the words of the question).',
        'It suggests one option or abstains; it never executes anything.', '',
        '- **Trained on:** dataset `%s` (%d train / %d validation / %d test records), the TRAIN split only.' % (dataset_hash, counts['train'], counts['validation'], counts['test']),
        '- **Base model:** none. Trained from scratch by train-kit/train_features.py (pure Python, seed %s, %d epochs); no pretrained weights, no third-party data.' % (cfg['seed'], cfg['epochs']),
        '- **Licence note:** the weights are derived only from the decision traces of the project that exported the dataset, plus this kit (MIT, Construct). They carry no third-party model or dataset licence; who may use them is decided by whoever owns those traces.',
        '- **Routes learned:** %d (%s).' % (len(routes), ', '.join(sorted(set(c for r in routes.values() for c in r['choosers']))) or 'none'),
        '- **Routes skipped for too little data:** %d.' % len(skipped), '',
        '## Limits', '',
        '- It knows only the questions (route = wording with quoted words blanked plus the option ids) it saw at least %d times; on any other question it abstains.' % cfg['min_train_per_route'],
        '- Small data: read eval-report.json before trusting it. `construct model import` replays held-out records against the rules baseline and stays disabled until you enable it.',
        '- Features are bag-of-words and word endings; it does not understand meaning and will not generalise to unseen wording beyond that.',
        '- Not evaluated for fairness or safety beyond the agreement numbers in eval-report.json.', '',
    ]
    return '\n'.join(lines)


def write_bundle(out_dir, manifest_in, records, model, skipped, cfg, created_at, started):
    dataset_hash = manifest_in['datasetHash']
    counts = manifest_in['counts']
    validation_by, validation_all = evaluate(records, model, 'validation')
    test_by, test_all = evaluate(records, model, 'test')
    name = cfg['model_name']
    version = '%s-%s' % (TRAINER['version'], dataset_hash[:8])
    report = {
        'schema': 'construct.eval-report.v1',
        'datasetHash': dataset_hash,
        'trainer': TRAINER,
        'seed': cfg['seed'],
        'config': {k: cfg[k] for k in sorted(DEFAULTS)},
        'splits': {'train': counts['train'], 'validation': counts['validation'], 'test': counts['test']},
        'routes': {'trained': len(model['routes']), 'skippedForTooLittleData': len(skipped)},
        'validation': {'overall': validation_all, 'byChooser': validation_by},
        'test': {'overall': test_all, 'byChooser': test_by},
        'note': 'accuracy counts an abstention as a miss; rulesAgreement is the baseline (first enabled option); recordedSuggestionAgreement is how often the recorded suggestion was the chosen option',
        'peakMemoryMB': peak_memory_mb(),
        'elapsedSeconds': round(time.time() - started, 2),
    }
    texts = {'features.json': dump(model), 'eval-report.json': dump(report), 'MODEL_CARD.md': model_card(name, version, dataset_hash, cfg, counts, model['routes'], skipped)}
    manifest = {
        'schema': MODEL_SCHEMA, 'kind': 'features', 'name': name, 'version': version, 'createdAt': created_at,
        'trainer': TRAINER, 'base': None, 'license': 'derived from the exporting project\'s own traces; no third-party weights',
        'datasetHash': dataset_hash, 'datasetSchema': DATASET_SCHEMA, 'traceVersion': TRACE_VERSION, 'featureVersion': FEATURE_VERSION,
        'seed': cfg['seed'], 'files': {n: {'sha256': sha256_bytes(t.encode('utf-8')), 'bytes': len(t.encode('utf-8'))} for n, t in sorted(texts.items())},
    }
    texts['manifest.json'] = dump(manifest)
    texts['checksums.txt'] = ''.join('%s  %s\n' % (sha256_bytes(texts[n].encode('utf-8')), n) for n in sorted(n for n in texts))
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
            raise Refused('train.config.json has unknown keys: %s' % ', '.join(unknown))
        cfg.update(given)
    if not re.match(r'^[a-z][a-z0-9._-]{0,39}$', str(cfg['model_name'])):
        raise Refused('model_name must be lowercase letters, digits and . _ - (at most 40 characters)')
    return cfg


class TimeLimit(Exception):
    pass


def arm_time_limit(seconds):
    if not seconds or not hasattr(signal, 'SIGALRM'):
        return

    def on_alarm(_signum, _frame):
        raise TimeLimit()

    signal.signal(signal.SIGALRM, on_alarm)
    signal.setitimer(signal.ITIMER_REAL, float(seconds))


def main(argv=None):
    parser = argparse.ArgumentParser(description='Train the structured-feature decision model from a Construct dataset bundle.')
    parser.add_argument('--dataset', help='the dataset bundle folder (from construct traces export --yes)')
    parser.add_argument('--out', help='the folder to write the model bundle to')
    parser.add_argument('--config', default=os.path.join(HERE, 'train.config.json'), help='train.config.json')
    parser.add_argument('--created-at', default=os.environ.get('TRAIN_CREATED_AT'), help='ISO time for the manifest (default: now, UTC); fixed for reproducible bundles')
    parser.add_argument('--time-limit', type=float, default=None, help='hard limit in seconds (default: from the config)')
    parser.add_argument('--print-dataset-hash', metavar='DIR', help='verify a dataset bundle and print its dataset hash')
    args = parser.parse_args(argv)
    started = time.time()
    try:
        if args.print_dataset_hash:
            manifest, _ = load_dataset(args.print_dataset_hash)
            print(manifest['datasetHash'])
            return 0
        if not args.dataset or not args.out:
            raise Refused('--dataset and --out are needed')
        cfg = load_config(args.config)
        manifest, records = load_dataset(args.dataset)
        arm_time_limit(args.time_limit if args.time_limit is not None else cfg['time_limit_seconds'])
        model, skipped = build_model(records, cfg, manifest['datasetHash'])
        created_at = args.created_at or time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
        report = write_bundle(args.out, manifest, records, model, skipped, cfg, created_at, started)
        if hasattr(signal, 'setitimer'):
            signal.setitimer(signal.ITIMER_REAL, 0)
    except Refused as e:
        sys.stderr.write('refused: %s\n' % e)
        return 2
    except TimeLimit:
        sys.stderr.write('time limit reached; nothing was written\n')
        return 124
    t = report['test']['overall']
    print('trained %s on %d train records (%d routes); test: accuracy %s vs rules %s, coverage %s; peak memory %s MB' % (
        cfg['model_name'], manifest['counts']['train'], len(model['routes']), t['accuracy'], t['rulesAgreement'], t['coverage'], report['peakMemoryMB']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
