import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, ValidationError, validateConfig } from '../src/validate.js';

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

function errorsFor(body) {
  try {
    validateConfig(body);
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
  assert.deepEqual(config.materials, [{ id: 1, name: 'Μελαμίνη', priceCents: 32000, icon: '', active: true }]);
  assert.deepEqual(config.extras[0], { id: 2, name: 'Magic Corner', priceCents: 19550, icon: 'square-round-corner', active: true });
  assert.deepEqual(config.extras[1], { id: null, name: 'Νέο extra', priceCents: 1000, icon: '', active: true });
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
