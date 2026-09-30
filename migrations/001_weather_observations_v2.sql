-- Run once in the Supabase SQL editor. The existing table is preserved.
BEGIN;
CREATE TABLE IF NOT EXISTS public.weather_observations_v2 (
    station_id TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('weather-api','cloud','legacy-verified')),
    quality TEXT NOT NULL CHECK (quality IN ('passed','suspect','unchecked')),
    expected_interval_seconds INTEGER NOT NULL CHECK (expected_interval_seconds BETWEEN 30 AND 3600),
    temp DOUBLE PRECISION CHECK (temp BETWEEN -90 AND 65),
    dewpt DOUBLE PRECISION CHECK (dewpt BETWEEN -100 AND 65),
    humidity DOUBLE PRECISION CHECK (humidity BETWEEN 0 AND 100),
    wind_speed DOUBLE PRECISION CHECK (wind_speed BETWEEN 0 AND 150),
    wind_gust DOUBLE PRECISION CHECK (wind_gust BETWEEN 0 AND 150),
    wind_dir DOUBLE PRECISION CHECK (wind_dir >= 0 AND wind_dir < 360),
    pressure DOUBLE PRECISION CHECK (pressure BETWEEN 800 AND 1100),
    precip_total DOUBLE PRECISION CHECK (precip_total BETWEEN 0 AND 3000),
    precip_rate DOUBLE PRECISION CHECK (precip_rate BETWEEN 0 AND 2000),
    PRIMARY KEY (station_id, observed_at)
);
CREATE INDEX IF NOT EXISTS weather_v2_observed_at ON public.weather_observations_v2(observed_at);
ALTER TABLE public.weather_observations_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weather_observations_v2 FROM anon, authenticated;
REVOKE DELETE ON public.weather_observations_v2 FROM service_role;
GRANT SELECT,INSERT,UPDATE ON public.weather_observations_v2 TO service_role;
COMMIT;
