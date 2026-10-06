// The cut plan behind the Κοπές tab and its PDF: reads the raw inputs, runs the
// optimiser, adds up banding and cost. No DOM access, so it runs in Node too.
import { formatNumber, parseAmount, parseQty, toCents } from './calc.js';
import { edgeBanding, optimizeCuts } from './cutlist.js';

// A few base cabinets and a tall unit, to show what the tab does. edges says
// which sides get edge banding: top/bottom are the long sides.
export const EXAMPLE_PARTS = [
  { name: 'Πλαϊνό ντουλαπιού', length: '720', width: '560', qty: '8', edges: { top: true } },
  { name: 'Πάτος', length: '564', width: '560', qty: '4', edges: { top: true } },
  { name: 'Τραβέρσα', length: '564', width: '100', qty: '8', edges: { top: true } },
  { name: 'Ράφι', length: '562', width: '520', qty: '4', edges: { top: true } },
  { name: 'Πλαϊνό ψηλού', length: '2100', width: '580', qty: '2', edges: { top: true, left: true, right: true } },
];

// Banded long and short sides of a part, from its edges.
export function bandCounts(edges = {}) {
  return {
    bandLong: Number(edges.top === true) + Number(edges.bottom === true),
    bandShort: Number(edges.left === true) + Number(edges.right === true),
  };
}

// Everything the results, the dock and the PDF need, from the raw inputs.
export function planCuts(state) {
  const sheet = { length: parseAmount(state.sheetLength) ?? 0, width: parseAmount(state.sheetWidth) ?? 0 };
  const kerf = parseAmount(state.kerf) ?? 0;
  const trim = parseAmount(state.trim) ?? 0;
  const parts = state.parts.map((part, index) => ({
    id: part.id,
    index,
    name: part.name.trim() || `Κομμάτι ${index + 1}`,
    length: parseAmount(part.length) ?? 0,
    width: parseAmount(part.width) ?? 0,
    qty: parseQty(part.qty) ?? 0,
    rotate: !state.grain,
    ...bandCounts(part.edges),
  }));
  const valid = parts.filter((part) => part.length > 0 && part.width > 0 && part.qty > 0);
  const sheetOk = sheet.length > 0 && sheet.width > 0 && sheet.length - 2 * trim > 0 && sheet.width - 2 * trim > 0;
  const result = sheetOk
    ? optimizeCuts({ sheet, parts: valid, kerf, trim })
    : { sheets: [], unplaced: [], sheetCount: 0, partCount: 0, utilization: 0 };
  const banding = edgeBanding(valid);
  const sheetCents = toCents(parseAmount(state.sheetPrice) ?? 0) * result.sheetCount;
  const bandCents = Math.round(toCents(parseAmount(state.bandPrice) ?? 0) * banding.totalMeters);
  return {
    sheet,
    kerf,
    trim,
    grain: state.grain,
    sheetOk,
    parts,
    valid,
    pieceCount: valid.reduce((sum, part) => sum + part.qty, 0),
    result,
    banding,
    sheetCents,
    bandCents,
    totalCents: sheetCents + bandCents,
  };
}

// Picks the most informative label that fits a width × height piece: name and
// size, then just the size, then the part number. Text runs across unless
// turning it along a tall piece lets it be clearly bigger.
export function fitLabel(options, width, height, sizes, measure) {
  const layouts = sizes
    .flatMap((size) => [
      { size, vertical: false, rank: size },
      { size, vertical: true, rank: size * 0.8 },
    ])
    .sort((a, b) => b.rank - a.rank);
  for (const lines of options) {
    for (const { size, vertical } of layouts) {
      const roomW = (vertical ? height : width) - size * 0.6;
      const roomH = (vertical ? width : height) - size * 0.35;
      if (lines.length * size * 1.15 <= roomH && lines.every((line) => measure(line, size) <= roomW)) {
        return { lines, size, vertical };
      }
    }
  }
  return null;
}

// Size of a placed piece as the cut list gives it (it may lie turned).
export function partSize(placement) {
  return placement.rotated
    ? { length: placement.width, width: placement.length }
    : { length: placement.length, width: placement.width };
}

export const sizeLabel = (length, width) => `${formatNumber(length)}×${formatNumber(width)}`;

// "2 μακριές + 1 κοντή" style banding summary for the parts table.
export function bandLabel(part) {
  const bits = [];
  if (part.bandLong > 0) bits.push(`${part.bandLong} ${part.bandLong === 1 ? 'μακριά' : 'μακριές'}`);
  if (part.bandShort > 0) bits.push(`${part.bandShort} ${part.bandShort === 1 ? 'κοντή' : 'κοντές'}`);
  return bits.join(' + ') || '—';
}
