-- Rooms and stays.
--
-- A hotel's records are not a list of sales; they are a calendar. The one
-- thing the system must never allow is two guests promised the same room on
-- the same night, so the overlap check is a rule in the write path rather
-- than a report someone is expected to read.
--
-- The same shape covers anything let out by the night or the day: a guest
-- house, serviced flats, a campsite pitch, a hall hired by the hour.

CREATE TABLE rooms (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number       TEXT NOT NULL,
  room_type    TEXT NOT NULL DEFAULT 'double',
  floor        INTEGER NOT NULL DEFAULT 0,
  capacity     INTEGER NOT NULL DEFAULT 2,
  nightly_rate INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'available',
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_by   TEXT,
  deleted_at   TEXT
);

CREATE UNIQUE INDEX idx_rooms_number ON rooms (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_rooms_org ON rooms (org_id, deleted_at, status);

CREATE TABLE reservations (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number       TEXT,
  room_id      TEXT NOT NULL REFERENCES rooms(id),
  account_id   TEXT REFERENCES accounts(id),
  guest_name   TEXT NOT NULL,
  guest_phone  TEXT,
  guest_email  TEXT,
  check_in     TEXT NOT NULL,
  check_out    TEXT NOT NULL,
  nights       INTEGER NOT NULL DEFAULT 0,
  adults       INTEGER NOT NULL DEFAULT 1,
  children     INTEGER NOT NULL DEFAULT 0,
  nightly_rate INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'booked',
  source       TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_by   TEXT,
  deleted_at   TEXT
);

-- Every question this table is asked is "which room, over what dates".
CREATE INDEX idx_reservations_room ON reservations (org_id, room_id, check_in, check_out);
CREATE INDEX idx_reservations_dates ON reservations (org_id, check_in, status);
