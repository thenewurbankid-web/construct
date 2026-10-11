import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateProject, projectDestination, projectNameProblem } from './NewProjectName.ts';
import { canCreateLineProject, featureNameProblem, parentDirProblem } from './LineProjectFields.ts';

test('names the server would accept raise no problem', () => {
  for (const n of ['', '   ', 'shop', 'my-shop', 'my_shop', 'shop2', 'a.b', 'A1', 'x'.repeat(100)]) assert.equal(projectNameProblem(n), null, JSON.stringify(n));
});

test('names the server would refuse are explained in plain words', () => {
  for (const n of ['..', '../x', 'a/b', 'a\\b', '/etc', '.hidden', 'x.', 'a..b', 'repo.git', '-x', 'my shop', 'café', 'x'.repeat(101)]) {
    const p = projectNameProblem(n);
    assert.equal(typeof p, 'string', JSON.stringify(n));
    assert.doesNotMatch(p, /folder name|slug|regex/i);
  }
  assert.match(projectNameProblem('a/b'), /no slashes/);
  assert.match(projectNameProblem('my shop'), /no spaces/);
});

test('the button is ready only for a non-empty, valid name that is not already being created', () => {
  assert.equal(canCreateProject('', false), false);
  assert.equal(canCreateProject('../x', false), false);
  assert.equal(canCreateProject('shop', true), false);
  assert.equal(canCreateProject(' shop ', false), true);
});

test('the destination is the workspace plus the name', () => {
  assert.equal(projectDestination('/w/user/', ' shop '), '/w/user/shop');
  assert.equal(projectDestination(null, 'shop'), 'shop');
});

test('cu7: a Line project goes in a folder of the workspace, absolute or relative', () => {
  assert.equal(projectDestination('/w/user', 'shop', 'clients/'), '/w/user/clients/shop');
  assert.equal(projectDestination('/w/user', 'shop', '/w/user/clients'), '/w/user/clients/shop');
  assert.equal(projectDestination('/w/user', 'shop', ''), '/w/user/shop');
});

test('cu7: a Line project needs a good name, a good first feature and no ".." in its folder', () => {
  assert.equal(featureNameProblem('catalog'), null);
  assert.equal(featureNameProblem(''), null);
  assert.match(featureNameProblem('a/b'), /letters, digits/);
  assert.match(parentDirProblem('../x'), /inside your workspace/);
  assert.equal(parentDirProblem('clients'), null);
  assert.equal(canCreateLineProject('shop', 'catalog', '', false), true);
  assert.equal(canCreateLineProject('shop', '', '', false), false);
  assert.equal(canCreateLineProject('shop', 'catalog', '../x', false), false);
  assert.equal(canCreateLineProject('shop', 'catalog', '', true), false);
});
