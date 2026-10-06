import { docTotals, lineTotal } from '../public/js/calc.js';
import { HttpError, json, readJson } from './http.js';
import { validateQuote, validateStatus } from './validate.js';

const MAX_LIST = 500;

export function quoteNumber(year, seq) {
  return `${year}-${String(seq).padStart(3, '0')}`;
}

// Numbering follows the Greek calendar year, not UTC.
function athensYear(date) {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Athens', year: 'numeric' }).format(date));
}

function summary(row) {
  return {
    id: row.id,
    number: quoteNumber(row.year, row.seq),
    status: row.status,
    customer: { name: row.customer_name, phone: row.customer_phone, address: row.customer_address },
    netCents: row.net_cents,
    grossCents: row.gross_cents,
    costCents: row.cost_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fullQuote(row) {
  const quote = summary(row);
  const doc = JSON.parse(row.doc);
  return { ...quote, doc: { ...doc, number: quote.number }, draft: JSON.parse(row.draft) };
}

// Line and quote totals are always recomputed here, so what's stored adds up
// whatever the browser sent.
function prepare(body, now) {
  const quote = validateQuote(body);
  const lines = quote.doc.lines.map((line) => ({ ...line, totalCents: lineTotal(line) }));
  const doc = {
    ...quote.doc,
    date: quote.doc.date ?? new Date(now).toISOString(),
    lines,
    ...docTotals({
      lines,
      discountCents: quote.doc.discountCents,
      vatRate: quote.doc.vatRate,
      depositPercent: quote.doc.depositPercent,
    }),
  };
  return { ...quote, doc };
}

function parseId(id) {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value <= 0) throw new HttpError(404, 'Η προσφορά δεν βρέθηκε.');
  return value;
}

export async function listQuotes(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, year, seq, status, customer_name, customer_phone, customer_address,
            net_cents, gross_cents, cost_cents, created_at, updated_at
       FROM quotes ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(MAX_LIST)
    .all();
  return json({ quotes: results.map(summary) });
}

export async function getQuote(env, id) {
  const row = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(parseId(id)).first();
  if (!row) throw new HttpError(404, 'Η προσφορά δεν βρέθηκε.');
  return json(fullQuote(row));
}

export async function createQuote(request, env) {
  const now = Date.now();
  const quote = prepare(await readJson(request), now);
  const year = athensYear(new Date(quote.doc.date));
  const row = await env.DB.prepare(
    `INSERT INTO quotes (year, seq, status, customer_name, customer_phone, customer_address,
                         net_cents, gross_cents, cost_cents, doc, draft, created_at, updated_at)
     VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM quotes WHERE year = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      year,
      year,
      quote.status ?? 'draft',
      quote.customer.name,
      quote.customer.phone,
      quote.customer.address,
      quote.doc.netCents,
      quote.doc.grossCents,
      quote.costCents,
      JSON.stringify(quote.doc),
      quote.draftJson,
      now,
      now,
    )
    .first();
  return json(fullQuote(row), { status: 201 });
}

export async function updateQuote(request, env, id) {
  const quoteId = parseId(id);
  const quote = prepare(await readJson(request), Date.now());
  const row = await env.DB.prepare(
    `UPDATE quotes
        SET status = COALESCE(?, status), customer_name = ?, customer_phone = ?, customer_address = ?,
            net_cents = ?, gross_cents = ?, cost_cents = ?, doc = ?, draft = ?, updated_at = ?
      WHERE id = ?
     RETURNING *`,
  )
    .bind(
      quote.status ?? null,
      quote.customer.name,
      quote.customer.phone,
      quote.customer.address,
      quote.doc.netCents,
      quote.doc.grossCents,
      quote.costCents,
      JSON.stringify(quote.doc),
      quote.draftJson,
      Date.now(),
      quoteId,
    )
    .first();
  if (!row) throw new HttpError(404, 'Η προσφορά δεν βρέθηκε.');
  return json(fullQuote(row));
}

export async function setQuoteStatus(request, env, id) {
  const status = validateStatus(await readJson(request));
  const row = await env.DB.prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(status, Date.now(), parseId(id))
    .first();
  if (!row) throw new HttpError(404, 'Η προσφορά δεν βρέθηκε.');
  return json(summary(row));
}

export async function deleteQuote(env, id) {
  const result = await env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(parseId(id)).run();
  if (!result.meta.changes) throw new HttpError(404, 'Η προσφορά δεν βρέθηκε.');
  return json({ ok: true });
}
