"""The kit's own test (python3 -m unittest, run from the train-kit folder): training is deterministic and matches the golden model.

Uses only the standard library and the two fixtures in fixtures/: the dataset bundle and the golden model bundle a first run
produced. No Construct code is imported or needed.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, 'fixtures', 'dataset')
GOLDEN = os.path.join(HERE, 'fixtures', 'golden')
SCRIPT = os.path.join(HERE, 'train_features.py')
CREATED = '2026-09-25T12:00:00.000Z'

sys.path.insert(0, HERE)
import train_features as tf  # noqa: E402


def train(out, dataset=DATASET):
    return subprocess.run([sys.executable, SCRIPT, '--dataset', dataset, '--out', out, '--created-at', CREATED], capture_output=True, text=True)


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def close(a, b, tolerance=1e-5):
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(close(a[k], b[k], tolerance) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(close(x, y, tolerance) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        return abs(a - b) <= tolerance
    return a == b


class TrainFeatures(unittest.TestCase):
    def test_features_json_matches_the_golden_model(self):
        with tempfile.TemporaryDirectory() as out:
            result = train(os.path.join(out, 'm'))
            self.assertEqual(result.returncode, 0, result.stderr)
            got = json.loads(read(os.path.join(out, 'm', 'features.json')))
            want = json.loads(read(os.path.join(GOLDEN, 'features.json')))
            self.assertTrue(close(got, want), 'features.json differs from the golden one by more than 1e-5 (or in structure)')

    def test_two_runs_are_byte_identical(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(train(os.path.join(out, 'a')).returncode, 0)
            self.assertEqual(train(os.path.join(out, 'b')).returncode, 0)
            for name in ('features.json', 'MODEL_CARD.md'):  # eval-report.json (and so the manifest that hashes it) records peak memory and time
                self.assertEqual(read(os.path.join(out, 'a', name)), read(os.path.join(out, 'b', name)), name)

    def test_the_bundle_checksums_and_manifest_agree_with_the_files(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(train(os.path.join(out, 'm')).returncode, 0)
            folder = os.path.join(out, 'm')
            self.assertEqual(sorted(os.listdir(folder)), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'features.json', 'manifest.json'])
            manifest = json.loads(read(os.path.join(folder, 'manifest.json')))
            self.assertEqual(manifest['datasetHash'], json.loads(read(os.path.join(DATASET, 'manifest.json')))['datasetHash'])
            for line in read(os.path.join(folder, 'checksums.txt')).decode().splitlines():
                digest, name = line.split('  ')
                self.assertEqual(hashlib.sha256(read(os.path.join(folder, name))).hexdigest(), digest, name)
            for name, entry in manifest['files'].items():
                self.assertEqual(hashlib.sha256(read(os.path.join(folder, name))).hexdigest(), entry['sha256'], name)

    def test_the_model_beats_the_rules_baseline_on_the_fixture(self):
        report = json.loads(read(os.path.join(GOLDEN, 'eval-report.json')))
        overall = report['test']['overall']
        self.assertGreater(overall['accuracy'], overall['rulesAgreement'])
        self.assertEqual(overall['verdict'], 'beats')
        self.assertIsNotNone(report['peakMemoryMB'])

    def test_a_changed_dataset_is_refused_and_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as work:
            copy = os.path.join(work, 'dataset')
            shutil.copytree(DATASET, copy)
            with open(os.path.join(copy, 'dataset.jsonl'), 'ab') as f:
                f.write(b'\n')
            out = os.path.join(work, 'm')
            result = train(out, copy)
            self.assertEqual(result.returncode, 2)
            self.assertIn('does not match the hash', result.stderr)
            self.assertNotIn('Traceback', result.stderr)
            self.assertFalse(os.path.exists(out))

    def test_not_a_dataset_is_refused_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as work:
            result = train(os.path.join(work, 'm'), work)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('Traceback', result.stderr)

    def test_the_feature_extraction_matches_the_documented_example(self):
        summary = {'question': 'What does "invoices" mean here?', 'options': [{'id': 'entity', 'enabled': True}, {'id': 'ignore', 'enabled': True}]}
        self.assertEqual(tf.extract_features(summary), ['enabled:entity', 'enabled:ignore', 'len:8', 'n:2', 'plural', 'suf1:s', 'suf2:es', 'suf3:ces', 'tok:does', 'tok:here', 'tok:mean', 'tok:what', 'word:invoices'])
        self.assertEqual(tf.route_of(summary), 'what does "_" mean here?|entity,ignore')

    def test_time_limit_stops_a_run_with_124(self):
        with tempfile.TemporaryDirectory() as work:
            out = os.path.join(work, 'm')
            result = subprocess.run([sys.executable, SCRIPT, '--dataset', DATASET, '--out', out, '--time-limit', '0.0001'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 124, result.stderr)
            self.assertFalse(os.path.exists(out))


if __name__ == '__main__':
    unittest.main()
