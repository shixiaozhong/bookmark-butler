import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { buildZip, collectFiles, missingManifestFiles } from '../scripts/package.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = collectFiles();

test('only what the extension runs on is packaged', () => {
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.includes('LICENSE'), 'the MIT license must travel with copies');
  assert.ok(files.includes('_locales/en/messages.json'));
  assert.ok(files.includes('_locales/zh_CN/messages.json'));
  for (const file of files) {
    assert.ok(!/^(tests|scripts|dist|node_modules|\.git)\b|package\.json|README|\.DS_Store/.test(file), file);
  }
});

test('everything the manifest points at is packaged', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual(missingManifestFiles(manifest, files), []);
  assert.deepEqual(missingManifestFiles({ icons: { 16: 'icons/gone.png' } }, files), ['icons/gone.png']);
});

test('everything the code and pages load is packaged', () => {
  const packaged = new Set(files);
  for (const file of files) {
    if (!/\.(js|html)$/.test(file)) continue;
    const text = readFileSync(join(ROOT, file), 'utf8');
    const references = [
      ...[...text.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:src|href)="(\.?\.?\/?[\w./-]+\.(?:js|css))"/g)].map((m) => m[1]),
    ];
    for (const reference of references) {
      const target = normalize(join(dirname(file), reference)).split('\\').join('/');
      assert.ok(packaged.has(target), `${file} needs ${target}`);
    }
  }
});

test('the zip holds the right bytes and is reproducible', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello hello hello') },
    { name: 'dir/中文.json', data: Buffer.from('{"x":1}') },
    { name: 'empty', data: Buffer.alloc(0) },
  ];
  const zip = buildZip(entries);
  assert.ok(zip.equals(buildZip(entries)), 'same input, same output');

  // Read it back through the central directory, the way unzip tools do.
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), entries.length);
  let position = zip.readUInt32LE(end + 16);
  for (const { name, data } of entries) {
    assert.equal(zip.readUInt32LE(position), 0x02014b50);
    const compressedSize = zip.readUInt32LE(position + 20);
    const nameLength = zip.readUInt16LE(position + 28);
    assert.equal(zip.toString('utf8', position + 46, position + 46 + nameLength), name);
    const local = zip.readUInt32LE(position + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    assert.ok(inflateRawSync(zip.subarray(start, start + compressedSize)).equals(data), name);
    position += 46 + nameLength;
  }
});
