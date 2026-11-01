// Sets the version in manifest.json and package.json together. Usage:
//   npm run bump patch        0.2.0 -> 0.2.1
//   npm run bump minor        0.2.0 -> 0.3.0
//   npm run bump major        0.2.0 -> 1.0.0
//   npm run bump 1.4.0        an exact version
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION_FILES = ['manifest.json', 'package.json'];
const VERSION = /^\d+\.\d+\.\d+$/;

/** The version both files agree on. Throws if they don't, since that can only be a mistake. */
export function readVersion(root = ROOT) {
  const versions = VERSION_FILES.map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')).version);
  if (versions[0] !== versions[1]) {
    throw new Error(`Version mismatch: ${VERSION_FILES.map((file, i) => `${file} has ${versions[i]}`).join(', ')}`);
  }
  return versions[0];
}

function isHigher(next, current) {
  const [a, b] = [next, current].map((version) => version.split('.').map(Number));
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Works out the new version. It has to go up, because the Chrome Web Store refuses anything else. */
export function nextVersion(current, request) {
  const [major, minor, patch] = current.split('.').map(Number);
  const steps = {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  };
  const next = Object.hasOwn(steps, request ?? '') ? steps[request] : request;
  if (!VERSION.test(next ?? '')) throw new Error('Say patch, minor, major or an exact version like 1.4.0');
  if (!isHigher(next, current)) throw new Error(`${next} is not higher than the current version, ${current}`);
  return next;
}

/** Replaces only the version line, leaving the rest of each file's formatting alone. */
export function bump(request, root = ROOT) {
  const current = readVersion(root);
  const next = nextVersion(current, request);
  for (const file of VERSION_FILES) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
  }
  return { current, next };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { current, next } = bump(process.argv[2]);
    console.log(`${current} -> ${next}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
