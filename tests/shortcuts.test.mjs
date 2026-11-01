import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMacPlatform, opensShortcutHelp, shortcutGroups } from '../lib/shortcuts.js';

const allKeys = (isMac) => shortcutGroups(isMac, (key) => key).flatMap((group) => group.items.flatMap((item) => item.keys));

test('isMacPlatform recognises the values browsers report', () => {
  assert.equal(isMacPlatform('macOS'), true);
  assert.equal(isMacPlatform('MacIntel'), true);
  assert.equal(isMacPlatform('Windows'), false);
  assert.equal(isMacPlatform('Linux x86_64'), false);
});

test('labels match the keys on a Mac keyboard', () => {
  const keys = allKeys(true);
  for (const key of ['⌘', '⌥', 'Delete']) assert.ok(keys.includes(key), key);
  for (const key of ['Ctrl', 'Alt', 'Backspace']) assert.ok(!keys.includes(key), key);
});

test('labels match the keys on other keyboards', () => {
  const keys = allKeys(false);
  for (const key of ['Ctrl', 'Alt', 'Backspace']) assert.ok(keys.includes(key), key);
  for (const key of ['⌘', '⌥', 'Delete']) assert.ok(!keys.includes(key), key);
});

test('every entry says what it does', () => {
  for (const group of shortcutGroups(true, (key) => key)) {
    assert.ok(group.title);
    for (const { keys, action } of group.items) {
      assert.ok(keys.length > 0);
      assert.ok(action);
    }
  }
});

const press = (key, extra = {}) => ({ key, ...extra });
const away = { editing: false, emptySearch: false, dialogOpen: false };

test('? opens the list when not typing', () => {
  assert.equal(opensShortcutHelp(press('?'), away), true);
  assert.equal(opensShortcutHelp(press('？'), away), true, 'a Chinese input method gives the full-width mark');
});

test('? opens the list from an empty search box', () => {
  assert.equal(opensShortcutHelp(press('?'), { editing: true, emptySearch: true, dialogOpen: false }), true);
});

test('? stays typeable once there is something in the search box or another field', () => {
  assert.equal(opensShortcutHelp(press('?'), { editing: true, emptySearch: false, dialogOpen: false }), false);
});

test('? does nothing over an open dialog, mid-composition or with a modifier', () => {
  assert.equal(opensShortcutHelp(press('?'), { ...away, dialogOpen: true }), false);
  assert.equal(opensShortcutHelp(press('?', { isComposing: true }), away), false);
  assert.equal(opensShortcutHelp(press('?', { metaKey: true }), away), false);
  assert.equal(opensShortcutHelp(press('?', { ctrlKey: true }), away), false);
  assert.equal(opensShortcutHelp(press('?', { altKey: true }), away), false);
});

test('other keys never open it', () => {
  assert.equal(opensShortcutHelp(press('/'), away), false);
  assert.equal(opensShortcutHelp(press('a'), away), false);
});
