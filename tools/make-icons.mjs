// Renders the app icons (home screen, manifest) from one SVG: a lit lantern in the dark.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/icons');
fs.mkdirSync(OUT, { recursive: true });

// pad: fraction of the canvas left empty around the lantern (maskable icons need more)
const svg = (pad) => {
  const s = 512, inner = s * (1 - pad * 2), o = s * pad, k = inner / 64;
  const T = (x, y) => `${(o + x * k).toFixed(1)},${(o + y * k).toFixed(1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="58%" r="70%"><stop offset="0" stop-color="#2a2016"/><stop offset=".45" stop-color="#110d10"/><stop offset="1" stop-color="#050407"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff8a2a"/><stop offset=".6" stop-color="#ffd27a"/><stop offset="1" stop-color="#fff4d0"/></linearGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>
  <circle cx="${o + 32 * k}" cy="${o + 34 * k}" r="${22 * k}" fill="url(#glow)"/>
  <path d="M${T(24, 13)} L${T(40, 13)} L${T(37, 19)} L${T(27, 19)} Z" fill="#b8925a"/>
  <path d="M${T(29, 8)} Q${T(32, 4)} ${T(35, 8)}" fill="none" stroke="#b8925a" stroke-width="${2.2 * k}" stroke-linecap="round"/>
  <rect x="${o + 21 * k}" y="${o + 19 * k}" width="${22 * k}" height="${27 * k}" rx="${4 * k}" fill="rgba(255,190,110,.08)" stroke="#c9a45c" stroke-width="${3 * k}"/>
  <path d="M${T(32, 24)} C${T(37, 30)} ${T(38, 35)} ${T(32, 42)} C${T(26, 35)} ${T(27, 30)} ${T(32, 24)} Z" fill="url(#flame)"/>
  <path d="M${T(23, 46)} L${T(41, 46)} L${T(43, 51)} L${T(21, 51)} Z" fill="#b8925a"/>
</svg>`;
};

const jobs = [
  ['icon-192.png', 192, 0.1], ['icon-512.png', 512, 0.1],
  ['icon-maskable-512.png', 512, 0.2], ['apple-touch-icon.png', 180, 0.12],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(name, size);
}
