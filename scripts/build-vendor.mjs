// Bundles pdf-lib + @pdf-lib/fontkit into one browser ES module,
// public/vendor/pdf.js, loaded only when someone makes a PDF.
// Usage: npm run vendor
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const path = (p) => new URL(p, root).pathname;

await build({
  stdin: {
    contents: "export * from 'pdf-lib';\nexport { default as fontkit } from '@pdf-lib/fontkit';\n",
    resolveDir: path('.'),
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  outfile: path('public/vendor/pdf.js'),
});

// @pdf-lib/fontkit (MIT, per its package.json) ships without a licence file.
const FONTKIT_LICENCE = `MIT License

Copyright (c) 2014-present Devon Govett (fontkit); fork by Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Licences of everything inside the bundle.
const licences = [
  ['pdf-lib', readFileSync(path('node_modules/pdf-lib/LICENSE.md'), 'utf8')],
  ['@pdf-lib/fontkit', FONTKIT_LICENCE],
  ['pako', readFileSync(path('node_modules/pako/LICENSE'), 'utf8')],
  ['tslib', readFileSync(path('node_modules/tslib/LICENSE.txt'), 'utf8')],
];
const text = licences
  .map(([name, licence]) => `${name}\n${'='.repeat(name.length)}\n\n${licence.trim()}\n`)
  .join('\n\n');
writeFileSync(path('public/vendor/LICENSES.txt'), `Third-party code bundled in pdf.js\n\n${text}`);

console.log('public/vendor/pdf.js written');
