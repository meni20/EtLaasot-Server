-- Apply manually before running production deployments.
-- The application no longer uses Sequelize sync/alter at runtime.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendee_rsvp_status') THEN
    CREATE TYPE attendee_rsvp_status AS ENUM ('pending', 'confirmed', 'declined');
  END IF;
END
$$;

ALTER TABLE attendee
  ALTER COLUMN "rsvpStatus" DROP DEFAULT,
  ALTER COLUMN "rsvpStatus" TYPE attendee_rsvp_status
    USING COALESCE("rsvpStatus"::text, 'pending')::attendee_rsvp_status,
  ALTER COLUMN "rsvpStatus" SET DEFAULT 'pending';

ALTER TABLE attendee
  DROP CONSTRAINT IF EXISTS "attendee_eventId_userId_key";

ALTER TABLE user_roles
  DROP CONSTRAINT IF EXISTS "user_roles_userId_roleId_key";

DROP INDEX IF EXISTS mentor_assignment_active_trainee_unique;

CREATE UNIQUE INDEX mentor_assignment_active_trainee_unique
  ON mentor_assignment ("branchId", "traineeId")
  WHERE "isActive" = true AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_branch_start
  ON event ("branchId", start_date);

CREATE INDEX IF NOT EXISTS idx_attendee_event_checked_in
  ON attendee ("eventId", "checkedIn")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_branch
  ON "user" ("branchId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_resource_role
  ON user_roles ("resourceId", "roleId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_mentor_assignment_branch_active
  ON mentor_assignment ("branchId", "isActive")
  WHERE "deletedAt" IS NULL;
