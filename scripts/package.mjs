// Builds dist/bookmark-butler-<version>.zip holding only what the extension runs on,
// ready to upload to the Chrome Web Store or unzip and load. No dependencies, so it
// works anywhere Node does. Timestamps are fixed, so the same files give the same zip.
// Run it through `npm run package`, which runs the tests first.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { readVersion } from './bump.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INCLUDED = ['manifest.json', 'background.js', '_locales', 'icons', 'lib', 'popup', 'transfer'];

// 2026-01-01 00:00 in the DOS format zip files use.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const VERSION_NEEDED = 20;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;

function walk(path, found = []) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (!name.startsWith('.')) walk(join(path, name), found);
    }
  } else {
    found.push(path);
  }
  return found;
}

/** The files to package, as paths relative to `root` with forward slashes. */
export function collectFiles(root = ROOT) {
  return INCLUDED.flatMap((entry) => walk(join(root, entry))).map((path) => relative(root, path).split(sep).join('/'));
}

/** Paths the manifest points at that aren't among `files`, so a bad build fails here rather than in Chrome. */
export function missingManifestFiles(manifest, files) {
  const present = new Set(files);
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.default_locale && `_locales/${manifest.default_locale}/messages.json`,
  ].filter(Boolean);
  return referenced.filter((path) => !present.has(path));
}

export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function main() {
  const version = readVersion();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const files = collectFiles();
  const missing = missingManifestFiles(manifest, files);
  if (missing.length) throw new Error(`The manifest points at missing files: ${missing.join(', ')}`);

  const zip = buildZip(files.map((name) => ({ name, data: readFileSync(join(ROOT, name)) })));
  const output = join(ROOT, 'dist', `bookmark-butler-${version}.zip`);
  if (!existsSync(join(ROOT, 'dist'))) mkdirSync(join(ROOT, 'dist'));
  writeFileSync(output, zip);
  console.log(`${relative(ROOT, output)}: ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
