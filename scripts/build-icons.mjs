// Builds public/icons.svg, an SVG sprite with only the Lucide icons the app uses.
// Stroke styles come from the .icon rule in public/css/app.css.
// Usage: npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { PICKER_ICONS, UI_ICONS } from '../public/js/icons.js';

const root = new URL('../', import.meta.url);
const lucide = new URL('node_modules/lucide-static/', root);
const names = [...new Set([...PICKER_ICONS.map(([name]) => name), ...UI_ICONS])].sort();

const symbols = names.map((name) => {
  const svg = readFileSync(new URL(`icons/${name}.svg`, lucide), 'utf8');
  const body = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '');
  return `<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`;
});

const licence = readFileSync(new URL('LICENSE', lucide), 'utf8').trim();
const sprite = `<svg xmlns="http://www.w3.org/2000/svg">
<!--
Icons from Lucide (https://lucide.dev)
${licence.replace(/-{2,}/g, '-')}
-->
${symbols.join('\n')}
</svg>
`;

writeFileSync(new URL('public/icons.svg', root), sprite);
console.log(`public/icons.svg: ${names.length} icons, ${sprite.length} bytes`);
