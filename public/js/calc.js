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
  return { meters: '', materialId: null, pricePerMeter: null, extras: {}, other: '', costs: {} };
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

  const netCents = baseCents + extrasCents;
  const vatRate = config.settings.vatRate ?? 0;
  const vatCents = Math.round((netCents * vatRate) / 100);

  const costs = config.costs.map((cost) => {
    const raw = draft.costs[cost.id];
    const amount = raw == null ? cost.price : parseAmount(raw) ?? 0;
    return { id: cost.id, name: cost.name, icon: cost.icon, cents: toCents(amount) };
  });
  const costCents = costs.reduce((sum, cost) => sum + cost.cents, 0);
  const profitCents = netCents - costCents;

  return {
    material,
    meters,
    pricePerMeterCents,
    baseCents,
    extras,
    pickedCents,
    otherCents,
    extrasCents,
    netCents,
    vatRate,
    vatCents,
    grossCents: netCents + vatCents,
    costs,
    costCents,
    profitCents,
    margin: netCents > 0 ? profitCents / netCents : null,
  };
}

// Plain-text quote for Viber / Messenger / email. Never includes internal costs.
export function buildShareText(quote, { businessName, date = new Date() }) {
  const lines = [`${businessName} · Προσφορά κουζίνας`, formatDate(date), ''];
  if (quote.baseCents > 0) {
    const material = quote.material ? ` (${quote.material.name})` : '';
    lines.push(
      `Βασική κουζίνα${material}: ${formatNumber(quote.meters)} μ. × ${formatMoney(quote.pricePerMeterCents)} = ${formatMoney(quote.baseCents)}`,
    );
  }
  for (const extra of quote.extras) {
    if (extra.qty > 0) {
      lines.push(`• ${extra.name}: ${extra.qty} × ${formatMoney(extra.unitCents)} = ${formatMoney(extra.totalCents)}`);
    }
  }
  if (quote.otherCents > 0) lines.push(`• Άλλο extra: ${formatMoney(quote.otherCents)}`);

  lines.push('', `Σύνολο χωρίς ΦΠΑ: ${formatMoney(quote.netCents)}`);
  if (quote.vatRate > 0) {
    lines.push(`ΦΠΑ ${formatNumber(quote.vatRate)}%: ${formatMoney(quote.vatCents)}`);
    lines.push(`Σύνολο με ΦΠΑ: ${formatMoney(quote.grossCents)}`);
  }
  return lines.join('\n');
}
