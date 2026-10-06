import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeBanding, optimizeCuts } from '../public/js/cutlist.js';

const SHEET = { length: 2800, width: 2070 };
const EPS = 1e-6;

// Layout invariants every result must satisfy.
function assertValidLayout(result, { sheet, kerf = 4, trim = 0, parts }) {
  const byId = new Map(parts.map((part, index) => [part.id ?? index, part]));
  for (const [index, packed] of result.sheets.entries()) {
    const where = `sheet ${index + 1}`;
    for (const p of packed.placements) {
      assert.ok(p.x >= trim - EPS && p.y >= trim - EPS, `${where}: ${p.partId} starts inside the trim`);
      assert.ok(p.x + p.length <= sheet.length - trim + EPS, `${where}: ${p.partId} runs past the sheet length`);
      assert.ok(p.y + p.width <= sheet.width - trim + EPS, `${where}: ${p.partId} runs past the sheet width`);

      const part = byId.get(p.partId);
      const natural = Math.abs(p.length - part.length) < EPS && Math.abs(p.width - part.width) < EPS;
      const turned = Math.abs(p.length - part.width) < EPS && Math.abs(p.width - part.length) < EPS;
      assert.ok(p.rotated ? turned : natural, `${where}: ${p.partId} size doesn't match its rotated flag`);
      if (part.rotate === false) assert.equal(p.rotated, false, `${where}: ${p.partId} rotated against the grain`);
    }
    // No two pieces overlap, and a kerf separates them along some axis.
    const list = packed.placements;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const gapX = Math.max(b.x - (a.x + a.length), a.x - (b.x + b.length));
        const gapY = Math.max(b.y - (a.y + a.width), a.y - (b.y + b.width));
        assert.ok(gapX >= kerf - EPS || gapY >= kerf - EPS, `${where}: pieces ${i} and ${j} are closer than the kerf`);
      }
    }
  }
}

function pieceCount(parts, result) {
  const placed = result.partCount;
  const unplaced = result.unplaced.reduce((sum, part) => sum + part.qty, 0);
  return { placed, unplaced, expected: parts.reduce((sum, part) => sum + part.qty, 0) };
}

// Small deterministic PRNG (mulberry32) for the property tests.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('four quarter-sheet parts fill one sheet exactly without kerf', () => {
  const parts = [{ id: 'q', name: 'Quarter', length: 1400, width: 1035, qty: 4 }];
  const result = optimizeCuts({ sheet: SHEET, parts, kerf: 0 });
  assert.equal(result.sheetCount, 1);
  assert.equal(result.partCount, 4);
  assert.ok(Math.abs(result.utilization - 1) < EPS);
  assertValidLayout(result, { sheet: SHEET, kerf: 0, parts });
});

test('the saw kerf stops the same four parts fitting on one sheet', () => {
  const parts = [{ id: 'q', length: 1400, width: 1035, qty: 4 }];
  const result = optimizeCuts({ sheet: SHEET, parts, kerf: 4 });
  assert.ok(result.sheetCount > 1);
  assert.equal(result.partCount, 4);
  assertValidLayout(result, { sheet: SHEET, kerf: 4, parts });
});

test('parts rotate to fit when allowed, and are reported when grain forbids it', () => {
  const sheet = { length: 700, width: 2100 };
  const free = optimizeCuts({ sheet, parts: [{ id: 'side', length: 2000, width: 600, qty: 1 }], kerf: 4 });
  assert.equal(free.sheetCount, 1);
  assert.equal(free.sheets[0].placements[0].rotated, true);

  const grain = optimizeCuts({ sheet, parts: [{ id: 'side', length: 2000, width: 600, qty: 1, rotate: false }], kerf: 4 });
  assert.equal(grain.sheetCount, 0);
  assert.deepEqual(grain.unplaced, [{ partId: 'side', name: '', length: 2000, width: 600, qty: 1 }]);
});

test('an oversized part is reported and the rest still placed', () => {
  const parts = [
    { id: 'long', length: 3000, width: 100, qty: 1 },
    { id: 'shelf', length: 800, width: 500, qty: 3 },
  ];
  const result = optimizeCuts({ sheet: SHEET, parts, kerf: 4 });
  assert.deepEqual(result.unplaced.map((part) => part.partId), ['long']);
  assert.equal(result.partCount, 3);
  assertValidLayout(result, { sheet: SHEET, kerf: 4, parts });
});

