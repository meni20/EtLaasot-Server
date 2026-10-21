-- Synthetic prerequisite schema for migration 030/component integration tests.
-- Matches current Sequelize fields, not a dump or copy of Dev/Production data.
CREATE TABLE branch (
  id varchar(50) PRIMARY KEY, name varchar(100), city varchar(100), address varchar(255), phone varchar(20), email varchar(100),
  "isActive" boolean DEFAULT true, "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now(), "deletedAt" timestamptz
);
CREATE TABLE roles (id integer PRIMARY KEY, name varchar(100));
CREATE TABLE "user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), national_id_hash varchar(64), national_id_last4 varchar(4), national_id_encrypted text,
  password_hash text, password_changed_at timestamptz, must_change_password boolean DEFAULT false,
  failed_login_attempts integer DEFAULT 0, locked_until timestamptz, temporary_password_expires_at timestamptz,
  is_active boolean DEFAULT true, archived_at timestamptz, archived_by uuid REFERENCES "user"(id), archive_reason text,
  name varchar(255), phone_number varchar(255), gender varchar(255), address varchar(255), email varchar(255), age integer,
  date_of_birth date, shirt_size varchar(10), custom_shirt_size varchar(50), allergies text, notes text, parent_name varchar(100),
  "branchId" varchar(50) REFERENCES branch(id), "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now(), "deletedAt" timestamptz
);
CREATE TABLE user_roles (
  "userId" uuid NOT NULL REFERENCES "user"(id), "roleId" integer NOT NULL REFERENCES roles(id),
  "resourceId" varchar(50), "grantedBy" varchar(255), "expirationDate" timestamptz,
  "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now(), "deletedAt" timestamptz,
  PRIMARY KEY ("userId", "roleId")
);
CREATE TABLE trainee_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trainee_uuid uuid NOT NULL REFERENCES "user"(id),
  medication_name varchar(200) NOT NULL, dosage varchar(100), frequency varchar(30), schedule varchar(300), instructions text, notes text,
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz
);
