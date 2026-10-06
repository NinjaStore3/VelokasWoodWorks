// Panel cutting optimiser and edge-banding total for the cut list. No DOM
// access, so the same module runs in the browser and in the Node tests.
//
// Layouts are guillotine layouts, as a panel saw needs: every cut runs straight
// across the piece being cut. Packing follows the guillotine family in Jukka
// Jylänki's "A Thousand Ways to Pack the Bin": each sheet keeps a list of free
// rectangles, a part goes into the top-left corner of one, and the L-shaped
// leftover becomes two new free rectangles split along one axis. Several
// deterministic strategies run and the best layout wins.
//
// x runs along the sheet length (the grain), y along the sheet width.

// Sizes are worked in hundredths of a millimetre so every comparison is exact
// integer maths (no 0.1 + 0.2 surprises when deciding whether a part fits).
const SCALE = 100;
const toUnits = (mm) => Math.round(mm * SCALE);
const toMm = (units) => units / SCALE;

// How snugly a w × h piece sits in a free rectangle, as [score, tie-break]:
// lower is better.
const FITS = {
  bestArea: (rect, w, h) => [rect.w * rect.h, Math.min(rect.w - w, rect.h - h)],
  bestShortSide: (rect, w, h) => [Math.min(rect.w - w, rect.h - h), Math.max(rect.w - w, rect.h - h)],
  bestLongSide: (rect, w, h) => [Math.max(rect.w - w, rect.h - h), Math.min(rect.w - w, rect.h - h)],
};

// Whether the leftover beside a placed part is split by a horizontal cut, so
// the offcut below spans the free rectangle's full length (otherwise the offcut
// to the right spans its full width). right and below are the leftover sizes
// once the kerf is taken off.
const SPLITS = {
  shorterLeftover: (rect, w, h, right, below) => right <= below,
  longerLeftover: (rect, w, h, right, below) => right > below,
  // Keeps one offcut as big as possible.
  minArea: (rect, w, h, right, below) => right * h < w * below,
};

// Biggest pieces first. Array sort is stable, so equal pieces keep cut-list order.
const ORDERS = {
  area: (a, b) => b.w * b.h - a.w * a.h,
  longSide: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || Math.min(b.w, b.h) - Math.min(a.w, a.h),
  shortSide: (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h),
  perimeter: (a, b) => b.w + b.h - (a.w + a.h),
};

// Every combination, always tried in this order (ties keep the earliest).
const STRATEGIES = Object.keys(ORDERS).flatMap((order) =>
  Object.keys(FITS).flatMap((fit) => Object.keys(SPLITS).map((split) => ({ order, fit, split }))),
);

const UPRIGHT = [false];
const EITHER_WAY = [false, true];

// A finite number above zero (numeric strings allowed), or null.
function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Size and piece count of a cut-list row, or null if it can't be cut.
// A missing qty means one piece.
function readRow(part) {
  const length = positive(part?.length);
  const width = positive(part?.width);
  const qty = Math.floor(positive(part?.qty ?? 1) ?? 0);
  return length && width && qty >= 1 ? { length, width, qty } : null;
}

// The rows that can be cut, sized in units: unrotated, w runs along the sheet
// length and h along its width. The row index stands in for a missing id.
function readParts(parts) {
  const clean = [];
  (Array.isArray(parts) ? parts : []).forEach((part, index) => {
    const row = readRow(part);
    const w = toUnits(row?.length ?? 0);
    const h = toUnits(row?.width ?? 0);
    if (w > 0 && h > 0) {
      clean.push({ id: part.id ?? index, name: part.name ?? '', w, h, qty: row.qty, rotate: part.rotate !== false });
    }
  });
  return clean;
}

// What's left of a sheet once every edge is trimmed, in units.
function usableArea(sheet, trim) {
  const w = toUnits(positive(sheet?.length) ?? 0) - 2 * trim;
  const h = toUnits(positive(sheet?.width) ?? 0) - 2 * trim;
  return { x: trim, y: trim, w: Math.max(w, 0), h: Math.max(h, 0) };
}

function fitsEmptySheet(part, area) {
  return (part.w <= area.w && part.h <= area.h) || (part.rotate && part.h <= area.w && part.w <= area.h);
}

