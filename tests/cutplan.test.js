import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLE_PARTS, bandCounts, bandLabel, fitLabel, partSize, planCuts, sizeLabel } from '../public/js/cutplan.js';

const state = (overrides = {}) => ({
  sheetLength: '2800',
  sheetWidth: '2070',
  kerf: '4',
  trim: '10',
  grain: false,
  sheetPrice: '',
  bandPrice: '',
  parts: EXAMPLE_PARTS.map((part, index) => ({ id: index + 1, ...part })),
  ...overrides,
});

test('the example kitchen needs two sheets and adds up its banding', () => {
  const plan = planCuts(state());
  assert.equal(plan.sheetOk, true);
  assert.equal(plan.pieceCount, 26);
  assert.equal(plan.result.sheetCount, 2);
  assert.equal(plan.result.partCount, 26);
  assert.equal(plan.result.unplaced.length, 0);
  // One long edge each, plus both short edges of the tall sides:
  // 8×720 + 4×564 + 8×564 + 4×562 + 2×(2100 + 2×580) = 21296 mm
  assert.equal(plan.banding.totalMm, 21296);
  assert.equal(plan.banding.totalMeters, 21.3);
  assert.equal(plan.totalCents, 0, 'no prices, no cost');
});

test('prices give the material cost', () => {
  const plan = planCuts(state({ sheetPrice: '42,50', bandPrice: '0,35' }));
  assert.equal(plan.sheetCents, 8500); // 2 sheets
  assert.equal(plan.bandCents, 746); // 21.3 m × 0.35 € = 7.455 €
  assert.equal(plan.totalCents, 9246);
});

test('rows that are blank or invalid are left out, oversized ones reported', () => {
  const plan = planCuts(
    state({
      parts: [
        { id: 1, name: '', length: '600', width: '400', qty: '2', edges: {} },
        { id: 2, name: 'Μισό', length: '600', width: '', qty: '1', edges: {} },
        { id: 3, name: 'Λάθος', length: 'abc', width: '300', qty: '1', edges: {} },
        { id: 4, name: 'Μηδέν', length: '300', width: '300', qty: '0', edges: {} },
        { id: 5, name: 'Πάγκος', length: '3200', width: '600', qty: '1', edges: { top: true } },
      ],
    }),
  );
  assert.deepEqual(plan.valid.map((part) => part.name), ['Κομμάτι 1', 'Πάγκος']);
  assert.equal(plan.pieceCount, 3);
  assert.equal(plan.result.partCount, 2);
  assert.deepEqual(plan.result.unplaced.map((part) => part.name), ['Πάγκος']);
});

test('grain stops parts turning; a bad sheet gives no layout', () => {
  const tall = [{ id: 1, name: 'Πλαϊνό', length: '2100', width: '600', qty: '1', edges: {} }];
  const narrow = { sheetLength: '700', sheetWidth: '2200', trim: '0', parts: tall };
  assert.equal(planCuts(state(narrow)).result.sheets[0].placements[0].rotated, true);
  assert.equal(planCuts(state({ ...narrow, grain: true })).result.unplaced.length, 1);

  for (const sheet of [{ sheetLength: '' }, { sheetWidth: 'abc' }, { trim: '1100' }]) {
    const plan = planCuts(state(sheet));
    assert.equal(plan.sheetOk, false);
    assert.equal(plan.result.sheetCount, 0);
  }
});

test('banded sides: top and bottom are the long ones', () => {
  assert.deepEqual(bandCounts({ top: true, bottom: true, left: true }), { bandLong: 2, bandShort: 1 });
  assert.deepEqual(bandCounts(undefined), { bandLong: 0, bandShort: 0 });
  assert.equal(bandLabel({ bandLong: 1, bandShort: 2 }), '1 μακριά + 2 κοντές');
  assert.equal(bandLabel({ bandLong: 2, bandShort: 1 }), '2 μακριές + 1 κοντή');
  assert.equal(bandLabel({ bandLong: 0, bandShort: 0 }), '—');
});

test('labels shrink, turn or drop detail to fit a piece', () => {
  const measure = (text, size) => text.length * size * 0.6;
  const options = [['Πλαϊνό', '720×560'], ['720×560'], ['1']];
  assert.deepEqual(fitLabel(options, 720, 560, [80, 58], measure), { lines: ['Πλαϊνό', '720×560'], size: 80, vertical: false });
  // Too narrow to read across, but long enough to turn the text.
  assert.deepEqual(fitLabel(options, 160, 900, [80, 58], measure), { lines: ['Πλαϊνό', '720×560'], size: 58, vertical: true });
  assert.deepEqual(fitLabel(options, 100, 900, [80, 58], measure), { lines: ['720×560'], size: 58, vertical: true });
  assert.deepEqual(fitLabel(options, 200, 130, [80, 58], measure), { lines: ['1'], size: 80, vertical: false });
  assert.equal(fitLabel(options, 20, 20, [80, 58], measure), null);
});

test('placed pieces report their size as typed', () => {
  assert.deepEqual(partSize({ length: 560, width: 720, rotated: true }), { length: 720, width: 560 });
  assert.deepEqual(partSize({ length: 720, width: 560, rotated: false }), { length: 720, width: 560 });
  assert.equal(sizeLabel(2100, 562.5), '2.100×562,5');
});
