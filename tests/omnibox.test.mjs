import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSuggestions, escapeXml, resolveEntered } from '../lib/omnibox.js';

const bookmark = (title, url, path = '书签栏') => ({ title, url, path });

test('escapeXml makes page titles safe to use in suggestions', () => {
  assert.equal(escapeXml(`a & <b> "c" 'd'`), 'a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;');
  assert.equal(escapeXml('a\u0001b\u000bc￾d'), 'abcd');
  assert.equal(escapeXml('tab\tand\nnewline'), 'tab\tand\nnewline');
});

test('buildSuggestions formats matches with their folder and URL', () => {
  assert.deepEqual(buildSuggestions([bookmark('GitHub', 'https://github.com/', '工作')], 'git'), [
    {
      content: 'https://github.com/',
      description: '<match>GitHub</match> <dim>工作</dim> <url>https://github.com/</url>',
    },
  ]);
});

test('buildSuggestions escapes titles, paths and URLs', () => {
  const [suggestion] = buildSuggestions([bookmark('R&D <x>', 'https://a.com/?x=1&y=2', 'A & B')], 'r&d');
  assert.ok(suggestion.description.includes('R&amp;D &lt;x&gt;'));
  assert.ok(suggestion.description.includes('<dim>A &amp; B</dim>'));
  assert.ok(suggestion.description.includes('x=1&amp;y=2'));
  assert.equal(suggestion.content, 'https://a.com/?x=1&y=2', 'content stays a real URL');
});

test('buildSuggestions leaves out the folder when there is none', () => {
  const [suggestion] = buildSuggestions([bookmark('A', 'https://a.com/', '')], 'a');
  assert.ok(!suggestion.description.includes('<dim>'));
});

test('buildSuggestions shows each URL once and limits the list', () => {
  const copies = buildSuggestions([bookmark('Same', 'https://a.com/'), bookmark('Same too', 'https://a.com/')], 'same');
  assert.equal(copies.length, 1);
  const many = Array.from({ length: 20 }, (_, i) => bookmark(`Item ${i}`, `https://a.com/${i}`));
  assert.equal(buildSuggestions(many, 'item').length, 6);
});

test('buildSuggestions skips bookmarks Chrome will not open', () => {
  const list = [bookmark('tool one', 'javascript:void(0)'), bookmark('tool two', 'https://tool.com/')];
  assert.deepEqual(buildSuggestions(list, 'tool').map((s) => s.content), ['https://tool.com/']);
});

test('buildSuggestions returns nothing for a blank query', () => {
  assert.deepEqual(buildSuggestions([bookmark('A', 'https://a.com/')], '  '), []);
});

const saved = [bookmark('GitHub', 'https://github.com/'), bookmark('Docs', 'https://docs.example/')];

test('resolveEntered opens a picked suggestion', () => {
  assert.equal(resolveEntered(saved, 'https://docs.example/'), 'https://docs.example/');
});

test('resolveEntered opens the best match for typed text', () => {
  assert.equal(resolveEntered(saved, 'git'), 'https://github.com/');
});

test('resolveEntered falls back to searching the bookmark manager', () => {
  assert.equal(resolveEntered(saved, 'nothing here'), 'chrome://bookmarks/?q=nothing%20here');
});

test('resolveEntered never navigates to text that is not a saved bookmark', () => {
  assert.ok(resolveEntered(saved, 'https://evil.example/').startsWith('chrome://bookmarks/?q='));
  assert.ok(resolveEntered(saved, 'javascript:alert(1)').startsWith('chrome://bookmarks/?q='));
});

test('resolveEntered will not open a saved bookmarklet', () => {
  const list = [bookmark('tool', 'javascript:alert(1)')];
  assert.ok(resolveEntered(list, 'javascript:alert(1)').startsWith('chrome://bookmarks/?q='));
  assert.ok(resolveEntered(list, 'tool').startsWith('chrome://bookmarks/?q='));
});
