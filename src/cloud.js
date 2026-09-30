"use strict";
const { createClient } = require("@supabase/supabase-js");
const model = require("../public/js/model");
class CloudRepository {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.health = {
      state: "disabled",
      migration_required: false,
      last_success: null,
    };
    this.retryAfter = 0;
    if (
      config.mode === "offline" ||
      !config.supabaseUrl ||
      !config.supabaseKey ||
      config.supabaseUrl.includes("請填")
    )
      return;
    try {
      if (new URL(config.supabaseUrl).protocol !== "https:")
        throw new Error("INVALID_URL");
      this.client = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, options = {}) =>
            fetchImpl(url, {
              ...options,
              signal: options.signal
                ? AbortSignal.any([
                    options.signal,
                    AbortSignal.timeout(config.timeoutMs),
                  ])
                : AbortSignal.timeout(config.timeoutMs),
            }),
        },
      });
      this.health.state = "waiting";
    } catch {
      this.health.state = "configuration_error";
    }
  }
  available() {
    return Boolean(this.client) && Date.now() >= this.retryAfter;
  }
  fail() {
    this.health.state = "unavailable";
    this.retryAfter = Date.now() + 60000;
  }
  success() {
    this.health.state = "ready";
    this.health.last_success = new Date().toISOString();
    this.retryAfter = 0;
  }
  async latest(station, signal) {
    if (!this.available()) return null;
    try {
      let query = this.client
        .from(this.config.cloudTable)
        .select("*")
        .order("observed_at", { ascending: false })
        .limit(1);
      if (station) query = query.eq("station_id", station);
      const { data, error } = await query.abortSignal(signal);
      if (error && ["42P01", "PGRST205"].includes(error.code)) {
        this.health.migration_required = true;
        return await this.legacyLatest(station, signal);
      }
      if (error) throw error;
      this.health.migration_required = false;
      this.success();
      return data?.length
        ? model.normalize(data[0])
        : await this.legacyLatest(station, signal);
    } catch {
      this.fail();
      return null;
    }
  }
  async legacyLatest(station, signal) {
    let query = this.client
      .from("weather_observations")
      .select("raw_data,created_at,station_id")
      .order("created_at", { ascending: false })
      .limit(20);
    if (station) query = query.eq("station_id", station);
    const { data, error } = await query.abortSignal(signal);
    if (error && ["42P01", "PGRST205"].includes(error.code)) return null;
    if (error) throw error;
    this.success();
    const records = (data || [])
      .map((row) =>
        model.fromWeather(
          row.raw_data,
          row.created_at,
          this.config.expectedInterval,
        ),
      )
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    return records[0] || null;
  }
  async history(station, start, end, signal) {
    if (!this.available() || !station) return null;
    try {
      let legacy = this.health.migration_required,
        rows = [];
      for (let page = 0; page < 4; page++) {
        const table = legacy ? "weather_observations" : this.config.cloudTable,
          field = legacy ? "created_at" : "observed_at";
        const { data, error } = await this.client
          .from(table)
          .select(legacy ? "raw_data,created_at,station_id" : "*")
          .eq("station_id", station)
          .gte(field, new Date(start - (legacy ? 3600000 : 0)).toISOString())
          .lt(field, new Date(end + (legacy ? 3600000 : 0)).toISOString())
          .order(field)
          .range(page * 1000, page * 1000 + 999)
          .abortSignal(signal);
        if (error && !legacy && ["42P01", "PGRST205"].includes(error.code)) {
          legacy = true;
          this.health.migration_required = true;
          page = -1;
          continue;
        }
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      this.success();
      const normalized = rows
        .map((row) =>
          legacy
            ? model.fromWeather(
                row.raw_data,
                row.created_at,
                this.config.expectedInterval,
              )
            : model.normalize(row),
        )
        .filter(
          (row) =>
            row &&
            Date.parse(row.observed_at) >= start &&
            Date.parse(row.observed_at) < end,
        );
      if (legacy) return normalized;
      // Read old real observations without modifying or exposing their raw payload.
      const older = await this.legacyHistory(station, start, end, signal);
      const merged = new Map();
      for (const record of older) merged.set(record.observed_at, record);
      for (const record of normalized) merged.set(record.observed_at, record);
      return [...merged.values()].sort(
        (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
      );
    } catch {
      this.fail();
      return null;
    }
  }
  async legacyHistory(station, start, end, signal) {
    const rows = [];
    for (let page = 0; page < 4; page++) {
      const { data, error } = await this.client
        .from("weather_observations")
        .select("raw_data,created_at,station_id")
        .eq("station_id", station)
        .gte("created_at", new Date(start - 3600000).toISOString())
        .lt("created_at", new Date(end + 3600000).toISOString())
        .order("created_at")
        .range(page * 1000, page * 1000 + 999)
        .abortSignal(signal);
      if (error && ["42P01", "PGRST205"].includes(error.code)) return [];
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return rows
      .map((row) =>
        model.fromWeather(
          row.raw_data,
          row.created_at,
          this.config.expectedInterval,
        ),
      )
      .filter(
        (row) =>
          row &&
          Date.parse(row.observed_at) >= start &&
          Date.parse(row.observed_at) < end,
      );
  }
  async upload(records, signal) {
    if (!records.length) return true;
    if (!this.available()) return false;
    try {
      const { error } = await this.client
        .from(this.config.cloudTable)
        .upsert(records, { onConflict: "station_id,observed_at" })
        .abortSignal(signal);
      if (error) {
        if (["42P01", "PGRST205"].includes(error.code))
          this.health.migration_required = true;
        throw error;
      }
      this.health.migration_required = false;
      this.success();
      return true;
    } catch {
      this.fail();
      return false;
    }
  }
}
module.exports = { CloudRepository };
