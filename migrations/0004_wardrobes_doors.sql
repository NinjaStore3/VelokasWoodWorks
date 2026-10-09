-- Panos's price list (October 2026): kitchen finishes, wardrobes and doors,
-- with their extras. Only adds what isn't there yet (matched by job and name)
-- and leaves every other item and price alone.

UPDATE items SET price_cents = 26000
 WHERE kind = 'material' AND section = 'kitchen' AND name = 'Μελαμίνη';

WITH new_items (kind, section, name, price_cents, unit, icon, pos) AS (
  VALUES
    ('material', 'kitchen',  'PET',                33000, 'm',   '',                1),
    ('material', 'kitchen',  'Thermofoil',         41000, 'm',   '',                2),
    ('material', 'wardrobe', 'Ανοιγόμενη',         32000, 'm',   '',                3),
    ('material', 'wardrobe', 'Συρόμενη',           39000, 'm',   '',                4),
    ('material', 'door',     'Ανοιγόμενη',         40000, 'pcs', '',                5),
    ('material', 'door',     'Συρόμενη',           60000, 'pcs', '',                6),
    ('extra',    'kitchen',  'LED φωτισμός',        1800, 'm',   'lightbulb',       1),
    ('extra',    'kitchen',  'Πόμολα',               500, 'pcs', 'grip-horizontal', 2),
    ('extra',    'wardrobe', 'Συρτάρι κανονικό',    3500, 'pcs', 'panel-bottom',    3),
    ('extra',    'wardrobe', 'Συρτάρι soft close',  4500, 'pcs', 'archive',         4),
    ('extra',    'wardrobe', 'Παντελονοθήκη',       6000, 'pcs', 'shirt',           5),
    ('extra',    'wardrobe', 'LED φωτισμός',        1800, 'm',   'lightbulb',       6),
    ('extra',    'wardrobe', 'Πόμολα',              3000, 'pcs', 'grip-horizontal', 7)
)
INSERT INTO items (kind, section, name, price_cents, unit, icon, sort_order)
SELECT n.kind, n.section, n.name, n.price_cents, n.unit, n.icon,
       (SELECT COALESCE(MAX(i.sort_order), -1) FROM items i WHERE i.kind = n.kind) + n.pos
  FROM new_items n
 WHERE NOT EXISTS (
   SELECT 1 FROM items i WHERE i.kind = n.kind AND i.section = n.section AND i.name = n.name
 );

-- A Settings screen left open with the old list must reload before saving,
-- or it would write the old list back over these.
INSERT INTO settings (key, value) VALUES ('config_version', '1')
  ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
