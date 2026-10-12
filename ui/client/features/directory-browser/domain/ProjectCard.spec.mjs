import test from 'node:test';
import assert from 'node:assert/strict';
import { toProjectCard } from './ProjectCard.ts';

// The entry as directory-browser's listing mapper (domain/DirectoryListing.tsx badgesFor) hands it over.
const toEntryView = (e) => ({ name: e.name, path: e.path, isConstructProject: e.isConstructProject, badges: e.isReact ? [{ key: 'react', label: 'React' }] : e.hasPackageJson ? [{ key: 'package', label: 'package.json' }] : [] });
const raw = (over) => ({ name: 'shop', path: '/ws/shop', hasArchitectureYml: false, hasPackageJson: false, isReact: false, isConstructProject: false, ...over });

test('a Line or Construct project is Ready; anything else Needs setup, in plain words', () => {
  assert.deepEqual(toProjectCard(toEntryView(raw({ isConstructProject: true, hasArchitectureYml: true }))).status, { tone: 'fit', label: 'Ready' });
  assert.deepEqual(toProjectCard(toEntryView(raw({}))).status, { tone: 'wait', label: 'Needs setup' });
});

test('a framework tag only when it helps (React), never "package.json"', () => {
  assert.equal(toProjectCard(toEntryView(raw({ isReact: true, hasPackageJson: true }))).tag, 'React');
  assert.equal(toProjectCard(toEntryView(raw({ hasPackageJson: true }))).tag, null);
  const card = toProjectCard(toEntryView(raw({})));
  assert.equal(card.name, 'shop');
  assert.equal(card.path, '/ws/shop');
});