function openSheet(area) {
  return { free: [{ ...area }], placed: [], used: 0 };
}

function isSnugger(score, best) {
  return score[0] < best[0] || (score[0] === best[0] && score[1] < best[1]);
}

// The best free rectangle and orientation for a part on this sheet, or null.
function findSpot(sheet, part, fit) {
  let best = null;
  const turns = part.rotate && part.w !== part.h ? EITHER_WAY : UPRIGHT;
  sheet.free.forEach((rect, index) => {
    for (const rotated of turns) {
      const w = rotated ? part.h : part.w;
      const h = rotated ? part.w : part.h;
      if (w > rect.w || h > rect.h) continue;
      const score = fit(rect, w, h);
      if (!best || isSnugger(score, best.score)) best = { part, rect, index, w, h, rotated, score };
    }
  });
  return best;
}

// Puts the part in the top-left corner of the free rectangle. Each cut beside it
// costs a kerf, except on a side where the part reaches the rectangle's edge;
// a leftover thinner than the blade is lost to the cut.
function place(sheet, spot, kerf, split) {
  const { rect, index, w, h } = spot;
  sheet.placed.push({ x: rect.x, y: rect.y, w, h, part: spot.part, rotated: spot.rotated });
  sheet.used += w * h;

  const right = rect.w - w - kerf;
  const below = rect.h - h - kerf;
  const horizontal = right <= 0 || (below > 0 && split(rect, w, h, right, below));
  const offcuts = [];
  if (below > 0) offcuts.push({ x: rect.x, y: rect.y + h + kerf, w: horizontal ? rect.w : w, h: below });
  if (right > 0) offcuts.push({ x: rect.x + w + kerf, y: rect.y, w: right, h: horizontal ? h : rect.h });
  sheet.free.splice(index, 1, ...offcuts);
  mergeOffcuts(sheet, offcuts, kerf);
}

// Two free rectangles that line up exactly either side of one saw cut, as one.
function joined(a, b, kerf) {
  if (a.y === b.y && a.h === b.h && (a.x + a.w + kerf === b.x || b.x + b.w + kerf === a.x)) {
    return { x: Math.min(a.x, b.x), y: a.y, w: a.w + kerf + b.w, h: a.h };
  }
  if (a.x === b.x && a.w === b.w && (a.y + a.h + kerf === b.y || b.y + b.h + kerf === a.y)) {
    return { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + kerf + b.h };
  }
  return null;
}

// Joins the new offcuts with free rectangles they line up with, giving room for
// bigger parts. A join can break the guillotine property (four parts around a
// pinwheel), so it is kept only if the sheet can still be cut apart.
function mergeOffcuts(sheet, offcuts, kerf) {
  const pending = [...offcuts];
  while (pending.length > 0) {
    const rect = pending.pop();
    const index = sheet.free.indexOf(rect);
    if (index === -1) continue;
    for (let other = 0; other < sheet.free.length; other++) {
      const merged = other === index ? null : joined(rect, sheet.free[other], kerf);
      if (!merged) continue;
      const free = sheet.free.filter((_, i) => i !== index && i !== other);
      if (!canCutApart([...sheet.placed, ...free, merged], kerf)) continue;
      sheet.free.splice(Math.max(index, other), 1);
      sheet.free[Math.min(index, other)] = merged;
      pending.push(merged);
      break;
    }
  }
}

// True if straight cuts right across can separate the rectangles, recursively,
// with at least a kerf between the two sides of every cut. Any valid cut will
// do: if a set can be cut apart, so can every subset of it.
function canCutApart(rects, kerf) {
  if (rects.length < 2) return true;
  for (const [start, size] of [['x', 'w'], ['y', 'h']]) {
    const sorted = [...rects].sort((a, b) => a[start] - b[start]);
    let end = sorted[0][start] + sorted[0][size];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i][start] >= end + kerf) {
        return canCutApart(sorted.slice(0, i), kerf) && canCutApart(sorted.slice(i), kerf);
      }
      end = Math.max(end, sorted[i][start] + sorted[i][size]);
    }
  }
  return false;
}

