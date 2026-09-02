-- `books.customers` was never a registered entity — the accounts entity lives
-- in CRM. The grant was inert rather than dangerous (unmatched permissions are
-- ignored), but it displayed on the Roles screen as though it meant something.
-- Workspaces created before the fix still carry it, so correct them here.
UPDATE roles
   SET permissions = replace(permissions, '"books.customers.*"', '"crm.accounts.*"'),
       updated_at  = updated_at
 WHERE permissions LIKE '%books.customers.*%';
