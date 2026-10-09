import { HttpError } from './http.js';

const DEFAULT_SETTINGS = {
  business_name: 'Velokas Woodworks',
  subtitle: '',
  vat_rate: '24',
  business_phone: '',
  business_email: '',
  business_address: '',
  business_vat_id: '',
  quote_terms: '',
  quote_validity_days: '30',
  deposit_percent: '0',
  config_version: '0',
};

// API field -> settings table key.
const SETTING_KEYS = {
  businessName: 'business_name',
  subtitle: 'subtitle',
  vatRate: 'vat_rate',
  phone: 'business_phone',
  email: 'business_email',
  address: 'business_address',
  vatId: 'business_vat_id',
  terms: 'quote_terms',
  validityDays: 'quote_validity_days',
  depositPercent: 'deposit_percent',
};
const NUMERIC_SETTINGS = new Set(['vatRate', 'validityDays', 'depositPercent']);

const LIST_BY_KIND = { material: 'materials', extra: 'extras', cost: 'costs' };
const UNITS = new Set(['m', 'm2', 'pcs']);
const SECTIONS = new Set(['kitchen', 'wardrobe', 'door']);

// Reads everything the calculator needs. Admins also get inactive items.
export async function readConfig(db, { includeInactive = false } = {}) {
  const [settingsResult, itemsResult] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    // SELECT *: reads keep working while a deploy waits for a new column.
    db.prepare(
      `SELECT *
         FROM items
        ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY kind, sort_order, id`,
    ),
  ]);

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of settingsResult.results) settings[row.key] = row.value;

  const config = {
    version: Number(settings.config_version) || 0,
    settings: Object.fromEntries(
      Object.entries(SETTING_KEYS).map(([field, key]) => [
        field,
        NUMERIC_SETTINGS.has(field) ? Number(settings[key]) || 0 : settings[key],
      ]),
    ),
    materials: [],
    extras: [],
    costs: [],
  };

  for (const row of itemsResult.results) {
    const list = config[LIST_BY_KIND[row.kind]];
    if (!list) continue;
    const item = { id: row.id, name: row.name, price: row.price_cents / 100, icon: row.icon };
    // Materials and extras: how they're priced ('m', 'm2', 'pcs') and which
    // kind of job they're for. Rows from before these columns fall back.
    if (row.kind !== 'cost') {
      item.unit = UNITS.has(row.unit) ? row.unit : row.kind === 'material' ? 'm' : 'pcs';
      item.section = SECTIONS.has(row.section) ? row.section : 'kitchen';
    }
    if (includeInactive) item.active = row.active === 1;
    list.push(item);
  }
  return config;
}

// Replaces the whole configuration in one transaction (D1 batches are atomic).
// Existing items keep their ids; new ones get fresh ids.
export async function writeConfig(db, config) {
  const current = await db
    .prepare("SELECT value FROM settings WHERE key = 'config_version'")
    .first('value');
  if (Number(current ?? 0) !== config.version) {
    throw new HttpError(409, 'Οι ρυθμίσεις άλλαξαν από άλλη συσκευή. Ανανέωσε για να δεις τις τελευταίες.');
  }

  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const insertItem = db.prepare(
    'INSERT INTO items (id, kind, name, price_cents, icon, sort_order, active, unit, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  const statements = [];
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    const value = config.settings[field];
    if (value !== undefined) statements.push(upsertSetting.bind(key, String(value)));
  }
  statements.push(
    upsertSetting.bind('config_version', String(config.version + 1)),
    db.prepare('DELETE FROM items'),
  );

  for (const [kind, key] of Object.entries(LIST_BY_KIND)) {
    config[key].forEach((item, index) => {
      statements.push(
        insertItem.bind(item.id, kind, item.name, item.priceCents, item.icon, index, item.active ? 1 : 0, item.unit, item.section),
      );
    });
  }

  await db.batch(statements);
}
