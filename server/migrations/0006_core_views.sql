-- Users are global, but every business record points at them through an
-- org-scoped `owner_id`. This view gives the generic repository the `org_id`
-- and audit columns it expects, so user lookups work like any other entity.
CREATE VIEW org_users AS
SELECT
  u.id                AS id,
  m.org_id            AS org_id,
  u.name              AS name,
  u.email             AS email,
  u.avatar_url        AS avatar_url,
  m.title             AS title,
  r.name              AS role_name,
  m.is_owner          AS is_owner,
  m.status            AS status,
  u.last_login_at     AS last_login_at,
  u.created_at        AS created_at,
  u.updated_at        AS updated_at,
  NULL                AS created_by,
  NULL                AS updated_by,
  COALESCE(m.deleted_at, u.deleted_at) AS deleted_at
FROM memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN roles r ON r.id = m.role_id;
