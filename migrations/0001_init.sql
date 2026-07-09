-- Migration number: 0001
-- Core booking schema. Times are unix epoch UTC; money is integer pence.

CREATE TABLE services (
  id            INTEGER PRIMARY KEY,
  section       TEXT NOT NULL,               -- 'brows' | 'lashes' | 'lips' | 'freckles'
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  duration_mins INTEGER NOT NULL,
  price_pence   INTEGER NOT NULL,
  deposit_pence INTEGER NOT NULL,             -- seeded at 20% of price; per-service overridable
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE slots (
  id        INTEGER PRIMARY KEY,
  starts_at INTEGER NOT NULL,                 -- unix epoch, UTC
  ends_at   INTEGER NOT NULL,
  status    TEXT NOT NULL DEFAULT 'open'      -- 'open' | 'blocked'
);

CREATE INDEX slots_starts_at ON slots(starts_at);

CREATE TABLE bookings (
  id                TEXT PRIMARY KEY,          -- uuid
  slot_id           INTEGER NOT NULL REFERENCES slots(id),
  service_id        INTEGER NOT NULL REFERENCES services(id),
  client_name       TEXT NOT NULL,
  client_email      TEXT NOT NULL,
  client_phone      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,             -- 'pending_payment' | 'confirmed' | 'cancelled' | 'expired' | 'no_show'
  deposit_pence     INTEGER NOT NULL,
  stripe_session_id TEXT,
  cancel_token      TEXT NOT NULL,             -- capability token for self-serve cancellation
  expires_at        INTEGER,                   -- pending-payment hold deadline
  created_at        INTEGER NOT NULL
);

-- THE concurrency guard: the DB itself enforces "at most one live booking per slot".
CREATE UNIQUE INDEX one_live_booking_per_slot
  ON bookings(slot_id) WHERE status IN ('pending_payment','confirmed');

CREATE UNIQUE INDEX bookings_cancel_token ON bookings(cancel_token);
CREATE INDEX bookings_status ON bookings(status);
