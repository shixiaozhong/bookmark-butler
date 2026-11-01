import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUTO, formatMessage, getLanguage, initI18n, LANGUAGES, plural, t, textLocale } from '../lib/i18n.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const load = (locale) => JSON.parse(readFileSync(join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
const en = load('en');
const zh = load('zh_CN');
const CJK = /[　-〿一-鿿＀-￯]/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const sources = ['background.js', ...['lib', 'popup', 'transfer'].flatMap((dir) => walk(join(ROOT, dir)).map((p) => p.slice(ROOT.length)))];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const scripts = sources.filter((path) => path.endsWith('.js'));
const pages = sources.filter((path) => path.endsWith('.html'));

/** Every message key the code asks for, as written in the source. */
function usedKeys() {
  const direct = new Set(['extension_name', 'locale_code']);
  const plurals = new Set();
  for (const path of scripts) {
    for (const [, key] of read(path).matchAll(/(?<![\w.])t\('([a-z0-9_]+)'/g)) direct.add(key);
    for (const [, key] of read(path).matchAll(/(?<![\w.])plural\('([a-z0-9_]+)'/g)) plurals.add(key);
  }
  for (const path of pages) {
    for (const [, key] of read(path).matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"/g)) direct.add(key);
  }
  return { direct, plurals };
}

const placeholders = (message) => [...message.matchAll(/\$(\d)/g)].map((m) => m[1]).sort().join();

test('every message the code uses exists in both languages', () => {
  const { direct, plurals } = usedKeys();
  for (const key of direct) {
    assert.ok(en[key], `missing in en: ${key}`);
    assert.ok(zh[key], `missing in zh_CN: ${key}`);
  }
  for (const key of plurals) {
    assert.ok(en[`${key}_one`], `missing in en: ${key}_one`);
    assert.ok(en[`${key}_other`], `missing in en: ${key}_other`);
    assert.ok(zh[`${key}_other`], `missing in zh_CN: ${key}_other`);
  }
});

test('no message goes unused', () => {
  const { direct, plurals } = usedKeys();
  const expected = new Set(direct);
  for (const key of plurals) {
    expected.add(`${key}_one`);
    expected.add(`${key}_other`);
  }
  const unused = [...Object.keys(en), ...Object.keys(zh)].filter((key) => !expected.has(key));
  assert.deepEqual([...new Set(unused)], []);
});

test('both languages have the same messages, apart from English singular forms', () => {
  const zhKeys = new Set(Object.keys(zh));
  const enOnly = Object.keys(en).filter((key) => !zhKeys.has(key));
  assert.ok(enOnly.every((key) => key.endsWith('_one')), `only in en: ${enOnly}`);
  const enKeys = new Set(Object.keys(en));
  assert.deepEqual(Object.keys(zh).filter((key) => !enKeys.has(key)), []);
});

test('translations fill in the same values', () => {
  for (const [key, { message }] of Object.entries(zh)) {
    assert.equal(placeholders(message), placeholders(en[key].message), key);
  }
  // A singular may spell out "1" rather than use $1, but it can't need anything else.
  for (const [key, { message }] of Object.entries(en)) {
    if (!key.endsWith('_one')) continue;
    const other = placeholders(en[key.replace(/_one$/, '_other')].message).split(',');
    for (const n of placeholders(message).split(',').filter(Boolean)) assert.ok(other.includes(n), key);
  }
});

test('English messages are in English', () => {
  for (const [key, { message }] of Object.entries(en)) assert.ok(!CJK.test(message), key);
});

test('Chinese is only in the language files', () => {
  // The full-width question mark a Chinese input method types, and a language's own name.
  const allowed = /'？'|zh_CN: '中文'/;
  for (const path of sources) {
    read(path).split('\n').forEach((line, index) => {
      if (CJK.test(line) && !allowed.test(line)) assert.fail(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
});

test('the name and description Chrome lists are always English, within store limits', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, en.extension_name.message);
  assert.ok(manifest.name.length <= 45);
  assert.ok(manifest.description.length <= 132);
  assert.ok(!CJK.test(manifest.name) && !CJK.test(manifest.description));
});

test('the toolbar tooltip follows the language', () => {
  assert.equal(JSON.parse(read('manifest.json')).action.default_title, '__MSG_extension_name__');
});

/** Behaves like chrome.i18n.getMessage for the given language file. */
function useLanguage(messages) {
  globalThis.chrome = {
    i18n: {
      getMessage(key, substitutions = []) {
        const message = messages[key]?.message ?? '';
        return message.replace(/\$(\d)/g, (_, n) => substitutions[Number(n) - 1] ?? '');
      },
    },
  };
}
const realFetch = globalThis.fetch;
after(() => {
  delete globalThis.chrome;
  globalThis.fetch = realFetch;
});

test('plural picks the English form by count', () => {
  useLanguage(en);
  assert.equal(textLocale(), 'en');
  assert.equal(plural('deleted_count', 1), 'Deleted 1 item');
  assert.equal(plural('deleted_count', 2), 'Deleted 2 items');
  assert.equal(plural('deleted_count', 0), 'Deleted 0 items');
});

test('plural passes extra values after the count', () => {
  useLanguage(en);
  assert.equal(plural('imported', 1, 'Work'), 'Imported 1 bookmark into "Work"');
  assert.equal(plural('imported', 3, 'Work'), 'Imported 3 bookmarks into "Work"');
});

test('Chinese has one form for every count', () => {
  useLanguage(zh);
  assert.equal(textLocale(), 'zh-CN');
  assert.equal(plural('deleted_count', 1), '已删除 1 项');
  assert.equal(plural('deleted_count', 5), '已删除 5 项');
  assert.equal(t('selected_count', 3), '已选 3 项');
});

test('every language offered has a message file', () => {
  for (const code of Object.keys(LANGUAGES)) assert.ok(load(code).locale_code, code);
});

test('formatMessage fills values in one pass, so a title containing $1 stays as it is', () => {
  const messages = { edit: { message: 'Edit "$1" in $2, $$5' } };
  assert.equal(formatMessage(messages, 'edit', ['$2 and $1', 'Work']), 'Edit "$2 and $1" in Work, $5');
  assert.equal(formatMessage(messages, 'missing', []), '');
});

/** A browser with stored settings and message files, for testing language choice. */
function useBrowser({ stored, files = {}, fail = false }) {
  useLanguage(zh);
  globalThis.chrome.storage = { local: { get: async () => stored } };
  globalThis.chrome.runtime = { getURL: (path) => path };
  globalThis.fetch = async (path) => {
    if (fail) throw new Error('blocked');
    return { json: async () => files[path] };
  };
}

test('with no choice stored, Chrome decides', async () => {
  useBrowser({ stored: {} });
  assert.equal(await getLanguage(), AUTO);
  await initI18n();
  assert.equal(t('done'), zh.done.message);
});

test('a chosen language overrides Chrome', async () => {
  useBrowser({ stored: { language: 'en' }, files: { '_locales/en/messages.json': en } });
  await initI18n();
  assert.equal(t('done'), 'Done');
  assert.equal(textLocale(), 'en');
  assert.equal(plural('deleted_count', 1), 'Deleted 1 item');
  assert.equal(plural('deleted_count', 2), 'Deleted 2 items');
});

test('going back to auto drops the chosen language', async () => {
  useBrowser({ stored: { language: 'en' }, files: { '_locales/en/messages.json': en } });
  await initI18n();
  useBrowser({ stored: { language: AUTO } });
  await initI18n();
  assert.equal(t('done'), zh.done.message);
});

test('a stored value that is not a language is ignored', async () => {
  useBrowser({ stored: { language: 'constructor' } });
  assert.equal(await getLanguage(), AUTO);
  useBrowser({ stored: { language: 'klingon' } });
  assert.equal(await getLanguage(), AUTO);
});

test('if the language file can not be read, Chrome decides', async (context) => {
  context.mock.method(console, 'error', () => {});
  useBrowser({ stored: { language: 'en' }, fail: true });
  await initI18n();
  assert.equal(t('done'), zh.done.message);
});
