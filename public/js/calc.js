// Parsing, money maths and formatting. No DOM access, so the same module runs
// in the browser and in the Node tests. Money is handled in integer cents.

const LOCALE = 'el-GR';
const euroWhole = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const plainDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, useGrouping: false });
const percent = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 });
const longDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

// Accepts what people type on a Greek phone keyboard: "4,5", "4.5",
// "1.250" (thousands), "1.250,50", " 320 € ". Blank counts as 0.
// Returns a non-negative number, or null if the text isn't a valid amount.
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  let text = String(raw ?? '').replace(/[\s  €]/g, '');
  if (text === '') return 0;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  return Number(text);
}

// Whole pieces only (0-9999). Blank counts as 0; anything else is null.
export function parseQty(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return 0;
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

export function toCents(euros) {
  return Math.round(euros * 100);
}

const tidy = (text) => text.replace(/[  ]/g, ' ');

// "1.600 €", or "1.984,40 €" when there are cents.
export function formatMoney(cents) {
  return tidy((cents % 100 === 0 ? euroWhole : euroCents).format(cents / 100));
}

export function formatNumber(value) {
  return decimal.format(value);
}

// For prefilling inputs: "450,5", never "1.250".
export function formatInput(value) {
  return plainDecimal.format(value);
}

export function formatPercent(ratio) {
  return tidy(percent.format(ratio));
}

export function formatDate(date) {
  return longDate.format(date);
}

export function emptyDraft() {
  return {
    meters: '',
    materialId: null,
    pricePerMeter: null,
    extras: {},
    other: '',
    otherLabel: '',
    discount: '',
    discountMode: 'percent', // or 'amount'
    customer: { name: '', phone: '', address: '' },
    notes: '',
    costs: {},
    quoteRef: null, // { id, number } once saved to the archive
  };
}

// The whole quote, derived from the admin config plus what's typed in the
// form (the "draft", which keeps raw input strings). Invalid inputs count as 0;
// the UI flags them separately.
export function computeQuote(config, draft) {
  const material = config.materials.find((m) => m.id === draft.materialId) ?? config.materials[0] ?? null;

  const meters = parseAmount(draft.meters) ?? 0;
  const pricePerMeter =
    draft.pricePerMeter == null ? material?.price ?? 0 : parseAmount(draft.pricePerMeter) ?? 0;
  const pricePerMeterCents = toCents(pricePerMeter);
  const baseCents = Math.round(meters * pricePerMeterCents);

  const extras = config.extras.map((extra) => {
    const entry = draft.extras[extra.id] ?? {};
    const qty = parseQty(entry.qty) ?? 0;
    const unitPrice = entry.price == null ? extra.price : parseAmount(entry.price) ?? 0;
    const unitCents = toCents(unitPrice);
    return { id: extra.id, name: extra.name, icon: extra.icon, qty, unitCents, totalCents: qty * unitCents };
  });
  const otherCents = toCents(parseAmount(draft.other) ?? 0);
  const pickedCents = extras.reduce((sum, extra) => sum + extra.totalCents, 0);
  const extrasCents = pickedCents + otherCents;

  const subtotalCents = baseCents + extrasCents;
  const discountValue = parseAmount(draft.discount ?? '') ?? 0;
  const discountCents =
    draft.discountMode === 'amount'
      ? Math.min(subtotalCents, toCents(discountValue))
      : Math.round((subtotalCents * Math.min(discountValue, 100)) / 100);

  const settings = config.settings;
  const totals = docTotals({
    subtotalCents,
    discountCents,
    vatRate: settings.vatRate ?? 0,
    depositPercent: settings.depositPercent ?? 0,
  });

  const costs = config.costs.map((cost) => {
    const raw = draft.costs[cost.id];
    const amount = raw == null ? cost.price : parseAmount(raw) ?? 0;
    return { id: cost.id, name: cost.name, icon: cost.icon, cents: toCents(amount) };
  });
  const costCents = costs.reduce((sum, cost) => sum + cost.cents, 0);
  const profitCents = totals.netCents - costCents;

  return {
    material,
    meters,
    pricePerMeterCents,
    baseCents,
    extras,
    pickedCents,
    otherCents,
    extrasCents,
    discountMode: draft.discountMode === 'amount' ? 'amount' : 'percent',
    discountValue,
    ...totals,
    vatRate: settings.vatRate ?? 0,
    depositPercent: settings.depositPercent ?? 0,
    costs,
    costCents,
    profitCents,
    margin: totals.netCents > 0 ? profitCents / totals.netCents : null,
  };
}

// Totals from a subtotal (or from quote lines). Shared with the Worker, which
// recomputes saved quotes so stored totals always add up.
export function docTotals({ lines, subtotalCents, discountCents = 0, vatRate = 0, depositPercent = 0 }) {
  const subtotal = subtotalCents ?? lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discount = Math.min(Math.max(0, discountCents), subtotal);
  const netCents = subtotal - discount;
  const vatCents = Math.round((netCents * vatRate) / 100);
  const grossCents = netCents + vatCents;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    netCents,
    vatCents,
    grossCents,
    depositCents: Math.round((grossCents * depositPercent) / 100),
  };
}

