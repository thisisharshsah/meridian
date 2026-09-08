-- A shop scans; it does not type. SKU is the code the business uses for itself,
-- which is rarely the code printed on the packet by whoever made it, so the two
-- cannot be the same column.
ALTER TABLE items ADD COLUMN barcode TEXT;

CREATE INDEX idx_items_barcode ON items (org_id, barcode);
