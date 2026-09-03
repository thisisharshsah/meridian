-- One source document, one result.
--
-- `quote_to_order` and `order_to_invoice` guarded against re-conversion with a
-- SELECT and then inserted on a different connection — a check-then-act with a
-- window between them. Two clicks landing together both passed the read and
-- both created a document, which for an invoice means billing a customer
-- twice. The index closes the window; the SELECT stays only to produce a
-- friendlier message than a constraint violation.
CREATE UNIQUE INDEX idx_orders_one_per_quote
  ON sales_orders (org_id, quote_id)
  WHERE quote_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX idx_invoices_one_per_order
  ON invoices (org_id, sales_order_id)
  WHERE sales_order_id IS NOT NULL AND deleted_at IS NULL;