export function lineTotal(line) {
  return Math.round(line.qty * line.unitCents);
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// The customer-facing quote: what the PDF, the shared text and the archive
// show. Never contains internal costs.
export function buildQuoteDoc(quote, draft, { date = new Date(), validityDays = 0 } = {}) {
  const lines = [];
  if (quote.baseCents > 0) {
    lines.push({
      kind: 'base',
      name: 'Βασική κουζίνα',
      detail: quote.material?.name ?? '',
      qty: quote.meters,
      unit: 'μ.',
      unitCents: quote.pricePerMeterCents,
      totalCents: quote.baseCents,
    });
  }
  for (const extra of quote.extras) {
    if (extra.qty > 0) {
      lines.push({
        kind: 'extra',
        name: extra.name,
        detail: '',
        qty: extra.qty,
        unit: 'τεμ.',
        unitCents: extra.unitCents,
        totalCents: extra.totalCents,
      });
    }
  }
  if (quote.otherCents > 0) {
    lines.push({
      kind: 'other',
      name: draft.otherLabel?.trim() || 'Άλλο extra',
      detail: '',
      qty: 1,
      unit: '',
      unitCents: quote.otherCents,
      totalCents: quote.otherCents,
    });
  }

  const customer = draft.customer ?? {};
  return {
    v: 1,
    number: draft.quoteRef?.number ?? null,
    date: date.toISOString(),
    validityDays,
    customer: {
      name: (customer.name ?? '').trim(),
      phone: (customer.phone ?? '').trim(),
      address: (customer.address ?? '').trim(),
    },
    lines,
    discountLabel: quote.discountCents > 0 && quote.discountMode === 'percent' ? `${formatNumber(quote.discountValue)}%` : '',
    discountCents: quote.discountCents,
    vatRate: quote.vatRate,
    depositPercent: quote.depositPercent,
    notes: (draft.notes ?? '').trim(),
    ...docTotals({ lines, discountCents: quote.discountCents, vatRate: quote.vatRate, depositPercent: quote.depositPercent }),
  };
}

function lineText(line) {
  if (line.kind === 'base') {
    const material = line.detail ? ` (${line.detail})` : '';
    return `${line.name}${material}: ${formatNumber(line.qty)} μ. × ${formatMoney(line.unitCents)} = ${formatMoney(line.totalCents)}`;
  }
  if (line.kind === 'other') return `• ${line.name}: ${formatMoney(line.totalCents)}`;
  return `• ${line.name}: ${line.qty} × ${formatMoney(line.unitCents)} = ${formatMoney(line.totalCents)}`;
}

// Plain-text quote for Viber / Messenger / email. Never includes internal costs.
export function buildShareText(doc, { businessName }) {
  const date = new Date(doc.date);
  const title = doc.number ? `Προσφορά ${doc.number}` : 'Προσφορά κουζίνας';
  const out = [`${businessName} · ${title}`, formatDate(date)];
  if (doc.customer.name) out.push(`Προς: ${doc.customer.name}`);
  out.push('');
  for (const line of doc.lines) out.push(lineText(line));

  out.push('');
  if (doc.discountCents > 0) {
    out.push(`Υποσύνολο: ${formatMoney(doc.subtotalCents)}`);
    out.push(`Έκπτωση${doc.discountLabel ? ` ${doc.discountLabel}` : ''}: -${formatMoney(doc.discountCents)}`);
  }
  out.push(`Σύνολο χωρίς ΦΠΑ: ${formatMoney(doc.netCents)}`);
  if (doc.vatRate > 0) {
    out.push(`ΦΠΑ ${formatNumber(doc.vatRate)}%: ${formatMoney(doc.vatCents)}`);
    out.push(`Σύνολο με ΦΠΑ: ${formatMoney(doc.grossCents)}`);
  }
  if (doc.depositCents > 0) {
    out.push(`Προκαταβολή ${formatNumber(doc.depositPercent)}%: ${formatMoney(doc.depositCents)}`);
  }
  if (doc.validityDays > 0) out.push('', `Ισχύει έως ${formatDate(addDays(date, doc.validityDays))}.`);
  if (doc.notes) out.push('', doc.notes);
  return out.join('\n');
}
