import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactMoney, fold, matches, yearStats } from '../public/js/quotes.js';

const quote = (number, status, netCents, customer = {}) => ({
  number,
  status,
  netCents,
  customer: { name: '', phone: '', address: '', ...customer },
});

test('search ignores accents, case and final sigma', () => {
  assert.equal(fold('Παπαδάκης ΚΑΡΑΓΙΆΝΝΗΣ'), 'παπαδακησ καραγιαννησ');
  const maria = quote('2026-007', 'sent', 100, { name: 'Μαρία Παπαδάκη', phone: '690 123 4567', address: 'Χαλάνδρι' });
  assert.ok(matches(maria, 'παπαδακη'));
  assert.ok(matches(maria, 'ΜΑΡΙΑ χαλανδρι'));
  assert.ok(matches(maria, '6901234567'), 'phone without spaces');
  assert.ok(matches(maria, '2026-007'));
  assert.ok(matches(maria, '  '));
  assert.ok(!matches(maria, 'μαρία κηφισιά'));
});

test('stats count this year only; success is closed out of sent', () => {
  const quotes = [
    quote('2026-001', 'accepted', 150000),
    quote('2026-002', 'accepted', 90000),
    quote('2026-003', 'rejected', 70000),
    quote('2026-004', 'sent', 50000),
    quote('2026-005', 'draft', 40000),
    quote('2025-031', 'accepted', 999999),
  ];
  assert.deepEqual(yearStats(quotes, 2026), { count: 5, wonCents: 240000, winRate: 0.5 });
  assert.deepEqual(yearStats([quote('2026-001', 'draft', 1)], 2026), { count: 1, wonCents: 0, winRate: null });
});

test('stat amounts stay short', () => {
  assert.equal(compactMoney(157230), '1.572 €');
  assert.equal(compactMoney(9_999_949), '99.999 €');
  assert.equal(compactMoney(12_345_600), '123k €');
});
