// Builds every logo file from assets/logo-source.png, the logo as delivered:
// copper and cream artwork on a dark, semi-transparent background.
// Usage: npm run logo
//
// The artwork is cut out of its background (the dark halo goes), then saved as:
//   public/img/logo.webp           full logo, transparent (login screens)
//   public/img/logo-mark.webp      the round VW mark, transparent (header)
//   public/img/logo-wordmark.webp  VELOKAS / WOODWORKS, transparent (header)
//   public/img/icon-*.png, apple-touch-icon.png, favicon.png  app icons
//   public/img/pdf-mark.jpg, pdf-wordmark.jpg  on the PDF header colour
//   docs/logo.jpg                  for the README
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const path = (p) => new URL(p, root).pathname;

// The PDF header band (COLORS.walnut in public/js/pdf-common.js), so the
// JPEGs sit on it without a visible edge.
const PDF_BAND = { r: 46, g: 28, b: 18 };

// ---------- Cut the artwork out of its background ----------
const { data, info } = await sharp(path('assets/logo-source.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const N = W * H;

const smoothstep = (lo, hi, x) => {
  const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  return t * t * (3 - 2 * t);
};

// The halo and the background are dark (brightest channel up to ~80); the
// artwork is copper or cream (from ~110 up). The ramp between keeps the edges
// smooth.
const mask = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const o = i * 4;
  const brightest = Math.max(data[o], data[o + 1], data[o + 2]);
  mask[i] = smoothstep(72, 112, brightest) * smoothstep(0.35, 0.75, data[o + 3] / 255);
}

// Edge pixels are mixed with the dark halo; give them the colour of the solid
// artwork next to them, or they'd draw a dark outline on light backgrounds.
const color = new Float32Array(N * 3);
let filled = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (mask[i] > 0.97) {
    filled[i] = 1;
    color[i * 3] = data[i * 4];
    color[i * 3 + 1] = data[i * 4 + 1];
    color[i * 3 + 2] = data[i * 4 + 2];
  }
}
for (let pass = 0; pass < 6; pass++) {
  const next = filled.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i] || mask[i] === 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (!filled[j]) continue;
          r += color[j * 3];
          g += color[j * 3 + 1];
          b += color[j * 3 + 2];
          n++;
        }
      }
      if (n) {
        color[i * 3] = r / n;
        color[i * 3 + 1] = g / n;
        color[i * 3 + 2] = b / n;
        next[i] = 1;
      }
    }
  }
  filled = next;
}

const art = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const solid = mask[i] > 0.97;
  art[i * 4] = solid ? data[i * 4] : Math.round(color[i * 3]);
  art[i * 4 + 1] = solid ? data[i * 4 + 1] : Math.round(color[i * 3 + 1]);
  art[i * 4 + 2] = solid ? data[i * 4 + 2] : Math.round(color[i * 3 + 2]);
  art[i * 4 + 3] = Math.round(mask[i] * 255);
}

// ---------- Find the parts: mark, name, "woodworks" line, tagline ----------
const rowHasArt = (y, x0 = 0, x1 = W) => {
  for (let x = x0; x < x1; x++) if (art[(y * W + x) * 4 + 3] > 8) return true;
  return false;
};
const bands = [];
for (let y = 0; y < H; y++) {
  if (!rowHasArt(y)) continue;
  const last = bands.at(-1);
  if (last && y - last.bottom <= 10) last.bottom = y;
  else bands.push({ top: y, bottom: y });
}
if (bands.length !== 4) {
  throw new Error(`Expected 4 parts (mark, name, woodworks, tagline) stacked in the logo, found ${bands.length}.`);
}
const [markBand, nameBand, worksBand, taglineBand] = bands;

