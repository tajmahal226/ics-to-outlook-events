#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CSS_ROOT = path.join(ROOT, 'src');

async function collectCssFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectCssFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.css') ? [fullPath] : [];
  }));
  return files.flat();
}

const declarationPattern = /(?<![\w-])--([A-Za-z0-9_-]+)\s*:/g;
const referencePattern = /var\(\s*--([A-Za-z0-9_-]+)/g;

const files = await collectCssFiles(CSS_ROOT);
const declarations = new Set();
const references = [];

for (const file of files) {
  const css = await readFile(file, 'utf8');
  for (const match of css.matchAll(declarationPattern)) {
    declarations.add(match[1]);
  }
  for (const match of css.matchAll(referencePattern)) {
    references.push({ name: match[1], file });
  }
}

const missing = references.filter(({ name }) => !declarations.has(name));

if (missing.length > 0) {
  console.error('Undefined CSS custom properties:');
  for (const { name, file } of missing) {
    console.error(`- --${name} referenced in ${path.relative(ROOT, file)}`);
  }
  process.exit(1);
}

console.log(`CSS variable check passed (${declarations.size} declarations, ${references.length} references).`);
