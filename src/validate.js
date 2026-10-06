// Validation for the admin "save settings" payload. Pure functions, so they
// can be unit-tested in Node without the Workers runtime.

export const LIMITS = {
  material: 50,
  extra: 60,
  cost: 30,
  nameLength: 60,
  businessNameLength: 80,
  subtitleLength: 160,
  maxPrice: 1_000_000, // euros
};

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
    settings: { businessName, subtitle, vatRate: Math.round(vat * 100) / 100 },
    materials,
    extras,
    costs,
  };
}
