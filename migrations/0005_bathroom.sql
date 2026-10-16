-- Bathroom furniture (έπιπλο μπάνιου) as a fourth kind of job.
--
-- The kind of job was limited to kitchen, wardrobe and door by a CHECK, which
-- SQLite can't change in place, so the items table is rebuilt once without it.
-- The Worker checks the value instead, so later kinds of job need no rebuild.
-- Every row keeps its id, and the id counter carries on from where it was, so
-- ids of deleted items are still never reused (open drafts refer to them).

CREATE TABLE items_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('material', 'extra', 'cost')),
  name        TEXT    NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  icon        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  unit        TEXT    NOT NULL DEFAULT 'm' CHECK (unit IN ('m', 'm2', 'pcs')),
  section     TEXT    NOT NULL DEFAULT 'kitchen'
);

INSERT INTO items_new (id, kind, name, price_cents, icon, sort_order, active, unit, section)
SELECT id, kind, name, price_cents, icon, sort_order, active, unit, section FROM items;

-- Carry the id counter over: a placeholder row at the highest id ever handed
-- out moves the new table's counter there, then goes again.
INSERT OR IGNORE INTO items_new (id, kind, name)
SELECT seq, 'cost', '__id_counter__' FROM sqlite_sequence WHERE name = 'items';
DELETE FROM items_new WHERE name = '__id_counter__';

DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX items_kind_order ON items (kind, sort_order);

-- What a bathroom is made of and its extras. Melamine, PET, the drawer and the
-- pull-out start at the kitchen's prices; plywood and the laundry basket have
-- no price yet and are set in Ρυθμίσεις.
WITH kitchen (name, price_cents) AS (
  SELECT name, price_cents FROM items WHERE section = 'kitchen' AND kind IN ('material', 'extra')
),
new_items (kind, name, price_cents, unit, icon, pos) AS (
  VALUES
    ('material', 'Μελαμίνη',        COALESCE((SELECT price_cents FROM kitchen WHERE name = 'Μελαμίνη'), 26000),     'm',   '',                1),
    ('material', 'PET',             COALESCE((SELECT price_cents FROM kitchen WHERE name = 'PET'), 33000),          'm',   '',                2),
    ('material', 'Κόντρα πλακέ',    0,                                                                               'm',   '',                3),
    ('extra',    'Συρτάρι',         COALESCE((SELECT price_cents FROM kitchen WHERE name = 'Απλό συρτάρι'), 4000),  'pcs', 'panel-bottom',    1),
    ('extra',    'Βαγονέτο',        COALESCE((SELECT price_cents FROM kitchen WHERE name = 'Βαγονέτο'), 10000),     'pcs', 'shelving-unit',   2),
    ('extra',    'Καλάθι απλύτων',  0,                                                                               'pcs', 'shopping-basket', 3)
)
INSERT INTO items (kind, section, name, price_cents, unit, icon, sort_order)
SELECT n.kind, 'bathroom', n.name, n.price_cents, n.unit, n.icon,
       (SELECT COALESCE(MAX(i.sort_order), -1) FROM items i WHERE i.kind = n.kind) + n.pos
  FROM new_items n
 WHERE NOT EXISTS (
   SELECT 1 FROM items i WHERE i.kind = n.kind AND i.section = 'bathroom' AND i.name = n.name
 );

-- A Settings screen left open with the old list must reload before saving.
INSERT INTO settings (key, value) VALUES ('config_version', '1')
  ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
