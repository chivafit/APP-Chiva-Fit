CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  has_id boolean;
  has_pk boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'interactions'
      AND column_name = 'id'
  ) INTO has_id;

  IF NOT has_id THEN
    EXECUTE 'ALTER TABLE public.interactions ADD COLUMN id uuid';
    EXECUTE 'UPDATE public.interactions SET id = gen_random_uuid() WHERE id IS NULL';
    EXECUTE 'ALTER TABLE public.interactions ALTER COLUMN id SET DEFAULT gen_random_uuid()';
    EXECUTE 'ALTER TABLE public.interactions ALTER COLUMN id SET NOT NULL';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'interactions'
      AND tc.constraint_type = 'PRIMARY KEY'
  ) INTO has_pk;

  IF NOT has_pk THEN
    EXECUTE 'ALTER TABLE public.interactions ADD CONSTRAINT interactions_pkey PRIMARY KEY (id)';
  END IF;
END $$;
