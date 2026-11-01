import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canModify, folderOptions, indexTree, searchBookmarks } from '../lib/bookmarks-model.js';

const roots = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        parentId: '0',
        title: '书签栏',
        children: [
          { id: '10', parentId: '1', title: 'GitHub', url: 'https://github.com/' },
          {
            id: '11',
            parentId: '1',
            title: '工作',
            children: [
              { id: '20', parentId: '11', title: 'Linear', url: 'https://linear.app/' },
              { id: '21', parentId: '11', title: '子目录', children: [] },
            ],
          },
        ],
      },
      {
        id: '2',
        parentId: '0',
        title: '其他书签',
        children: [{ id: '30', parentId: '2', title: 'Docs', url: 'https://docs.github.com/' }],
      },
      {
        id: '3',
        parentId: '0',
        title: '受管理',
        unmodifiable: 'managed',
        children: [{ id: '40', parentId: '3', title: 'Corp', url: 'https://corp.example/', unmodifiable: 'managed' }],
      },
    ],
  },
];

test('indexTree records folder paths and descendant counts', () => {
  const { bookmarks, nodes } = indexTree(roots);
  assert.equal(bookmarks.length, 4);
  assert.equal(nodes.get('20').path, '书签栏 / 工作');
  assert.equal(nodes.get('1').count, 2);
  assert.equal(nodes.get('21').count, 0);
});

test('canModify rejects the root, top-level folders and managed nodes', () => {
  const { nodes } = indexTree(roots);
  assert.equal(canModify(nodes.get('0')), false);
  assert.equal(canModify(nodes.get('1')), false);
  assert.equal(canModify(nodes.get('40')), false);
  assert.equal(canModify(nodes.get('11')), true);
  assert.equal(canModify(nodes.get('10')), true);
});

test('folderOptions lists writable folders by depth and can exclude a subtree', () => {
  assert.deepEqual(
    folderOptions(roots).map(({ id, depth }) => [id, depth]),
    [['1', 0], ['11', 1], ['21', 2], ['2', 0]],
  );
  assert.deepEqual(folderOptions(roots, '11').map(({ id }) => id), ['1', '2']);
});

test('searchBookmarks requires every term and ranks title matches first', () => {
  const { bookmarks } = indexTree(roots);
  assert.deepEqual(searchBookmarks(bookmarks, 'github').items.map((b) => b.id), ['10', '30']);
  assert.deepEqual(searchBookmarks(bookmarks, 'DOCS github').items.map((b) => b.id), ['30']);
  assert.deepEqual(searchBookmarks(bookmarks, '工作').items.map((b) => b.id), ['20']);
  assert.equal(searchBookmarks(bookmarks, '   ').total, 0);
});

test('searchBookmarks caps items but reports the full total', () => {
  const { bookmarks } = indexTree(roots);
  const { items, total } = searchBookmarks(bookmarks, 'https', 1);
  assert.equal(items.length, 1);
  assert.equal(total, 4);
});
