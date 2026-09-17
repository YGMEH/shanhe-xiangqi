#!/usr/bin/env node
/**
 * Report directory sizes and large files so we can decide what to publish.
 * Usage: node tools/size-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push({ file: full, size: fs.statSync(full).size });
    }
  }
  return out;
}

const files = walk(ROOT, []);
const byTop = new Map();
let total = 0;

for (const f of files) {
  total += f.size;
  const rel = path.relative(ROOT, f.file);
  const top = rel.includes(path.sep) ? rel.split(path.sep)[0] : '(root files)';
  byTop.set(top, (byTop.get(top) || 0) + f.size);
}

console.log('Published tree total: ' + (total / 1024 / 1024).toFixed(2) + ' MB\n');
console.log('By top-level entry:');
for (const [name, size] of [...byTop].sort((a, b) => b[1] - a[1])) {
  console.log('  ' + (size / 1024 / 1024).toFixed(2).padStart(8) + ' MB  ' + name);
}

console.log('\nFiles over 1 MB (top 25):');
for (const f of files.filter((x) => x.size > 1024 * 1024).sort((a, b) => b.size - a.size).slice(0, 25)) {
  console.log('  ' + (f.size / 1024 / 1024).toFixed(2).padStart(8) + ' MB  ' + path.relative(ROOT, f.file));
}