// Places pieces one by one, in the strategy's order, in the first sheet with
// room; a new sheet is opened only when a piece fits nowhere else.
function pack(parts, area, kerf, strategy) {
  const fit = FITS[strategy.fit];
  const split = SPLITS[strategy.split];
  const pieces = [...parts].sort(ORDERS[strategy.order]).flatMap((part) => Array(part.qty).fill(part));
  const sheets = [];
  for (const piece of pieces) {
    let sheet = null;
    let spot = null;
    for (const candidate of sheets) {
      spot = findSpot(candidate, piece, fit);
      if (spot) {
        sheet = candidate;
        break;
      }
    }
    if (!sheet) {
      sheet = openSheet(area);
      sheets.push(sheet);
      spot = findSpot(sheet, piece, fit);
    }
    place(sheet, spot, kerf, split);
  }
  return sheets;
}

// Fewest sheets wins. On a tie, the layout whose last sheet holds the least:
// more of the material on the earlier sheets and a bigger offcut on the last.
// Remaining ties keep the earlier strategy.
function isBetterLayout(sheets, best) {
  if (sheets.length !== best.length) return sheets.length < best.length;
  return sheets[sheets.length - 1].used < best[best.length - 1].used;
}

function describeSheet(sheet, sheetArea) {
  const placements = sheet.placed.map((piece) => ({
    partId: piece.part.id,
    name: piece.part.name,
    x: toMm(piece.x),
    y: toMm(piece.y),
    length: toMm(piece.w),
    width: toMm(piece.h),
    rotated: piece.rotated,
  }));
  const usedArea = placements.reduce((sum, piece) => sum + piece.length * piece.width, 0);
  return { placements, usedArea, utilization: usedArea / sheetArea };
}

// Lays the parts out on as few sheets as it can. Sizes are in mm; kerf is the
// width of the saw cut and trim is cut off every edge of each sheet first.
// Parts with rotate: false keep their length along the sheet length (grain).
export function optimizeCuts({ sheet, parts, kerf = 4, trim = 0 } = {}) {
  const kerfUnits = toUnits(positive(kerf) ?? 0);
  const area = usableArea(sheet, toUnits(positive(trim) ?? 0));
  const rows = readParts(parts);
  const fitting = rows.filter((part) => fitsEmptySheet(part, area));

  let best = [];
  if (fitting.length > 0) {
    best = null;
    for (const strategy of STRATEGIES) {
      const sheets = pack(fitting, area, kerfUnits, strategy);
      if (!best || isBetterLayout(sheets, best)) best = sheets;
    }
  }

  const sheetArea = (positive(sheet?.length) ?? 0) * (positive(sheet?.width) ?? 0);
  const sheets = best.map((packed) => describeSheet(packed, sheetArea));
  const usedArea = sheets.reduce((sum, packed) => sum + packed.usedArea, 0);
  return {
    sheets,
    unplaced: rows
      .filter((part) => !fitsEmptySheet(part, area))
      .map((part) => ({ partId: part.id, name: part.name, length: toMm(part.w), width: toMm(part.h), qty: part.qty })),
    sheetCount: sheets.length,
    partCount: sheets.reduce((sum, packed) => sum + packed.placements.length, 0),
    utilization: sheets.length > 0 ? usedArea / (sheets.length * sheetArea) : 0,
  };
}

// 0, 1 or 2 banded edges; other values are clamped into that range.
function bandedEdges(value) {
  return Math.min(Math.max(Math.floor(Number(value) || 0), 0), 2);
}

// Edge banding for the cut list: bandLong / bandShort say how many of each
// part's long and short edges get banded. Rows that can't be cut are ignored.
export function edgeBanding(parts) {
  let total = 0; // units, so the sum stays exact
  for (const part of Array.isArray(parts) ? parts : []) {
    const row = readRow(part);
    if (!row) continue;
    const long = toUnits(Math.max(row.length, row.width));
    const short = toUnits(Math.min(row.length, row.width));
    total += row.qty * (bandedEdges(part.bandLong) * long + bandedEdges(part.bandShort) * short);
  }
  return { totalMm: toMm(total), totalMeters: Math.round(total / 1000) / 100 };
}
