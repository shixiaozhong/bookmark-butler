import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDuplicates } from '../lib/duplicates.js';

const bookmark = (id, url, dateAdded = 0, extra = {}) => ({ id, url, dateAdded, title: id, ...extra });

test('keeps the oldest exact copy and marks the rest removable', () => {
  const [group] = findDuplicates([
    bookmark('new', 'https://a.com/', 300),
    bookmark('old', 'https://a.com/', 100),
    bookmark('mid', 'https://a.com', 200),
  ]);
  assert.equal(group.exact, true);
  assert.equal(group.items[0].id, 'old');
  assert.deepEqual(group.removable, ['mid', 'new']);
});

test('equal timestamps fall back to the lower id, compared as a number', () => {
  const [group] = findDuplicates([
    bookmark('10', 'https://a.com/', 100),
    bookmark('9', 'https://a.com/', 100),
  ]);
  assert.equal(group.items[0].id, '9');
  assert.deepEqual(group.removable, ['10']);
});

test('similar URLs are grouped but never preselected', () => {
  const [group] = findDuplicates([
    bookmark('https', 'https://a.com/x', 100),
    bookmark('http', 'http://a.com/x', 200),
  ]);
  assert.equal(group.exact, false);
  assert.deepEqual(group.removable, []);
});

test('a mixed group only preselects the exact copies', () => {
  const [group] = findDuplicates([
    bookmark('https-1', 'https://a.com/x', 100),
    bookmark('http', 'http://a.com/x', 200),
    bookmark('https-2', 'https://a.com/x', 300),
  ]);
  assert.equal(group.exact, false);
  assert.deepEqual(group.removable, ['https-2']);
});

test('unique and managed bookmarks are left out', () => {
  assert.deepEqual(
    findDuplicates([
      bookmark('a', 'https://a.com/'),
      bookmark('b', 'https://b.com/'),
      bookmark('managed', 'https://a.com/', 0, { unmodifiable: 'managed' }),
    ]),
    [],
  );
});

test('exact groups sort before similar ones, then by size', () => {
  const groups = findDuplicates([
    bookmark('s1', 'https://s.com/'),
    bookmark('s2', 'http://s.com/'),
    bookmark('s3', 'http://www.s.com/'),
    bookmark('e1', 'https://e.com/'),
    bookmark('e2', 'https://e.com/'),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['e.com', 's.com']);
});
