-- Velokas Woodworks: initial schema.
-- Money is stored as integer euro cents to avoid floating point drift.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Everything the calculator offers, managed from the Settings tab.
--   material: kitchen finish, price_cents = price per metre
--   extra:    add-on with a quantity, price_cents = price per piece
--   cost:     internal cost line, price_cents = default amount (usually 0)
-- AUTOINCREMENT so ids of deleted items are never reused (open drafts in the
-- browser reference items by id).
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('material', 'extra', 'cost')),
  name        TEXT    NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  icon        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX items_kind_order ON items (kind, sort_order);

-- Admin logins. Only a SHA-256 hash of the cookie token is stored.
-- password_tag is a short fingerprint of ADMIN_PASSWORD at login time, so
-- changing the password signs every device out.
CREATE TABLE admin_sessions (
  token_hash   TEXT    PRIMARY KEY,
  password_tag TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL -- unix ms
);

-- Failed admin logins, for throttling password guessing.
CREATE TABLE login_attempts (
  ip           TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL -- unix ms
);
CREATE INDEX login_attempts_ip_time ON login_attempts (ip, attempted_at);

-- Starting values, taken from Panos's mockup.
INSERT INTO settings (key, value) VALUES
  ('business_name', 'Velokas Woodworks'),
  ('subtitle', 'Τιμές χωρίς ΦΠΑ • βάση με τα δικά σου σημερινά δεδομένα'),
  ('vat_rate', '24'),
  ('config_version', '1');

INSERT INTO items (kind, name, price_cents, icon, sort_order) VALUES
  ('material', 'Μελαμίνη',           32000, '',                    0),

  ('extra',    'Magic Corner',       19500, 'square-round-corner', 0),
  ('extra',    'Μπουκαλοθήκη',        8000, 'bottle-wine',         1),
  ('extra',    'Πιατοθήκη',           4000, 'soup',                2),
  ('extra',    'Κουταλοθήκη',         2200, 'utensils',            3),
  ('extra',    'Απλό συρτάρι',        4000, 'panel-bottom',        4),
  ('extra',    'Βαθύ συρτάρι',        5000, 'archive',             5),
  ('extra',    'Βαγονέτο',           10000, 'shelving-unit',       6),
  ('extra',    'Κάδος',               8000, 'recycle',             7),

  ('cost',     'Έτοιμα κομμάτια',         0, 'boxes',              0),
  ('cost',     'Πορτάκια',                0, 'door-closed',        1),
  ('cost',     'Μηχανισμοί',              0, 'cog',                2),
  ('cost',     'Πάγκος',                  0, 'layers',             3),
  ('cost',     'Εργασία / βοηθός',        0, 'hard-hat',           4),
  ('cost',     'Μεταφορά / καύσιμα',      0, 'truck',              5);
