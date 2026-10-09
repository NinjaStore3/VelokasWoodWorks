import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, ValidationError, validateConfig, validateQuote, validateStatus } from '../src/validate.js';

const valid = () => ({
  version: 3,
  settings: { businessName: '  Velokas   Woodworks ', subtitle: 'Τιμές χωρίς ΦΠΑ', vatRate: 24 },
  materials: [{ id: 1, name: 'Μελαμίνη', price: 320, active: true }],
  extras: [
    { id: 2, name: 'Magic Corner', price: 195.5, icon: 'square-round-corner', active: true },
    { name: 'Νέο extra', price: 10 },
  ],
  costs: [{ id: 5, name: 'Μεταφορά', price: 0, icon: 'truck', active: false }],
});

function errorsFor(body, validate = validateConfig) {
  try {
    validate(body);
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    return error.errors;
  }
  assert.fail('expected a ValidationError');
}

test('normalises a valid config', () => {
  const config = validateConfig(valid());
  assert.equal(config.version, 3);
  assert.equal(config.settings.businessName, 'Velokas Woodworks');
  assert.equal(config.settings.vatRate, 24);
  assert.deepEqual(config.materials, [{ id: 1, name: 'Μελαμίνη', priceCents: 32000, icon: '', unit: 'm', section: 'kitchen', active: true }]);
  assert.deepEqual(config.extras[0], { id: 2, name: 'Magic Corner', priceCents: 19550, icon: 'square-round-corner', unit: 'pcs', section: 'kitchen', active: true });
  assert.deepEqual(config.extras[1], { id: null, name: 'Νέο extra', priceCents: 1000, icon: '', unit: 'pcs', section: 'kitchen', active: true });
  assert.equal(config.costs[0].active, false);
});

test('reports every problem at once', () => {
  const body = valid();
  body.settings.businessName = '';
  body.settings.vatRate = 150;
  body.materials[0].active = false;
  body.extras[0].name = ' ';
  body.extras[1].price = -5;
  body.costs[0].icon = '<script>';
  const errors = errorsFor(body);
  assert.equal(errors.length, 6);
  assert.ok(errors.includes('Χρειάζεται τουλάχιστον ένα ενεργό υλικό.'));
});

test('rejects duplicate ids, bad ids and missing lists', () => {
  const duplicate = valid();
  duplicate.costs[0].id = 1;
  assert.match(errorsFor(duplicate).join(' '), /Διπλότυπες/);

  const badId = valid();
  badId.extras[0].id = 'drop table';
  assert.match(errorsFor(badId).join(' '), /μη έγκυρο id/);

  const missing = valid();
  delete missing.costs;
  assert.match(errorsFor(missing).join(' '), /λείπει η λίστα/);
});

test('rejects non-numeric prices, oversized lists and missing version', () => {
  const textPrice = valid();
  textPrice.materials[0].price = '320';
  assert.match(errorsFor(textPrice).join(' '), /μη έγκυρη τιμή/);

  const tooMany = valid();
  tooMany.extras = Array.from({ length: LIMITS.extra + 1 }, (_, i) => ({ name: `x${i}`, price: 1 }));
  assert.match(errorsFor(tooMany).join(' '), /έως/);

  const noVersion = valid();
  delete noVersion.version;
  assert.match(errorsFor(noVersion).join(' '), /έκδοση/);
});

test('business details for the PDF are optional and checked when given', () => {
  const untouched = validateConfig(valid());
  assert.equal(untouched.settings.phone, undefined, 'missing fields stay as they are');
  assert.equal(untouched.settings.depositPercent, undefined);

  const body = valid();
  Object.assign(body.settings, {
    phone: ' 210  1234567 ',
    email: 'info@velokas.gr',
    address: 'Αθήνα',
    vatId: '123456789',
    terms: 'Γραμμή 1\n\n\n\nΓραμμή 2  ',
    validityDays: 30,
    depositPercent: 33.333,
  });
  const { settings } = validateConfig(body);
  assert.equal(settings.phone, '210 1234567');
  assert.equal(settings.terms, 'Γραμμή 1\n\nΓραμμή 2');
  assert.equal(settings.validityDays, 30);
  assert.equal(settings.depositPercent, 33.33);

  const bad = valid();
  Object.assign(bad.settings, { email: 'not-an-email', validityDays: 1.5, depositPercent: 120, vatId: '1'.repeat(30) });
  assert.equal(errorsFor(bad).length, 4);
});

