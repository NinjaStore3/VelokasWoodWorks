// The offline cache must list files that exist (or installing the service
// worker fails), and every module the app loads.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const publicDir = new URL('../public/', import.meta.url);
const source = readFileSync(new URL('sw.js', publicDir), 'utf8');
const list = (name) => [...source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every cached file exists', () => {
  for (const path of [...list('SHELL'), ...list('PDF_FILES')]) {
    const file = path === '/' ? 'index.html' : path.slice(1);
    assert.ok(existsSync(new URL(file, publicDir)), `${path} is missing`);
  }
});

test('every script is cached for offline use', () => {
  const cached = new Set([...list('SHELL'), ...list('PDF_FILES')]);
  for (const file of readdirSync(new URL('js/', publicDir))) {
    assert.ok(cached.has(`/js/${file}`), `/js/${file} is not in sw.js`);
  }
});
