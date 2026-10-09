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

// The kinds of job a quote can cover; a quote has one or more of them.
export const SECTIONS = {
  kitchen: {
    label: 'Κουζίνα',
    of: 'κουζίνας',
    icon: 'chef-hat',
    pick: 'Υλικό',
    materialsTitle: 'Υλικά κουζίνας',
    extrasTitle: 'Extras κουζίνας',
  },
  wardrobe: {
    label: 'Ντουλάπα',
    of: 'ντουλάπας',
    icon: 'shirt',
    pick: 'Τύπος ντουλάπας',
    materialsTitle: 'Τύποι ντουλάπας',
    extrasTitle: 'Extras ντουλάπας',
  },
  door: {
    label: 'Πόρτα',
    of: 'πόρτας',
    icon: 'door-open',
    pick: 'Τύπος πόρτας',
    materialsTitle: 'Τύποι πόρτας',
    extrasTitle: 'Extras πόρτας',
  },
};
export const SECTION_KEYS = Object.keys(SECTIONS);

// Items saved before job types existed belong to the kitchen.
export function sectionOf(item) {
  return Object.hasOwn(SECTIONS, item?.section ?? '') ? item.section : 'kitchen';
}

// How an item is priced: per metre, per square metre or per piece.
export const UNITS = {
  m: { short: 'μ.', quantity: 'Μέτρα', price: 'Τιμή / μέτρο', example: 'π.χ. 5', per: 'Ανά μέτρο' },
  m2: { short: 'τ.μ.', quantity: 'Τετραγωνικά', price: 'Τιμή / τ.μ.', example: 'π.χ. 12', per: 'Ανά τ.μ.' },
  pcs: { short: 'τεμ.', quantity: 'Τεμάχια', price: 'Τιμή / τεμάχιο', example: 'π.χ. 2', per: 'Ανά τεμ.' },
};

// Materials are per metre unless set otherwise; extras per piece.
export function materialUnit(material) {
  return UNITS[material?.unit] ?? UNITS.m;
}
export function extraUnit(extra) {
  return UNITS[extra?.unit] ?? UNITS.pcs;
}