const quote = () => ({
  status: 'sent',
  customer: { name: '  Μαρία  Παπαδάκη ', phone: '690', address: '' },
  doc: {
    date: '2026-10-06T10:00:00Z',
    validityDays: 30,
    lines: [{ kind: 'base', name: 'Βασική κουζίνα', detail: 'Μελαμίνη', qty: 4.6, unit: 'μ.', unitCents: 32000, totalCents: 147200 }],
    discountLabel: '10%',
    discountCents: 14720,
    vatRate: 24,
    depositPercent: 40,
    notes: 'Λευκό ματ',
  },
  draft: { meters: '4,6' },
  costCents: 50000,
});

test('a valid quote is cleaned up for storage', () => {
  const result = validateQuote(quote());
  assert.equal(result.status, 'sent');
  assert.deepEqual(result.customer, { name: 'Μαρία Παπαδάκη', phone: '690', address: '' });
  assert.equal(result.doc.date, '2026-10-06T10:00:00.000Z');
  assert.equal(result.doc.lines[0].name, 'Βασική κουζίνα');
  assert.equal(result.draftJson, '{"meters":"4,6"}');
  assert.equal(result.costCents, 50000);

  const noStatus = quote();
  delete noStatus.status;
  assert.equal(validateQuote(noStatus).status, undefined, 'left to the caller: new or unchanged');
});

test('a bad quote reports every problem', () => {
  const body = quote();
  body.status = 'won';
  body.customer.name = 'x'.repeat(101);
  body.doc.lines.push({ kind: 'extra', name: '', qty: -1, unitCents: 1.5 });
  body.doc.vatRate = 101;
  body.doc.validityDays = 400;
  body.costCents = -1;
  delete body.draft;
  const errors = errorsFor(body, validateQuote);
  assert.equal(errors.length, 9);
  assert.ok(errors.includes('Γραμμή 2: μη έγκυρη περιγραφή.'));

  const tooManyLines = quote();
  tooManyLines.doc.lines = Array.from({ length: 101 }, () => quote().doc.lines[0]);
  assert.deepEqual(errorsFor(tooManyLines, validateQuote), ['Μη έγκυρες γραμμές προσφοράς.']);

  const hugeDraft = quote();
  hugeDraft.draft = { notes: 'x'.repeat(40_000) };
  assert.deepEqual(errorsFor(hugeDraft, validateQuote), ['Η προσφορά είναι πολύ μεγάλη.']);
});

test('only known quote statuses are accepted', () => {
  assert.equal(validateStatus({ status: 'accepted' }), 'accepted');
  assert.throws(() => validateStatus({ status: 'won' }), ValidationError);
  assert.throws(() => validateStatus(null), ValidationError);
});

test('materials and extras have a unit and a kind of job', () => {
  const body = valid();
  body.materials.push({ name: 'Ανοιγόμενη', price: 400, unit: 'pcs', section: 'door', active: true });
  body.extras[0].unit = 'm';
  body.extras[0].section = 'wardrobe';
  body.costs[0].unit = 'm'; // cost lines are plain amounts
  body.costs[0].section = 'door';
  const config = validateConfig(body);
  assert.deepEqual(config.materials.map((m) => [m.unit, m.section]), [['m', 'kitchen'], ['pcs', 'door']]);
  assert.deepEqual([config.extras[0].unit, config.extras[0].section], ['m', 'wardrobe']);
  assert.deepEqual([config.extras[1].unit, config.extras[1].section], ['pcs', 'kitchen']);
  assert.deepEqual([config.costs[0].unit, config.costs[0].section], ['pcs', 'kitchen']);

  const bad = valid();
  bad.materials[0].unit = 'ft';
  bad.extras[0].section = 'garage';
  assert.deepEqual(errorsFor(bad), [
    'Υλικά #1 (Μελαμίνη): μη έγκυρη μονάδα τιμής.',
    'Extras #1 (Magic Corner): μη έγκυρο είδος εργασίας.',
  ]);
});
