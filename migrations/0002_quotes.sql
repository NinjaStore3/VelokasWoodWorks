-- Saved quotes (Προσφορές) and the business details printed on PDF quotes.

-- One row per saved quote. Numbers restart every year: 2026-001, 2026-002...
-- `doc` is the customer-facing quote exactly as it was saved (lines, totals,
-- notes) so old quotes never change when prices in Settings do. `draft` is the
-- calculator state, used to reopen the quote for editing. Both are JSON.
CREATE TABLE quotes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  year             INTEGER NOT NULL,
  seq              INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  customer_name    TEXT    NOT NULL DEFAULT '',
  customer_phone   TEXT    NOT NULL DEFAULT '',
  customer_address TEXT    NOT NULL DEFAULT '',
  net_cents        INTEGER NOT NULL DEFAULT 0, -- after discount, before VAT
  gross_cents      INTEGER NOT NULL DEFAULT 0,
  cost_cents       INTEGER NOT NULL DEFAULT 0, -- internal costs, never shown to customers
  doc              TEXT    NOT NULL,
  draft            TEXT    NOT NULL,
  created_at       INTEGER NOT NULL, -- unix ms
  updated_at       INTEGER NOT NULL,
  UNIQUE (year, seq)
);
CREATE INDEX quotes_created ON quotes (created_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('business_phone', ''),
  ('business_email', ''),
  ('business_address', ''),
  ('business_vat_id', ''),
  ('quote_terms', ''),
  ('quote_validity_days', '30'),
  ('deposit_percent', '0');
