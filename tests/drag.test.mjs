import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderTrail, indexTree } from '../lib/bookmarks-model.js';
import { dropZone, resolveDrop, resolveStep } from '../lib/drag.js';

const { nodes } = indexTree([
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        index: 0,
        title: '书签栏',
        children: [
          { id: 'a', parentId: '1', index: 0, title: 'A', url: 'https://a.com/' },
          { id: 'b', parentId: '1', index: 1, title: 'B', url: 'https://b.com/' },
          { id: 'c', parentId: '1', index: 2, title: 'C', url: 'https://c.com/' },
          {
            id: 'f',
            parentId: '1',
            index: 3,
            title: 'F',
            children: [
              { id: 'x', parentId: 'f', index: 0, title: 'X', url: 'https://x.com/' },
              { id: 'g', parentId: 'f', index: 1, title: 'G', children: [] },
            ],
          },
        ],
      },
      {
        id: '3',
        parentId: '0',
        index: 1,
        title: '受管理',
        unmodifiable: 'managed',
        children: [{ id: 'm', parentId: '3', index: 0, title: 'M', url: 'https://m.com/', unmodifiable: 'managed' }],
      },
    ],
  },
]);
const get = (id) => nodes.get(id);

test('dropZone splits a bookmark tile in half', () => {
  assert.equal(dropZone(get('a'), 0.4), 'before');
  assert.equal(dropZone(get('a'), 0.6), 'after');
});

test('dropZone gives a folder tile three bands', () => {
  assert.equal(dropZone(get('g'), 0.1), 'before');
  assert.equal(dropZone(get('g'), 0.5), 'inside');
  assert.equal(dropZone(get('g'), 0.9), 'after');
});

test('top-level folders can only be dropped into', () => {
  assert.equal(dropZone(get('1'), 0.1), 'inside');
  assert.equal(dropZone(get('1'), 0.9), 'inside');
});

test('reordering uses positions from before the node is taken out', () => {
  assert.deepEqual(resolveDrop(nodes, get('a'), get('c'), 'before'), { parentId: '1', index: 2 });
  assert.deepEqual(resolveDrop(nodes, get('a'), get('c'), 'after'), { parentId: '1', index: 3 });
  assert.deepEqual(resolveDrop(nodes, get('c'), get('a'), 'before'), { parentId: '1', index: 0 });
  assert.deepEqual(resolveDrop(nodes, get('c'), get('a'), 'after'), { parentId: '1', index: 1 });
});

test('moving into a folder targets its end', () => {
  assert.deepEqual(resolveDrop(nodes, get('a'), get('f'), 'inside'), { parentId: 'f', index: 2 });
  assert.deepEqual(resolveDrop(nodes, get('x'), get('a'), 'before'), { parentId: '1', index: 0 });
  assert.deepEqual(resolveDrop(nodes, get('x'), get('1'), 'inside'), { parentId: '1', index: 4 });
});

test('a drop that would change nothing is rejected', () => {
  assert.equal(resolveDrop(nodes, get('b'), get('b'), 'before'), null, 'on itself');
  assert.equal(resolveDrop(nodes, get('b'), get('a'), 'after'), null, 'already right after it');
  assert.equal(resolveDrop(nodes, get('b'), get('c'), 'before'), null, 'already right before it');
  assert.equal(resolveDrop(nodes, get('g'), get('f'), 'inside'), null, 'already last in the folder');
});

test('a folder cannot be dropped into itself or its own subtree', () => {
  assert.equal(resolveDrop(nodes, get('f'), get('f'), 'inside'), null);
  assert.equal(resolveDrop(nodes, get('f'), get('g'), 'inside'), null);
  assert.equal(resolveDrop(nodes, get('f'), get('x'), 'after'), null);
});

test('nothing can land beside top-level folders, in the root or inside managed folders', () => {
  assert.equal(resolveDrop(nodes, get('a'), get('1'), 'before'), null);
  assert.equal(resolveDrop(nodes, get('a'), get('0'), 'inside'), null);
  assert.equal(resolveDrop(nodes, get('a'), get('3'), 'inside'), null);
  assert.equal(resolveDrop(nodes, get('a'), get('m'), 'after'), null);
});

test('resolveStep moves one place and stops at the ends', () => {
  assert.deepEqual(resolveStep(nodes, get('b'), 'back'), { parentId: '1', index: 0 });
  assert.deepEqual(resolveStep(nodes, get('b'), 'forward'), { parentId: '1', index: 3 });
  assert.equal(resolveStep(nodes, get('a'), 'back'), null);
  assert.equal(resolveStep(nodes, get('f'), 'forward'), null);
  assert.equal(resolveStep(nodes, get('1'), 'forward'), null, 'top-level folders stay put');
});

test('folderTrail lists folders from the root down', () => {
  assert.deepEqual(folderTrail(nodes, 'g').map((n) => n.id), ['0', '1', 'f', 'g']);
  assert.deepEqual(folderTrail(nodes, '0').map((n) => n.id), ['0']);
  assert.deepEqual(folderTrail(nodes, 'missing'), []);
});