function box(top, bottom, pad) {
  let left = W;
  let right = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < W; x++) {
      if (art[(y * W + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  const x0 = Math.max(0, left - pad);
  const y0 = Math.max(0, top - pad);
  return { left: x0, top: y0, width: Math.min(W, right + pad + 1) - x0, height: Math.min(H, bottom + pad + 1) - y0 };
}

const cutout = () => sharp(art, { raw: { width: W, height: H, channels: 4 } });
const part = async (area) => sharp(await cutout().extract(area).png().toBuffer());

const fullArea = box(markBand.top, taglineBand.bottom, 6);
const markArea = box(markBand.top, markBand.bottom, 4);
const wordArea = box(nameBand.top, worksBand.bottom, 4);

const webp = { quality: 86, alphaQuality: 90, effort: 6 };
const outputs = [];
async function save(pipeline, file) {
  const result = await pipeline.toFile(path(file));
  outputs.push(`${file} ${result.width}×${result.height} ${Math.round(result.size / 1024)} KB`);
}

// ---------- Web: transparent artwork ----------
await save((await part(fullArea)).resize({ width: 720 }).webp(webp), 'public/img/logo.webp');
await save((await part(markArea)).resize({ width: 240 }).webp(webp), 'public/img/logo-mark.webp');
await save((await part(wordArea)).resize({ height: 120 }).webp(webp), 'public/img/logo-wordmark.webp');

// ---------- App icons: the mark on dark walnut with a warm glow ----------
function backdrop(size, { rounded }) {
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="bg" cx="50%" cy="45%" r="72%">
        <stop offset="0" stop-color="#3b2517"/>
        <stop offset="0.6" stop-color="#1f130b"/>
        <stop offset="1" stop-color="#0d0805"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#f0a24a" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#f0a24a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.45}" fill="url(#glow)"/>
  </svg>`;
  return sharp(Buffer.from(svg));
}

async function icon(file, size, { markShare, rounded }) {
  const mark = await (await part(markArea)).resize({ width: Math.round(size * markShare) }).png().toBuffer();
  const { width, height } = await sharp(mark).metadata();
  const layer = await backdrop(size, { rounded })
    .composite([{ input: mark, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png()
    .toBuffer();
  const pipeline = sharp(layer);
  // Phones round these themselves, so they must be fully opaque squares.
  await save(rounded ? pipeline.png({ compressionLevel: 9 }) : pipeline.flatten({ background: '#0d0805' }).png({ compressionLevel: 9 }), file);
}

await icon('public/img/icon-192.png', 192, { markShare: 0.74, rounded: true });
await icon('public/img/icon-512.png', 512, { markShare: 0.74, rounded: true });
// Android crops maskable icons to a circle or squircle: keep the mark well inside.
await icon('public/img/icon-maskable-512.png', 512, { markShare: 0.58, rounded: false });
await icon('public/img/apple-touch-icon.png', 180, { markShare: 0.7, rounded: false });
await icon('public/img/favicon.png', 64, { markShare: 0.86, rounded: true });

// ---------- PDF: on the header colour (pdf-lib embeds JPEG or PNG) ----------
const jpeg = { quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true };
await save((await part(markArea)).resize({ width: 360 }).flatten({ background: PDF_BAND }).jpeg(jpeg), 'public/img/pdf-mark.jpg');
await save((await part(wordArea)).resize({ height: 150 }).flatten({ background: PDF_BAND }).jpeg(jpeg), 'public/img/pdf-wordmark.jpg');

// ---------- README: the full logo on a dark plaque ----------
const plaqueWidth = 720;
const logo = await (await part(fullArea)).resize({ width: 560 }).png().toBuffer();
const logoMeta = await sharp(logo).metadata();
const plaqueHeight = logoMeta.height + 120;
const plaque = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${plaqueWidth}" height="${plaqueHeight}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0" stop-color="#2f1d12"/>
      <stop offset="1" stop-color="#0d0805"/>
    </radialGradient>
  </defs>
  <rect width="${plaqueWidth}" height="${plaqueHeight}" fill="url(#bg)"/>
</svg>`);
await save(
  sharp(plaque)
    .composite([{ input: logo, left: Math.round((plaqueWidth - logoMeta.width) / 2), top: 60 }])
    .flatten({ background: '#0d0805' })
    .jpeg({ quality: 86, mozjpeg: true }),
  'docs/logo.jpg',
);

console.log(outputs.join('\n'));
