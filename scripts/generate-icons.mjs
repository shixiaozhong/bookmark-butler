// Draws the toolbar icon (a white ribbon on a blue rounded square) and writes
// one PNG per size. No dependencies: pixels are supersampled, then encoded by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];
const SAMPLES = 4;

function insideRoundedSquare(x, y, radius = 0.22) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function insideRibbon(x, y) {
  if (x < 0.3 || x > 0.7 || y < 0.2 || y > 0.82) return false;
  // The V-shaped notch cut out of the bottom edge.
  return y <= 0.82 - 0.17 * (1 - Math.abs(x - 0.5) / 0.2);
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let square = 0;
      let ribbon = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (insideRoundedSquare(x, y)) square++;
          if (insideRibbon(x, y)) ribbon++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const mix = ribbon / total;
      const offset = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = Math.round(BLUE[c] * (1 - mix) + WHITE[c] * mix);
      }
      pixels[offset + 3] = Math.round((square / total) * 255);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [16, 48, 128]) {
  const file = new URL(`../icons/icon-${size}.png`, import.meta.url);
  writeFileSync(file, encodePng(size, renderRgba(size)));
}
