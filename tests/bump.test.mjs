import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bump, nextVersion, readVersion } from '../scripts/bump.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function project(manifestVersion, packageVersion = manifestVersion) {
  const root = mkdtempSync(join(tmpdir(), 'bump-'));
  // Deliberately odd formatting and a nested "version", which must both survive.
  writeFileSync(join(root, 'manifest.json'), `{\n  "manifest_version": 3,\n  "name": "X",\n  "version": "${manifestVersion}",\n  "action": { "default_title": "a" }\n}\n`);
  writeFileSync(join(root, 'package.json'), `{\n    "name": "x",\n    "version": "${packageVersion}",\n    "nested": { "version": "9.9.9" }\n}\n`);
  return root;
}

test('this project\'s two version numbers agree', () => {
  assert.match(readVersion(ROOT), /^\d+\.\d+\.\d+$/);
});

test('nextVersion handles each kind of step', () => {
  assert.equal(nextVersion('0.2.3', 'patch'), '0.2.4');
  assert.equal(nextVersion('0.2.3', 'minor'), '0.3.0');
  assert.equal(nextVersion('0.2.3', 'major'), '1.0.0');
  assert.equal(nextVersion('0.2.3', '0.10.0'), '0.10.0');
});

test('nextVersion compares numbers, not text', () => {
  assert.equal(nextVersion('0.9.0', '0.10.0'), '0.10.0');
  assert.throws(() => nextVersion('0.10.0', '0.9.0'), /not higher/);
});

test('nextVersion refuses a version that does not go up', () => {
  assert.throws(() => nextVersion('0.2.0', '0.2.0'), /not higher/);
  assert.throws(() => nextVersion('0.2.0', '0.1.9'), /not higher/);
});

test('nextVersion refuses anything that is not a version', () => {
  for (const bad of [undefined, '', 'huge', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', 'constructor']) {
    assert.throws(() => nextVersion('0.2.0', bad), /patch, minor, major/, String(bad));
  }
});

test('bump updates both files and nothing else in them', () => {
  const root = project('0.2.0');
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  assert.deepEqual(bump('minor', root), { current: '0.2.0', next: '0.3.0' });
  assert.equal(readVersion(root), '0.3.0');
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before.replace('"version": "0.2.0"', '"version": "0.3.0"'));
  assert.ok(readFileSync(join(root, 'manifest.json'), 'utf8').includes('"manifest_version": 3'), 'manifest_version is left alone');
});

test('versions that disagree are reported and left for a person to fix', () => {
  const root = project('0.2.0', '0.1.0');
  assert.throws(() => readVersion(root), /manifest\.json has 0\.2\.0, package\.json has 0\.1\.0/);
  assert.throws(() => bump('patch', root), /Version mismatch/);
  assert.ok(readFileSync(join(root, 'manifest.json'), 'utf8').includes('"0.2.0"'), 'nothing was changed');
});
