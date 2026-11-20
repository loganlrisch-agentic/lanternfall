// Builds artifact-build/: a copy of public/ for hosts that won't serve .glb files
// (the claude.ai artifact preview). Each model is written as <name>.glb.txt holding
// base64, and index.html sets window.LF_PACKED so the loader reads those instead.
// Vercel and local dev don't need this; they serve public/ as-is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'artifact-build');

fs.rmSync(OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, e.name);
    const rel = path.relative(SRC, from);
    if (e.isDirectory()) { walk(from); continue; }
    let to = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (e.name.endsWith('.glb')) {
      to += '.txt';
      fs.writeFileSync(to, fs.readFileSync(from).toString('base64'));
    } else if (rel === 'index.html') {
      const html = fs.readFileSync(from, 'utf8');
      const tag = '<script>window.LF_PACKED = 1;</script>\n';
      if (!html.includes('</head>')) throw new Error('index.html has no </head>');
      fs.writeFileSync(to, html.replace('</head>', tag + '</head>'));
    } else {
      fs.copyFileSync(from, to);
    }
    files++; bytes += fs.statSync(to).size;
  }
})(SRC);
console.log(`artifact-build: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
