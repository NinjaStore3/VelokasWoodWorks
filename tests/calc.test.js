import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildShareText,
  computeQuote,
  emptyDraft,
  formatMoney,
  formatPercent,
  parseAmount,
  parseQty,
} from '../public/js/calc.js';

const config = {
  version: 1,
  settings: { businessName: 'Velokas Woodworks', subtitle: '', vatRate: 24 },
  materials: [
    { id: 1, name: 'Μελαμίνη', price: 320, icon: '' },
    { id: 9, name: 'Λάκα', price: 450.5, icon: '' },
  ],
  extras: [
    { id: 2, name: 'Magic Corner', price: 195, icon: 'square-round-corner' },
    { id: 3, name: 'Μπουκαλοθήκη', price: 80, icon: 'bottle-wine' },
  ],
  costs: [
    { id: 10, name: 'Πορτάκια', price: 0, icon: 'door-closed' },
    { id: 11, name: 'Μεταφορά', price: 30, icon: 'truck' },
  ],
};

const draft = (overrides) => ({ ...emptyDraft(), ...overrides });

test('parseAmount accepts Greek and international number formats', () => {
  assert.equal(parseAmount('4,5'), 4.5);
  assert.equal(parseAmount('4.5'), 4.5);
  assert.equal(parseAmount('1.250'), 1250);
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.equal(parseAmount(' 320 € '), 320);
  assert.equal(parseAmount('0.500'), 0.5);
  assert.equal(parseAmount(',5'), 0.5);
  assert.equal(parseAmount('4.'), 4);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount(12), 12);
});

test('parseAmount rejects invalid amounts', () => {
  for (const bad of ['-3', 'abc', '1,2,3', '4.5.6', '1e5', -1, Number.NaN]) {
    assert.equal(parseAmount(bad), null, `expected ${bad} to be rejected`);
  }
});

test('parseQty only accepts whole pieces', () => {
  assert.equal(parseQty('3'), 3);
  assert.equal(parseQty(' 12 '), 12);
  assert.equal(parseQty(''), 0);
  assert.equal(parseQty('1.5'), null);
  assert.equal(parseQty('-1'), null);
  assert.equal(parseQty('10000'), null);
});

test('formatMoney uses Greek formatting and hides zero cents', () => {
  assert.equal(formatMoney(160000), '1.600 €');
  assert.equal(formatMoney(198440), '1.984,40 €');
  assert.equal(formatMoney(0), '0 €');
  assert.equal(formatMoney(-31700), '-317 €');
  assert.equal(formatPercent(0.1456), '14,6%');
});

test('computeQuote adds base, extras, other extra and VAT', () => {
  const quote = computeQuote(
    config,
    draft({ meters: '4,6', extras: { 2: { qty: '1', price: null }, 3: { qty: '2', price: null } }, other: '150' }),
  );
  assert.equal(quote.material.name, 'Μελαμίνη');
  assert.equal(quote.baseCents, 147200); // 4.6 m × 320 €
  assert.equal(quote.pickedCents, 35500); // 195 + 2 × 80
  assert.equal(quote.otherCents, 15000);
  assert.equal(quote.netCents, 197700);
  assert.equal(quote.vatCents, 47448); // 24 %
  assert.equal(quote.grossCents, 245148);
});

test('computeQuote honours the chosen material and per-quote price overrides', () => {
  const quote = computeQuote(
    config,
    draft({ materialId: 9, meters: '3', extras: { 2: { qty: '2', price: '180' } } }),
  );
  assert.equal(quote.baseCents, 135150); // 3 × 450.50 €
  assert.equal(quote.pickedCents, 36000); // 2 × 180 € instead of 195 €

  const custom = computeQuote(config, draft({ meters: '2', pricePerMeter: '300' }));
  assert.equal(custom.baseCents, 60000);
});

test('computeQuote treats invalid input as zero and falls back to the first material', () => {
  const quote = computeQuote(config, draft({ meters: 'abc', materialId: 999, extras: { 3: { qty: 'x', price: null } } }));
  assert.equal(quote.material.id, 1);
  assert.equal(quote.netCents, 0);
  assert.equal(quote.margin, null);
});

test('computeQuote works out cost, profit and margin', () => {
  const quote = computeQuote(config, draft({ meters: '5', costs: { 10: '700' } }));
  assert.equal(quote.netCents, 160000);
  assert.equal(quote.costCents, 73000); // 700 typed + 30 default transport
  assert.equal(quote.profitCents, 87000);
  assert.equal(quote.margin, 87000 / 160000);
});

test('computeQuote rounds VAT to the cent', () => {
  const quote = computeQuote(config, draft({ other: '123,45' }));
  assert.equal(quote.netCents, 12345);
  assert.equal(quote.vatCents, 2963); // 2962.8 → 2963
});

test('buildShareText lists the quote but never internal costs', () => {
  const quote = computeQuote(
    config,
    draft({ meters: '4,6', extras: { 3: { qty: '2', price: null } }, other: '150', costs: { 10: '999' } }),
  );
  const text = buildShareText(quote, { businessName: 'Velokas Woodworks', date: new Date(2026, 9, 6) });
  assert.match(text, /^Velokas Woodworks · Προσφορά κουζίνας\n6 Οκτωβρίου 2026/);
  assert.match(text, /Βασική κουζίνα \(Μελαμίνη\): 4,6 μ\. × 320 € = 1\.472 €/);
  assert.match(text, /• Μπουκαλοθήκη: 2 × 80 € = 160 €/);
  assert.match(text, /• Άλλο extra: 150 €/);
  assert.match(text, /Σύνολο χωρίς ΦΠΑ: 1\.782 €/);
  assert.match(text, /ΦΠΑ 24%: 427,68 €/);
  assert.match(text, /Σύνολο με ΦΠΑ: 2\.209,68 €/);
  assert.doesNotMatch(text, /999|Πορτάκια|Κέρδος/);
});
