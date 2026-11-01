import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planImport, serializeBookmarks } from '../lib/transfer.js';

test('serializeBookmarks writes the format browsers expect', () => {
  const html = serializeBookmarks([
    {
      id: '1',
      parentId: '0',
      title: '书签栏',
      dateAdded: 1000000,
      dateGroupModified: 2000000,
      children: [{ id: '5', parentId: '1', title: 'A', url: 'https://a.com/', dateAdded: 3000000 }],
    },
    { id: '2', parentId: '0', title: '其他', children: [] },
  ]);
  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.ok(html.includes('charset=UTF-8'));
  assert.ok(html.includes('<DT><H3 ADD_DATE="1000" LAST_MODIFIED="2000" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>'));
  assert.ok(html.includes('<DT><A HREF="https://a.com/" ADD_DATE="3000">A</A>'));
  assert.ok(html.includes('<DT><H3>其他</H3>'));
  assert.ok(html.trimEnd().endsWith('</DL><p>'));
});

test('serializeBookmarks escapes titles and URLs', () => {
  const html = serializeBookmarks([
    { id: '9', parentId: '1', title: '<script>"a" & b</script>', url: 'https://a.com/?x=1&y="2"' },
  ]);
  assert.ok(html.includes('&lt;script&gt;&quot;a&quot; &amp; b&lt;/script&gt;'));
  assert.ok(html.includes('HREF="https://a.com/?x=1&amp;y=&quot;2&quot;"'));
  assert.ok(!html.includes('<script>'));
});

const bookmark = (title, url) => ({ title, url });
const folder = (title, ...children) => ({ title, children });

test('planImport keeps the structure and counts what it finds', () => {
  const { items, counts } = planImport(
    [bookmark('A', 'https://a.com/'), folder('F', bookmark('B', 'https://b.com/'), folder('G', bookmark('C', 'https://c.com/')))],
    new Set(),
  );
  assert.deepEqual(items, [
    bookmark('A', 'https://a.com/'),
    folder('F', bookmark('B', 'https://b.com/'), folder('G', bookmark('C', 'https://c.com/'))),
  ]);
  assert.deepEqual(counts, { bookmarks: 3, folders: 2, duplicates: 0, scripts: 0, invalid: 0 });
});

test('planImport skips URLs you already have and repeats within the file', () => {
  const { items, counts } = planImport(
    [bookmark('Have', 'https://have.com'), bookmark('New', 'https://new.com/'), bookmark('New again', 'https://new.com')],
    new Set(['https://have.com/']),
  );
  assert.deepEqual(items.map((i) => i.title), ['New']);
  assert.equal(counts.duplicates, 2);
});

test('planImport can keep duplicates when asked', () => {
  const { items, counts } = planImport([bookmark('Have', 'https://have.com/')], new Set(['https://have.com/']), {
    skipExisting: false,
  });
  assert.equal(items.length, 1);
  assert.equal(counts.duplicates, 0);
});

test('planImport leaves out bookmarks that run code unless asked', () => {
  const tree = [bookmark('Tool', 'javascript:alert(1)'), bookmark('Data', 'data:text/html,x')];
  const skipped = planImport(tree, new Set());
  assert.deepEqual(skipped.items, []);
  assert.equal(skipped.counts.scripts, 2);
  assert.equal(skipped.counts.bookmarks, 0);

  const included = planImport(tree, new Set(), { includeScripts: true });
  assert.equal(included.items.length, 2);
  assert.equal(included.counts.scripts, 2);
  assert.equal(included.counts.bookmarks, 2);
});

test('planImport rejects invalid URLs and Firefox saved queries', () => {
  const { items, counts } = planImport(
    [bookmark('Broken', 'not a url'), bookmark('Empty', ''), bookmark('Query', 'place:sort=8&maxResults=10')],
    new Set(),
  );
  assert.deepEqual(items, []);
  assert.equal(counts.invalid, 3);
});

test('planImport drops folders emptied by skipping but keeps ones that were already empty', () => {
  const { items, counts } = planImport(
    [folder('Emptied', bookmark('Have', 'https://have.com/')), folder('Was empty')],
    new Set(['https://have.com/']),
  );
  assert.deepEqual(items, [folder('Was empty')]);
  assert.equal(counts.folders, 1);
});

test('planImport titles an untitled bookmark with its URL', () => {
  const { items } = planImport([bookmark('', 'https://a.com/')], new Set());
  assert.equal(items[0].title, 'https://a.com/');
});
