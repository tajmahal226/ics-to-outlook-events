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

const classSelectorPattern = /(^|[\s,{>+~])\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/gm;
const invalidClassPattern = /(^|[\s,{>+~])\.(-?\d[^\s,{>+~:#.[)]*)/gm;
const files = await collectCssFiles(CSS_ROOT);
const classes = new Set();
const invalid = [];

for (const file of files) {
  const css = await readFile(file, 'utf8');
  for (const match of css.matchAll(classSelectorPattern)) {
    classes.add(match[2]);
  }
  for (const match of css.matchAll(invalidClassPattern)) {
    invalid.push({ name: match[2], file });
  }
}

if (invalid.length > 0) {
  console.error('Invalid CSS class selectors:');
  for (const { name, file } of invalid) {
    console.error(`- .${name} in ${path.relative(ROOT, file)}`);
  }
  process.exit(1);
}

console.log(`CSS class check passed (${classes.size} class selectors).`);
