CREATE TABLE IF NOT EXISTS trainee_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_uuid uuid NOT NULL,
  medication_name varchar(200) NOT NULL,
  dosage varchar(100) NULL,
  frequency varchar(30) NULL,
  schedule varchar(300) NULL,
  instructions text NULL,
  notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT trainee_medications_trainee_fkey
    FOREIGN KEY (trainee_uuid)
    REFERENCES "user"(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT trainee_medications_frequency_check
    CHECK (
      frequency IS NULL OR frequency IN (
        'ONCE_DAILY',
        'TWICE_DAILY',
        'THREE_TIMES_DAILY',
        'FOUR_TIMES_DAILY',
        'AS_NEEDED',
        'CUSTOM'
      )
    ),
  CONSTRAINT trainee_medications_name_not_blank_check
    CHECK (length(btrim(medication_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_trainee_medications_trainee
  ON trainee_medications (trainee_uuid);

CREATE INDEX IF NOT EXISTS idx_trainee_medications_active
  ON trainee_medications (trainee_uuid, is_active)
  WHERE deleted_at IS NULL;
