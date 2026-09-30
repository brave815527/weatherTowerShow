-- Apply after switching the old frontend to the new API. This retains all rows.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.weather_observations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Allow public read access" ON public.weather_observations';
    EXECUTE 'REVOKE ALL ON public.weather_observations FROM anon, authenticated';
    EXECUTE 'GRANT SELECT ON public.weather_observations TO service_role';
  END IF;
END $$;
COMMIT;
