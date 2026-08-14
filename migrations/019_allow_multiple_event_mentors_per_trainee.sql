DROP INDEX IF EXISTS event_pairing_trainee_active_unique;

CREATE INDEX IF NOT EXISTS idx_event_pairing_event_trainee_active
  ON event_pairing ("eventId", "traineeId")
  WHERE "deletedAt" IS NULL;
