#!/usr/bin/env node
/**
 * Find root-absolute asset URLs, local secrets and machine-specific paths
 * that would break or leak on a public static host.
 *
 * Usage: node tools/scan-paths.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'work', 'output', 'outputs', 'tmp']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml']);

const RULES = [
  { id: 'absolute-asset-url', re: /["'`(]\s*\/assets\//g, why: 'root-absolute asset path breaks on subdirectory hosting' },
  { id: 'secret', re: /\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, why: 'possible credential' },
  { id: 'private-key', re: /BEGIN [A-Z ]*PRIVATE KEY/g, why: 'private key material' },
  { id: 'local-path', re: /[A-Za-z]:\\\\Users\\\\[^"'\s]+/g, why: 'machine-specific absolute path' },
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let findings = 0;
for (const file of walk(ROOT, [])) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(line)) continue;
      findings++;
      console.log(`${rel}:${i + 1}  [${rule.id}] ${rule.why}`);
      console.log(`    ${line.trim().slice(0, 160)}`);
    }
  });
}

console.log(findings === 0
  ? '\nCLEAN: no root-absolute asset paths, secrets or local paths found.'
  : `\n${findings} finding(s) to review.`);
