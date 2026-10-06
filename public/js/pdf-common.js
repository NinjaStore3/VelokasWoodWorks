// Shared PDF plumbing: the pdf-lib bundle, fonts with Greek, brand colours and
// text helpers. Everything is fetched only when the first PDF is made.

export const PAGE = { width: 595.28, height: 841.89, margin: 40 }; // A4 in points

const COLORS = {
  walnut: [0.18, 0.11, 0.07],
  amber: [0.95, 0.66, 0.23],
  cream: [1, 0.957, 0.902],
  tan: [0.84, 0.76, 0.66],
  text: [0.169, 0.114, 0.078],
  muted: [0.43, 0.365, 0.314],
  faint: [0.6, 0.53, 0.47],
  line: [0.9, 0.86, 0.8],
  fill: [0.984, 0.969, 0.945],
  head: [0.953, 0.918, 0.871],
  white: [1, 1, 1],
  danger: [0.75, 0.2, 0.16],
};

let lib;
const files = new Map();

let loadAsset = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
};

// Tests run in Node, where fonts come from disk instead of fetch().
export function useAssetLoader(loader) {
  loadAsset = loader;
  files.clear();
}

function fetchBytes(url) {
  if (!files.has(url)) files.set(url, loadAsset(url));
  return files.get(url);
}

export async function createDoc(title) {
  lib ??= await import('../vendor/pdf.js');
  const pdf = await lib.PDFDocument.create();
  pdf.registerFontkit(lib.fontkit);
  const [regular, bold, display, logo] = await Promise.all([
    fetchBytes('/fonts/pdf/Manrope-Regular.ttf'),
    fetchBytes('/fonts/pdf/Manrope-Bold.ttf'),
    fetchBytes('/fonts/pdf/Fraunces-SemiBold.ttf'), // Latin only: numbers and amounts
    fetchBytes('/img/icon-192.png'),
  ]);
  const fonts = {
    regular: await pdf.embedFont(regular, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
    display: await pdf.embedFont(display, { subset: true }),
  };
  pdf.setTitle(title);
  pdf.setLanguage('el-GR');
  pdf.setCreator('Velokas Woodworks');
  pdf.setCreationDate(new Date());
  return {
    pdf,
    fonts,
    logo: await pdf.embedPng(logo),
    color: (name) => lib.rgb(...COLORS[name]),
    rgb: lib.rgb,
    degrees: lib.degrees,
  };
}

// Splits text into lines that fit maxWidth, keeping the user's line breaks and
// breaking words that are longer than a whole line.
export function wrap(text, font, size, maxWidth) {
  const width = (value) => font.widthOfTextAtSize(value, size);
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (width(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && width(rest.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

// SVG path (y pointing down from the top-left corner) for a rounded rectangle.
export function roundedRectPath(width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const k = r * 0.5523; // control-point offset that makes Bézier quarter circles
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `C ${width - r + k} 0 ${width} ${r - k} ${width} ${r}`,
    `V ${height - r}`,
    `C ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
    `H ${r}`,
    `C ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
    `V ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0`,
    'Z',
  ].join(' ');
}

// Drawing helpers bound to one page.
export function painter(page, fonts, color) {
  const draw = (value, x, y, { font = fonts.regular, size = 10, tone = 'text' } = {}) =>
    page.drawText(String(value), { x, y, size, font, color: color(tone) });
  return {
    text: draw,
    right(value, xRight, y, options = {}) {
      const font = options.font ?? fonts.regular;
      const size = options.size ?? 10;
      draw(value, xRight - font.widthOfTextAtSize(String(value), size), y, options);
    },
    center(value, xCenter, y, options = {}) {
      const font = options.font ?? fonts.regular;
      const size = options.size ?? 10;
      draw(value, xCenter - font.widthOfTextAtSize(String(value), size) / 2, y, options);
    },
    box(x, yTop, width, height, { fill, stroke, radius = 0, strokeWidth = 0.8 }) {
      const options = {
        x,
        y: yTop,
        color: fill ? color(fill) : undefined,
        borderColor: stroke ? color(stroke) : undefined,
        borderWidth: stroke ? strokeWidth : undefined,
      };
      if (radius > 0) page.drawSvgPath(roundedRectPath(width, height, radius), options);
      else page.drawRectangle({ ...options, y: yTop - height, width, height });
    },
    line(x1, y1, x2, y2, { tone = 'line', thickness = 0.8 } = {}) {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: color(tone) });
    },
  };
}