test('trim keeps every part away from the sheet edges', () => {
  const parts = [{ id: 'p', length: 900, width: 600, qty: 9 }];
  const result = optimizeCuts({ sheet: SHEET, parts, kerf: 4, trim: 10 });
  assertValidLayout(result, { sheet: SHEET, kerf: 4, trim: 10, parts });
  const xs = result.sheets.flatMap((s) => s.placements.map((p) => p.x));
  assert.ok(Math.min(...xs) >= 10);
});

test('a realistic kitchen cut list packs tightly', () => {
  const parts = [
    { id: 'tall-side', name: 'Πλαϊνό ψηλού', length: 2100, width: 580, qty: 2 },
    { id: 'base-side', name: 'Πλαϊνό κάτω', length: 720, width: 560, qty: 10 },
    { id: 'base-bottom', name: 'Πάτος', length: 564, width: 560, qty: 10 },
    { id: 'shelf', name: 'Ράφι', length: 562, width: 520, qty: 8 },
    { id: 'rail', name: 'Τραβέρσα', length: 564, width: 100, qty: 10 },
    { id: 'door', name: 'Πόρτα', length: 716, width: 396, qty: 12 },
  ];
  const result = optimizeCuts({ sheet: SHEET, parts, kerf: 4, trim: 10 });
  const totalArea = parts.reduce((sum, part) => sum + part.length * part.width * part.qty, 0);
  const lowerBound = Math.ceil(totalArea / (SHEET.length * SHEET.width));
  assert.ok(result.sheetCount <= lowerBound + 1, `${result.sheetCount} sheets for a lower bound of ${lowerBound}`);
  assert.equal(result.partCount, 52);
  assert.equal(result.unplaced.length, 0);
  assertValidLayout(result, { sheet: SHEET, kerf: 4, trim: 10, parts });
});

test('random cut lists always give valid layouts', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const random = prng(seed);
    const sheet = { length: 1500 + Math.round(random() * 1500), width: 1000 + Math.round(random() * 1200) };
    const kerf = Math.round(random() * 6);
    const trim = Math.round(random() * 15);
    const parts = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, index) => ({
      id: `p${index}`,
      length: 50 + Math.round(random() * 2600),
      width: 50 + Math.round(random() * 1400),
      qty: 1 + Math.floor(random() * 5),
      rotate: random() > 0.3,
    }));
    const result = optimizeCuts({ sheet, parts, kerf, trim });
    assertValidLayout(result, { sheet, kerf, trim, parts });
    const { placed, unplaced, expected } = pieceCount(parts, result);
    assert.equal(placed + unplaced, expected, `seed ${seed}: every piece is placed or reported`);
  }
});

test('bad rows are ignored instead of throwing', () => {
  const result = optimizeCuts({
    sheet: SHEET,
    parts: [
      { id: 'zero', length: 0, width: 300, qty: 1 },
      { id: 'nan', length: 'abc', width: 300, qty: 1 },
      { id: 'none', length: 300, width: 300, qty: 0 },
      { id: 'ok', length: 300, width: 300, qty: 2 },
    ],
  });
  assert.equal(result.partCount, 2);
  assert.equal(result.unplaced.length, 0);
});

test('same input, same layout, and fast enough for big lists', () => {
  const random = prng(99);
  const parts = Array.from({ length: 60 }, (_, index) => ({
    id: index,
    length: 100 + Math.round(random() * 1200),
    width: 80 + Math.round(random() * 600),
    qty: 5,
  }));
  const started = performance.now();
  const first = optimizeCuts({ sheet: SHEET, parts, kerf: 4, trim: 10 });
  const elapsed = performance.now() - started;
  const second = optimizeCuts({ sheet: SHEET, parts, kerf: 4, trim: 10 });
  assert.deepEqual(first, second);
  assert.equal(first.partCount, 300);
  assert.ok(elapsed < 1500, `300 pieces took ${Math.round(elapsed)} ms`);
});

test('edge banding adds up the banded edges', () => {
  const { totalMm, totalMeters } = edgeBanding([
    { length: 720, width: 560, qty: 2, bandLong: 1, bandShort: 2 },
    { length: 300, width: 0, qty: 5, bandLong: 2 }, // can't be cut: ignored
  ]);
  assert.equal(totalMm, 3680);
  assert.equal(totalMeters, 3.68);
});
