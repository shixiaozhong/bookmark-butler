import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactKey, isPrivateHost, looseKey, normalizeInputUrl } from '../lib/urls.js';

test('exactKey treats only syntactically equal URLs as the same', () => {
  assert.equal(exactKey('HTTPS://Example.com'), exactKey('https://example.com/'));
  assert.equal(exactKey('https://example.com/a#'), exactKey('https://example.com/a'));
  assert.notEqual(exactKey('https://example.com/a'), exactKey('https://example.com/a/'));
  assert.notEqual(exactKey('http://example.com/'), exactKey('https://example.com/'));
});

test('exactKey keeps strings that are not URLs', () => {
  assert.equal(exactKey('not a url'), 'not a url');
});

test('looseKey ignores scheme, www, trailing slash, tracking params and query order', () => {
  const key = looseKey('https://example.com/post?a=1&b=2');
  for (const variant of [
    'http://example.com/post?a=1&b=2',
    'https://www.example.com/post?a=1&b=2',
    'https://example.com/post/?a=1&b=2',
    'https://example.com/post?b=2&a=1',
    'https://example.com/post?a=1&utm_source=x&b=2&fbclid=y',
  ]) {
    assert.equal(looseKey(variant), key, variant);
  }
});

test('looseKey keeps differences that usually mean a different page', () => {
  const key = looseKey('https://example.com/app');
  for (const variant of [
    'https://example.com/app#/settings',
    'https://example.com/app?id=1',
    'https://example.com:8443/app',
    'https://sub.example.com/app',
    'https://example.com/App',
  ]) {
    assert.notEqual(looseKey(variant), key, variant);
  }
});

test('isPrivateHost recognises local and company network hosts', () => {
  for (const host of [
    'localhost',
    'intranet',
    'app.localhost',
    'nas.local',
    'wiki.corp',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '169.254.0.1',
    '100.64.0.1',
    '[::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
  ]) {
    assert.equal(isPrivateHost(host), true, host);
  }
});

test('isPrivateHost leaves public hosts alone', () => {
  for (const host of ['example.com', 'local.example.com', '8.8.8.8', '172.32.0.1', '[2001:db8::1]']) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test('normalizeInputUrl assumes https and keeps explicit schemes', () => {
  assert.equal(normalizeInputUrl(' example.com/a '), 'https://example.com/a');
  assert.equal(normalizeInputUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(normalizeInputUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeInputUrl('mailto:a@example.com'), 'mailto:a@example.com');
  assert.equal(normalizeInputUrl('   '), null);
  assert.equal(normalizeInputUrl('https://'), null);
});
