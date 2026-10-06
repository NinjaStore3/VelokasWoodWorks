// Validation for the admin "save settings" payload. Pure functions, so they
// can be unit-tested in Node without the Workers runtime.

export const LIMITS = {
  material: 50,
  extra: 60,
  cost: 30,
  nameLength: 60,
  businessNameLength: 80,
  subtitleLength: 160,
  phoneLength: 40,
  emailLength: 120,
  addressLength: 160,
  vatIdLength: 20,
  termsLength: 2000,
  maxValidityDays: 365,
  maxPrice: 1_000_000, // euros
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ICON_RE = /^[a-z0-9-]{1,40}$/;

const LIST_LABELS = {
  materials: 'Υλικά',
  extras: 'Extras',
  costs: 'Εσωτερικά κόστη',
};

export class ValidationError extends Error {
  constructor(errors) {
    super(errors[0]);
    this.errors = errors;
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// Like cleanText but keeps line breaks (at most one empty line in a row).
export function cleanMultiline(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Optional text setting: undefined means "leave as it is" (older clients).
function optionalText(input, key, label, max, errors, clean = cleanText) {
  if (input[key] === undefined) return undefined;
  const value = clean(input[key]);
  if (value.length > max) errors.push(`${label}: έως ${max} χαρακτήρες.`);
  return value;
}

// Euros (number) -> integer cents, or null if not a valid price.
export function toCents(value, max = LIMITS.maxPrice) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return Math.round(value * 100);
}

function validateItems(key, input, max, errors) {
  const label = LIST_LABELS[key];
  if (!Array.isArray(input)) {
    errors.push(`${label}: λείπει η λίστα.`);
    return [];
  }
  if (input.length > max) {
    errors.push(`${label}: έως ${max} εγγραφές.`);
    return [];
  }

  return input.map((raw, index) => {
    const where = `${label} #${index + 1}`;
    const item = raw && typeof raw === 'object' ? raw : {};

    const name = cleanText(item.name);
    if (!name) errors.push(`${where}: το όνομα είναι υποχρεωτικό.`);
    else if (name.length > LIMITS.nameLength) errors.push(`${where}: όνομα έως ${LIMITS.nameLength} χαρακτήρες.`);

    const priceCents = toCents(item.price);
    if (priceCents === null) errors.push(`${where} (${name || 'χωρίς όνομα'}): μη έγκυρη τιμή.`);

    let id = null;
    if (item.id !== undefined && item.id !== null) {
      if (Number.isSafeInteger(item.id) && item.id > 0) id = item.id;
      else errors.push(`${where}: μη έγκυρο id.`);
    }

    let icon = '';
    if (item.icon !== undefined && item.icon !== null && item.icon !== '') {
      if (typeof item.icon === 'string' && ICON_RE.test(item.icon)) icon = item.icon;
      else errors.push(`${where}: μη έγκυρο εικονίδιο.`);
    }

    return { id, name, priceCents: priceCents ?? 0, icon, active: item.active !== false };
  });
}

// Returns the normalised config ready for writing, or throws ValidationError
// with every problem found (in Greek, shown as-is in the Settings tab).
export function validateConfig(body) {
  const errors = [];
  const input = body && typeof body === 'object' ? body : {};
  const settingsIn = input.settings && typeof input.settings === 'object' ? input.settings : {};

  if (!Number.isSafeInteger(input.version)) errors.push('Λείπει η έκδοση ρυθμίσεων. Ανανέωσε τη σελίδα.');

  const businessName = cleanText(settingsIn.businessName);
  if (!businessName) errors.push('Η επωνυμία είναι υποχρεωτική.');
  else if (businessName.length > LIMITS.businessNameLength) errors.push(`Επωνυμία έως ${LIMITS.businessNameLength} χαρακτήρες.`);

  const subtitle = cleanText(settingsIn.subtitle);
  if (subtitle.length > LIMITS.subtitleLength) errors.push(`Υπότιτλος έως ${LIMITS.subtitleLength} χαρακτήρες.`);

  const vat = settingsIn.vatRate;
  const vatValid = typeof vat === 'number' && Number.isFinite(vat) && vat >= 0 && vat <= 100;
  if (!vatValid) errors.push('Ο ΦΠΑ πρέπει να είναι από 0 έως 100%.');

  const phone = optionalText(settingsIn, 'phone', 'Τηλέφωνο', LIMITS.phoneLength, errors);
  const email = optionalText(settingsIn, 'email', 'Email', LIMITS.emailLength, errors);
  if (email && !EMAIL_RE.test(email)) errors.push('Το email δεν φαίνεται σωστό.');
  const address = optionalText(settingsIn, 'address', 'Διεύθυνση', LIMITS.addressLength, errors);
  const vatId = optionalText(settingsIn, 'vatId', 'ΑΦΜ', LIMITS.vatIdLength, errors);
  const terms = optionalText(settingsIn, 'terms', 'Όροι προσφοράς', LIMITS.termsLength, errors, cleanMultiline);

  let validityDays;
  if (settingsIn.validityDays !== undefined) {
    validityDays = settingsIn.validityDays;
    if (!Number.isInteger(validityDays) || validityDays < 0 || validityDays > LIMITS.maxValidityDays) {
      errors.push(`Η ισχύς της προσφοράς πρέπει να είναι από 0 έως ${LIMITS.maxValidityDays} ημέρες.`);
    }
  }

  let depositPercent;
  if (settingsIn.depositPercent !== undefined) {
    depositPercent = settingsIn.depositPercent;
    if (typeof depositPercent !== 'number' || !Number.isFinite(depositPercent) || depositPercent < 0 || depositPercent > 100) {
      errors.push('Η προκαταβολή πρέπει να είναι από 0 έως 100%.');
    }
  }

  const materials = validateItems('materials', input.materials, LIMITS.material, errors);
  const extras = validateItems('extras', input.extras, LIMITS.extra, errors);
  const costs = validateItems('costs', input.costs, LIMITS.cost, errors);

  if (Array.isArray(input.materials) && !materials.some((m) => m.active)) {
    errors.push('Χρειάζεται τουλάχιστον ένα ενεργό υλικό.');
  }

  const seen = new Set();
  for (const item of [...materials, ...extras, ...costs]) {
    if (item.id === null) continue;
    if (seen.has(item.id)) {
      errors.push('Διπλότυπες εγγραφές. Ανανέωσε τη σελίδα και ξαναδοκίμασε.');
      break;
    }
    seen.add(item.id);
  }

  if (errors.length) throw new ValidationError(errors);

  return {
    version: input.version,
    settings: {
      businessName,
      subtitle,
      vatRate: Math.round(vat * 100) / 100,
      phone,
      email,
      address,
      vatId,
      terms,
      validityDays,
      depositPercent: depositPercent === undefined ? undefined : Math.round(depositPercent * 100) / 100,
    },
    materials,
    extras,
    costs,
  };
}

// ---------- Saved quotes ----------

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];
const LINE_KINDS = new Set(['base', 'extra', 'other']);
const MAX_QUOTE_LINES = 100;
const MAX_DRAFT_CHARS = 30_000;
const MAX_CENTS = 100_000_000_000;

const isCents = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
const isPercent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

function validateLines(input, errors) {
  if (!Array.isArray(input) || input.length > MAX_QUOTE_LINES) {
    errors.push('Μη έγκυρες γραμμές προσφοράς.');
    return [];
  }
  return input.map((raw, index) => {
    const line = raw && typeof raw === 'object' ? raw : {};
    const where = `Γραμμή ${index + 1}`;
    const name = cleanText(line.name);
    if (!name || name.length > 120) errors.push(`${where}: μη έγκυρη περιγραφή.`);
    const qty = line.qty;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0 || qty > 100_000) errors.push(`${where}: μη έγκυρη ποσότητα.`);
    if (!isCents(line.unitCents)) errors.push(`${where}: μη έγκυρη τιμή.`);
    return {
      kind: LINE_KINDS.has(line.kind) ? line.kind : 'extra',
      name,
      detail: cleanText(line.detail).slice(0, 200),
      qty: Number.isFinite(qty) ? qty : 0,
      unit: cleanText(line.unit).slice(0, 10),
      unitCents: isCents(line.unitCents) ? line.unitCents : 0,
    };
  });
}

// Body of POST/PUT /api/admin/quotes. Returns the normalised quote; totals are
// left for the caller to recompute from the lines.
export function validateQuote(body) {
  const errors = [];
  const input = body && typeof body === 'object' ? body : {};
  const docIn = input.doc && typeof input.doc === 'object' ? input.doc : {};
  const customerIn = input.customer && typeof input.customer === 'object' ? input.customer : {};

  // Missing status: 'draft' for a new quote, unchanged on update.
  const status = input.status;
  if (status !== undefined && !QUOTE_STATUSES.includes(status)) errors.push('Μη έγκυρη κατάσταση προσφοράς.');

  const customer = {
    name: cleanText(customerIn.name),
    phone: cleanText(customerIn.phone),
    address: cleanText(customerIn.address),
  };
  if (customer.name.length > 100) errors.push('Όνομα πελάτη: έως 100 χαρακτήρες.');
  if (customer.phone.length > 40) errors.push('Τηλέφωνο πελάτη: έως 40 χαρακτήρες.');
  if (customer.address.length > 160) errors.push('Διεύθυνση πελάτη: έως 160 χαρακτήρες.');

  const lines = validateLines(docIn.lines, errors);
  if (!isCents(docIn.discountCents ?? 0)) errors.push('Μη έγκυρη έκπτωση.');
  if (!isPercent(docIn.vatRate ?? 0)) errors.push('Μη έγκυρος ΦΠΑ.');
  if (!isPercent(docIn.depositPercent ?? 0)) errors.push('Μη έγκυρη προκαταβολή.');
  const validityDays = docIn.validityDays ?? 0;
  if (!Number.isInteger(validityDays) || validityDays < 0 || validityDays > LIMITS.maxValidityDays) {
    errors.push('Μη έγκυρη ισχύς προσφοράς.');
  }
  const date = typeof docIn.date === 'string' && !Number.isNaN(Date.parse(docIn.date)) ? new Date(docIn.date).toISOString() : null;
  const notes = cleanMultiline(docIn.notes);
  if (notes.length > LIMITS.termsLength) errors.push(`Σημειώσεις: έως ${LIMITS.termsLength} χαρακτήρες.`);

  const costCents = input.costCents ?? 0;
  if (!isCents(costCents)) errors.push('Μη έγκυρο εσωτερικό κόστος.');

  const draft = input.draft && typeof input.draft === 'object' && !Array.isArray(input.draft) ? input.draft : null;
  const draftJson = draft ? JSON.stringify(draft) : '';
  if (!draft) errors.push('Λείπει η κατάσταση της φόρμας.');
  else if (draftJson.length > MAX_DRAFT_CHARS) errors.push('Η προσφορά είναι πολύ μεγάλη.');

  if (errors.length) throw new ValidationError(errors);

  return {
    status,
    customer,
    doc: {
      v: 1,
      date,
      validityDays,
      customer,
      lines,
      discountLabel: cleanText(docIn.discountLabel).slice(0, 20),
      discountCents: docIn.discountCents ?? 0,
      vatRate: docIn.vatRate ?? 0,
      depositPercent: docIn.depositPercent ?? 0,
      notes,
    },
    draftJson,
    costCents,
  };
}

export function validateStatus(body) {
  const status = body?.status;
  if (!QUOTE_STATUSES.includes(status)) throw new ValidationError(['Μη έγκυρη κατάσταση προσφοράς.']);
  return status;
}
