-- Additive review audit metadata. Existing immutable history, RLS and grants remain.
ALTER TABLE public.trainee_application_events ADD COLUMN reason varchar(2000);
