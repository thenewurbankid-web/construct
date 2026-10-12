import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PROJECT_TABS, tabForKey } from './OpenProjectTabs.ts';
import { searchWithTab, shownTab, tabFromSearch } from './OpenProjectTabUrl.ts';

test('one tab per workflow, in plain words', () => {
  assert.deepEqual(OPEN_PROJECT_TABS.map((t) => t.label), ['Your projects', 'New project', 'From GitHub']);
});

test('the tab sits in the URL; an unknown one is ignored and the rest of the query is kept', () => {
  assert.equal(tabFromSearch('?tab=new'), 'new');
  assert.equal(tabFromSearch('?tab=github&x=1'), 'github');
  assert.equal(tabFromSearch('?tab=nope'), null);
  assert.equal(tabFromSearch(''), null);
  assert.equal(searchWithTab('?x=1', 'new'), '?x=1&tab=new');
  assert.equal(searchWithTab('?tab=new', 'projects'), '?tab=projects');
});

test('with none chosen: Your projects when there are projects (or while loading), New project when there are none', () => {
  assert.equal(shownTab(null, null), 'projects');
  assert.equal(shownTab(null, 3), 'projects');
  assert.equal(shownTab(null, 0), 'new');
  assert.equal(shownTab('github', 0), 'github');
});

test('the keyboard moves between tabs: arrows wrap, Home and End', () => {
  assert.equal(tabForKey('projects', 'ArrowRight'), 'new');
  assert.equal(tabForKey('github', 'ArrowRight'), 'projects');
  assert.equal(tabForKey('projects', 'ArrowLeft'), 'github');
  assert.equal(tabForKey('new', 'Home'), 'projects');
  assert.equal(tabForKey('new', 'End'), 'github');
  assert.equal(tabForKey('new', 'a'), null);
});
