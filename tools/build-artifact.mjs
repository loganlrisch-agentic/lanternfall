// Builds artifact-build/: a copy of public/ for the claude.ai artifact viewer.
// That viewer won't serve .glb files, and on phones it blocks fetch() for the page's
// own files, so every model and sound is turned into small script files holding
// base64 (scripts load under the same rules as game.js itself). index.html gets
// window.LF_PACKED and an index of the packs; src/core/assets.js reads them.
// Vercel and local dev don't need this; they serve public/ as-is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'artifact-build');
const CHUNK = 700_000;          // characters of base64 per script file
const SFX_BUNDLE = 600_000;     // characters of base64 per sound bundle

fs.rmSync(OUT, { recursive: true, force: true });
const index = { files: {}, sfx: 0 };
const sfx = [];
let files = 0, bytes = 0;
const write = (to, data) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, data); files++; bytes += Buffer.byteLength(data); };
const js = s => JSON.stringify(s);

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, e.name);
    const rel = path.relative(SRC, from).split(path.sep).join('/');
    if (e.isDirectory()) { walk(from); continue; }
    if (rel === 'game.js.map') continue;
    if (rel.startsWith('assets/') && e.name.endsWith('.glb')) {
      const key = rel.slice('assets/'.length);
      const b64 = fs.readFileSync(from).toString('base64');
      const n = Math.ceil(b64.length / CHUNK);
      index.files[key] = n;
      for (let i = 0; i < n; i++) {
        write(path.join(OUT, 'assets', `${key}.${i}.js`),
          `(window.__LFP=window.__LFP||{});(window.__LFP[${js(key)}]=window.__LFP[${js(key)}]||[])[${i}]=${js(b64.slice(i * CHUNK, (i + 1) * CHUNK))};\n`);
      }
    } else if (rel.startsWith('assets/sfx/') && e.name.endsWith('.mp3')) {
      sfx.push([rel.slice('assets/'.length), fs.readFileSync(from).toString('base64')]);
    } else if (rel === 'index.html') {
      continue;   // written last, once the index is known
    } else {
      write(path.join(OUT, rel), fs.readFileSync(from));
    }
  }
})(SRC);

// bundle the sounds into a few scripts
let bundle = [], size = 0;
const flush = () => {
  if (!bundle.length) return;
  const body = bundle.map(([k, b]) => `(window.__LFP[${js(k)}]=[${js(b)}]);`).join('\n');
  write(path.join(OUT, 'assets', `sfx-pack.${index.sfx}.js`), `window.__LFP=window.__LFP||{};\n${body}\n`);
  index.sfx++; bundle = []; size = 0;
};
for (const item of sfx) { if (size + item[1].length > SFX_BUNDLE) flush(); bundle.push(item); size += item[1].length; }
flush();

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
if (!html.includes('</head>')) throw new Error('index.html has no </head>');
write(path.join(OUT, 'index.html'), html.replace('</head>', `<script>window.LF_PACKED = 1; window.LF_PACK_INDEX = ${js(index)};</script>\n</head>`));
console.log(`artifact-build: ${files} files, ${(bytes / 1048576).toFixed(1)} MB (${Object.keys(index.files).length} models, ${index.sfx} sound bundles)`);