// «Προσφορά κουζίνας», «Προσφορά κουζίνας και ντουλάπας», …
export function jobSubject(keys) {
  const names = SECTION_KEYS.filter((key) => keys.includes(key)).map((key) => SECTIONS[key].of);
  if (!names.length) return 'Προσφορά';
  return `Προσφορά ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} και ${names.at(-1)}`}`;
}

const emptyJob = () => ({ materialId: null, qty: '', price: null });

export function emptyDraft() {
  return {
    sections: ['kitchen'], // the jobs this quote covers, in SECTION_KEYS order
    combo: false, // chosen through «Συνδυασμός»
    // Per job: the material, how much of it (in its unit) and a price that
    // overrides the catalogue one (null = catalogue price).
    jobs: { kitchen: emptyJob(), wardrobe: emptyJob(), door: emptyJob() },
    extras: {}, // by extra id: { qty, price }
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

const plainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

// Fills in what older drafts lack, so drafts and saved quotes from earlier
// versions still open. Before job types a draft was a single kitchen:
// { meters, materialId, pricePerMeter }.
export function normaliseDraft(input) {
  const raw = plainObject(input);
  const draft = { ...emptyDraft(), ...raw };
  draft.extras = plainObject(raw.extras);
  draft.costs = plainObject(raw.costs);
  draft.customer = { ...emptyDraft().customer, ...plainObject(raw.customer) };
  if (draft.discountMode !== 'amount') draft.discountMode = 'percent';

  const jobs = plainObject(raw.jobs);
  draft.jobs = Object.fromEntries(SECTION_KEYS.map((key) => [key, { ...emptyJob(), ...plainObject(jobs[key]) }]));
  if (!raw.jobs && ('meters' in raw || 'materialId' in raw || 'pricePerMeter' in raw)) {
    draft.jobs.kitchen = { materialId: raw.materialId ?? null, qty: raw.meters ?? '', price: raw.pricePerMeter ?? null };
  }
  delete draft.meters;
  delete draft.materialId;
  delete draft.pricePerMeter;

  const picked = Array.isArray(raw.sections) ? SECTION_KEYS.filter((key) => raw.sections.includes(key)) : [];
  draft.sections = picked.length ? picked : ['kitchen'];
  draft.combo = raw.combo === true;
  return draft;
}

// One job of the quote: its material line and its extras.
function computeSection(config, draft, key) {
  const job = draft.jobs[key];
  const materials = config.materials.filter((m) => sectionOf(m) === key);
  const material = materials.find((m) => m.id === job.materialId) ?? materials[0] ?? null;
  const qty = parseAmount(job.qty) ?? 0;
  const priceCents = toCents(job.price == null ? material?.price ?? 0 : parseAmount(job.price) ?? 0);
  const baseCents = Math.round(qty * priceCents);

  const extras = config.extras
    .filter((extra) => sectionOf(extra) === key)
    .map((extra) => {
      const entry = draft.extras[extra.id] ?? {};
      const unit = extraUnit(extra);
      // Pieces are whole numbers; metres of LED strip can be 3,5.
      const count = (unit === UNITS.pcs ? parseQty(entry.qty) : parseAmount(entry.qty ?? '')) ?? 0;
      const unitCents = toCents(entry.price == null ? extra.price : parseAmount(entry.price) ?? 0);
      return { id: extra.id, name: extra.name, icon: extra.icon, unit, qty: count, unitCents, totalCents: Math.round(count * unitCents) };
    });
  const extrasCents = extras.reduce((sum, extra) => sum + extra.totalCents, 0);

  return {
    key,
    ...SECTIONS[key],
    material,
    materials,
    unit: materialUnit(material),
    qty, // in the material's unit
    priceCents,
    baseCents,
    extras,
    extrasCents,
    totalCents: baseCents + extrasCents,
  };
}

// The whole quote, derived from the admin config plus what's typed in the
// form (the "draft", which keeps raw input strings). Invalid inputs count as 0;
// the UI flags them separately.
export function computeQuote(config, input) {
  const draft = normaliseDraft(input);
  const sections = draft.sections.map((key) => computeSection(config, draft, key));
  const baseCents = sections.reduce((sum, section) => sum + section.baseCents, 0);
  const pickedCents = sections.reduce((sum, section) => sum + section.extrasCents, 0);
  const otherCents = toCents(parseAmount(draft.other) ?? 0);
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
    sections,
    baseCents,
    extras: sections.flatMap((section) => section.extras),
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
  // In a quote for several jobs each extra says which job it belongs to.
  const several = quote.sections.length > 1;
  for (const section of quote.sections) {
    if (section.baseCents > 0) {
      lines.push({
        kind: 'base',
        name: section.label,
        detail: section.material?.name ?? '',
        qty: section.qty,
        unit: section.unit.short,
        unitCents: section.priceCents,
        totalCents: section.baseCents,
      });
    }
    for (const extra of section.extras) {
      if (extra.qty > 0) {
        lines.push({
          kind: 'extra',
          name: extra.name,
          detail: several ? section.label : '',
          qty: extra.qty,
          unit: extra.unit.short,
          unitCents: extra.unitCents,
          totalCents: extra.totalCents,
        });
      }
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
    subject: jobSubject(quote.sections.map((section) => section.key)),
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
  const detail = line.detail ? ` (${line.detail})` : '';
  if (line.kind === 'base') {
    return `${line.name}${detail}: ${formatNumber(line.qty)} ${line.unit || 'μ.'} × ${formatMoney(line.unitCents)} = ${formatMoney(line.totalCents)}`;
  }
  if (line.kind === 'other') return `• ${line.name}: ${formatMoney(line.totalCents)}`;
  // Pieces read "2 × 45 €"; metres "3,5 μ. × 18 €".
  const qty = line.unit && line.unit !== 'τεμ.' ? `${formatNumber(line.qty)} ${line.unit}` : formatNumber(line.qty);
  return `• ${line.name}${detail}: ${qty} × ${formatMoney(line.unitCents)} = ${formatMoney(line.totalCents)}`;
}

// Plain-text quote for Viber / Messenger / email. Never includes internal costs.
export function buildShareText(doc, { businessName }) {
  const date = new Date(doc.date);
  const title = doc.number ? `Προσφορά ${doc.number}` : doc.subject || 'Προσφορά κουζίνας';
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
