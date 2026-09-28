ALTER TABLE public.event
  ADD COLUMN audience varchar(20) NOT NULL DEFAULT 'ALL',
  ADD CONSTRAINT event_audience_check
    CHECK (audience IN ('ALL', 'VOLUNTEERS', 'TRAINEES'));
