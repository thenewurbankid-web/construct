"""The kit's test for build_prototypes.py (python3 -m unittest, run from the train-kit folder): the prototype builder is deterministic,
matches the golden bundle, mirrors the embedding of packages/core/decision-prototypes.mjs (a vector pinned on both sides), refuses
what it should and merges a curated seed first. Standard library only; no Construct code.
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
GOLDEN = os.path.join(HERE, 'fixtures', 'golden-prototypes')
SCRIPT = os.path.join(HERE, 'build_prototypes.py')
CREATED = '2026-09-25T12:00:00.000Z'

sys.path.insert(0, HERE)
import build_prototypes as bp  # noqa: E402

# The buckets (index -> sign) of embed_text('order lines', 256, [2, 3, 4]); every other bucket is 0 and each entry is +-1/sqrt(30).
# test/decision-prototypes.test.mjs pins the same table against the JavaScript embedding, so the two cannot drift apart unseen.
PINNED_PLUS = [22, 39, 60, 70, 84, 93, 105, 128, 132, 138, 158, 162, 170, 177, 181, 214, 227, 242, 244, 248, 252]
PINNED_MINUS = [31, 33, 56, 78, 112, 160, 202, 217, 245]


def build(out, dataset=DATASET, *extra):
    return subprocess.run([sys.executable, SCRIPT, '--dataset', dataset, '--out', out, '--created-at', CREATED, *extra], capture_output=True, text=True)


def read(path):
    with open(path, 'rb') as f:
        return f.read()


class BuildPrototypes(unittest.TestCase):
    def test_the_embedding_is_pinned_and_matches_the_javascript_one(self):
        vec = bp.embed_text('order lines', 256, [2, 3, 4])
        want = 30 ** -0.5
        self.assertEqual(sorted(i for i, x in enumerate(vec) if x != 0), sorted(PINNED_PLUS + PINNED_MINUS))
        for i in PINNED_PLUS:
            self.assertAlmostEqual(vec[i], want, places=15)
        for i in PINNED_MINUS:
            self.assertAlmostEqual(vec[i], -want, places=15)
        self.assertIsNone(bp.embed_text('!!!', 256, [2, 3, 4]))
        self.assertEqual(bp.fnv1a('a'), 0xE40C292C)  # the published FNV-1a 32-bit value of "a"
        self.assertLess(bp.fnv1a('<invoices>'), 2 ** 32)

    def test_the_bundle_matches_the_golden_one_and_two_runs_are_identical(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(build(os.path.join(out, 'a')).returncode, 0)
            self.assertEqual(build(os.path.join(out, 'b')).returncode, 0)
            for name in ('prototypes.json', 'MODEL_CARD.md'):  # eval-report.json records peak memory and time
                self.assertEqual(read(os.path.join(out, 'a', name)), read(os.path.join(out, 'b', name)), name)
                self.assertEqual(read(os.path.join(out, 'a', name)), read(os.path.join(GOLDEN, name)), name)
            self.assertEqual(sorted(os.listdir(os.path.join(out, 'a'))), ['MODEL_CARD.md', 'checksums.txt', 'eval-report.json', 'manifest.json', 'prototypes.json'])

    def test_checksums_and_manifest_agree_with_the_files(self):
        manifest = json.loads(read(os.path.join(GOLDEN, 'manifest.json')))
        self.assertEqual([manifest['kind'], manifest['embedVersion']], ['prototypes', 'embed.v1'])
        self.assertEqual(manifest['datasetHash'], json.loads(read(os.path.join(DATASET, 'manifest.json')))['datasetHash'])
        for line in read(os.path.join(GOLDEN, 'checksums.txt')).decode().splitlines():
            digest, name = line.split('  ')
            self.assertEqual(hashlib.sha256(read(os.path.join(GOLDEN, name))).hexdigest(), digest, name)
        for name, entry in manifest['files'].items():
            self.assertEqual(hashlib.sha256(read(os.path.join(GOLDEN, name))).hexdigest(), entry['sha256'], name)

    def test_it_beats_the_rules_baseline_on_the_held_out_split_of_the_fixture(self):
        report = json.loads(read(os.path.join(GOLDEN, 'eval-report.json')))
        overall = report['test']['overall']
        self.assertGreater(overall['accuracy'], overall['rulesAgreement'])
        self.assertEqual(overall['verdict'], 'beats')

    def test_a_curated_seed_comes_first_and_survives_the_cap(self):
        with tempfile.TemporaryDirectory() as work:
            route = 'what does "_" mean here?|entity,state,ui-part,external,ignore'
            seed = os.path.join(work, 'seed.json')
            with open(seed, 'w') as f:
                json.dump({'routes': {route: {'external': ['stripe', 'S3 Bucket'], 'entity': ['zebra']}}}, f)
            out = os.path.join(work, 'm')
            self.assertEqual(build(out, DATASET, '--seed', seed).returncode, 0)
            model = json.loads(read(os.path.join(out, 'prototypes.json')))
            r = model['routes'][route]
            self.assertEqual(r['prototypes']['external'], ['stripe', 's3 bucket'], 'a class only the seed names is kept, words normalised')
            self.assertEqual(r['prototypes']['entity'][0], 'zebra', 'curated words come first')
            self.assertIn('external', r['classes'])
            self.assertIn('a curated seed file was merged first', read(os.path.join(out, 'MODEL_CARD.md')).decode())

    def test_a_bad_seed_a_bad_dataset_and_a_bad_config_are_refused_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as work:
            bad = os.path.join(work, 'seed.json')
            with open(bad, 'w') as f:
                json.dump({'routes': {'q|a': {'a': ['a' * 41]}}}, f)
            r = build(os.path.join(work, 'm1'), DATASET, '--seed', bad)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn('Traceback', r.stderr)
            with open(bad, 'w') as f:
                f.write('{nope')
            self.assertEqual(build(os.path.join(work, 'm2'), DATASET, '--seed', bad).returncode, 2)
            copy = os.path.join(work, 'dataset')
            shutil.copytree(DATASET, copy)
            with open(os.path.join(copy, 'dataset.jsonl'), 'ab') as f:
                f.write(b'\n')
            r = build(os.path.join(work, 'm3'), copy)
            self.assertEqual(r.returncode, 2)
            self.assertIn('does not match the hash', r.stderr)
            self.assertFalse(os.path.exists(os.path.join(work, 'm3')))
            cfg = os.path.join(work, 'cfg.json')
            with open(cfg, 'w') as f:
                json.dump({'dim': 5}, f)
            r = build(os.path.join(work, 'm4'), DATASET, '--config', cfg)
            self.assertEqual(r.returncode, 2)
            self.assertIn('dim must be', r.stderr)
            with open(cfg, 'w') as f:
                json.dump({'surprise': 1}, f)
            self.assertEqual(build(os.path.join(work, 'm5'), DATASET, '--config', cfg).returncode, 2)

    def test_time_limit_stops_a_run_with_124(self):
        with tempfile.TemporaryDirectory() as work:
            out = os.path.join(work, 'm')
            r = subprocess.run([sys.executable, SCRIPT, '--dataset', DATASET, '--out', out, '--time-limit', '0.0001'], capture_output=True, text=True)
            self.assertEqual(r.returncode, 124, r.stderr)
            self.assertFalse(os.path.exists(out))


if __name__ == '__main__':
    unittest.main()
