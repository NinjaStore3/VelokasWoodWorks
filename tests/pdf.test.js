import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildQuoteDoc, computeQuote, emptyDraft } from '../public/js/calc.js';
import { EXAMPLE_PARTS, planCuts } from '../public/js/cutplan.js';
import { useAssetLoader } from '../public/js/pdf-common.js';
import { cutsPdf } from '../public/js/pdf-cuts.js';
import { quotePdf } from '../public/js/pdf-quote.js';
import { PDFDocument } from '../public/vendor/pdf.js';

useAssetLoader((url) => readFile(new URL(`../public${url}`, import.meta.url)));

const config = {
  settings: {
    businessName: 'Velokas Woodworks',
    vatRate: 24,
    depositPercent: 40,
    validityDays: 30,
    phone: '210 1234567',
    email: 'info@example.com',
    address: 'Λεωφόρος Αθηνών 1, Αθήνα',
    vatId: '123456789',
    terms: 'Η τιμή περιλαμβάνει μεταφορά και τοποθέτηση.\nΠληρωμή: 40% προκαταβολή, υπόλοιπο στην παράδοση.',
  },
  materials: [{ id: 1, name: 'Μελαμίνη', price: 320, icon: '' }],
  extras: [
    { id: 2, name: 'Magic Corner', price: 195, icon: 'square-round-corner' },
    { id: 3, name: 'Μπουκαλοθήκη', price: 80, icon: 'bottle-wine' },
  ],
  costs: [],
};

function docFor(draftOverrides) {
  const draft = { ...emptyDraft(), ...draftOverrides };
  return buildQuoteDoc(computeQuote(config, draft), draft, { validityDays: 30, date: new Date('2026-10-06T10:00:00Z') });
}

test('a quote PDF is built with Greek text, discount and deposit', async () => {
  const doc = docFor({
    meters: '4,6',
    extras: { 2: { qty: '1', price: null }, 3: { qty: '2', price: null } },
    other: '150',
    otherLabel: 'Φωτισμός LED κάτω από τα ντουλάπια',
    discount: '10',
    customer: { name: 'Μαρία Παπαδάκη', phone: '6900000000', address: 'Χαλάνδρι' },
    notes: 'Χρώμα λευκό ματ.\nΠαράδοση σε 5 εβδομάδες.',
  });
  doc.number = '2026-007';
  const bytes = await quotePdf(doc, config.settings);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.length > 10_000 && bytes.length < 400_000, `${bytes.length} bytes`);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1, 'a typical quote fits on one page');
  assert.equal(pdf.getTitle(), 'Προσφορά 2026-007 · Velokas Woodworks');
});

test('long quotes flow onto more pages', async () => {
  const extras = {};
  const many = { ...config, extras: [] };
  for (let id = 10; id < 70; id++) {
    many.extras.push({ id, name: `Εξάρτημα ${id} με αρκετά μεγάλη περιγραφή για να αναδιπλωθεί σε δύο γραμμές`, price: 12.5, icon: '' });
    extras[id] = { qty: '3', price: null };
  }
  const draft = { ...emptyDraft(), meters: '3', extras, notes: 'Σημείωση. '.repeat(120) };
  const doc = buildQuoteDoc(computeQuote(many, draft), draft, { validityDays: 15 });
  const bytes = await quotePdf(doc, config.settings);
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(pages >= 2, `${pages} pages`);
});

test('a cut plan PDF lists the parts and draws every sheet', async () => {
  const parts = [...EXAMPLE_PARTS, { name: 'Πάγκος', length: '3200', width: '600', qty: '1', edges: { top: true } }];
  const plan = planCuts({
    sheetLength: '2800',
    sheetWidth: '2070',
    kerf: '4',
    trim: '10',
    grain: false,
    sheetPrice: '42',
    bandPrice: '0,35',
    parts: parts.map((part, index) => ({ id: index + 1, ...part })),
  });
  assert.equal(plan.result.sheetCount, 2);
  const pdf = await PDFDocument.load(await cutsPdf(plan, config.settings));
  assert.equal(pdf.getPageCount(), 2, 'the first sheet shares page 1 with the list');
  assert.equal(pdf.getTitle(), 'Λίστα κοπής · Velokas Woodworks');
});
