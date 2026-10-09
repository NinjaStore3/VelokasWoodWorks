-- How each item is priced, and which kind of job it belongs to.
--   unit:    'm' per metre, 'm2' per square metre, 'pcs' per piece.
--            Materials start per metre, extras and cost lines per piece.
--   section: 'kitchen', 'wardrobe' or 'door'. Cost lines ignore it.
ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'm' CHECK (unit IN ('m', 'm2', 'pcs'));
ALTER TABLE items ADD COLUMN section TEXT NOT NULL DEFAULT 'kitchen' CHECK (section IN ('kitchen', 'wardrobe', 'door'));
UPDATE items SET unit = 'pcs' WHERE kind <> 'material';
