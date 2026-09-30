"use strict";
const model = require("../public/js/model");
const { fetchJson } = require("./network");
class WeatherService {
  constructor(config, repository, cloud, options = {}) {
    this.config = config;
    this.repository = repository;
    this.cloud = cloud;
    this.fetchImpl = options.fetchImpl || fetch;
    this.latest = repository.latest(config.stationId);
    this.busy = false;
    this.timer = null;
    this.running = null;
    this.controller = new AbortController();
    this.cache = new Map();
    this.historyPending = new Map();
    this.health = {
      collector: config.mode === "offline" ? "disabled" : "waiting",
      last_fetch_success: null,
      last_attempt: null,
      latency_ms: null,
      skipped_overlaps: 0,
      storage_error: false,
    };
  }
  station() {
    return (
      this.config.stationId ||
      this.latest?.station_id ||
      this.repository.stations()[0] ||
      ""
    );
  }
  current(station = this.station()) {
    return this.latest?.station_id === station
      ? this.latest
      : this.repository.latest(station);
  }
  async collect() {
    if (this.busy) {
      this.health.skipped_overlaps++;
      return false;
    }
    if (this.config.mode === "offline") return false;
    this.busy = true;
    const start = Date.now();
    this.health.last_attempt = new Date(start).toISOString();
    try {
      let observation;
      if (this.config.mode === "live") {
        const payload = await fetchJson(this.config.weatherUrl, {
          timeoutMs: this.config.timeoutMs,
          fetchImpl: this.fetchImpl,
          signal: this.controller.signal,
        });
        observation = model.fromWeather(
          payload,
          new Date().toISOString(),
          this.config.expectedInterval,
        );
        if (
          !observation ||
          (this.config.stationId &&
            observation.station_id !== this.config.stationId)
        )
          throw new Error("INVALID_OBSERVATION");
      } else
        observation = await this.cloud.latest(
          this.station(),
          AbortSignal.any([
            this.controller.signal,
            AbortSignal.timeout(this.config.timeoutMs * 2),
          ]),
        );
      if (observation) {
        if (
          !this.latest ||
          Date.parse(observation.observed_at) >=
            Date.parse(this.latest.observed_at)
        )
          this.latest = observation;
        try {
          await this.repository.save(
            observation,
            this.config.mode === "live" && Boolean(this.cloud.client),
          );
          this.health.storage_error = false;
        } catch {
          this.health.storage_error = true;
        }
        this.health.last_fetch_success = new Date().toISOString();
        this.health.collector = "ready";
        this.cache.clear();
      } else this.health.collector = "unavailable";
      const pending = this.repository.pending();
      if (
        pending.length &&
        this.config.mode === "live" &&
        (await this.cloud.upload(pending, this.controller.signal))
      )
        this.repository.acknowledge(pending);
      return Boolean(observation);
    } catch {
      this.health.collector = "unavailable";
      return false;
    } finally {
      this.health.latency_ms = Date.now() - start;
      this.busy = false;
    }
  }
  start() {
    if (
      !this.config.autoStart ||
      this.config.mode === "offline" ||
      this.timer ||
      this.running
    )
      return;
    const tick = () => {
      this.running = this.collect().finally(() => {
        this.running = null;
        if (!this.controller.signal.aborted) {
          this.timer = setTimeout(() => {
            this.timer = null;
            tick();
          }, this.config.pollSeconds * 1000);
          this.timer.unref();
        }
      });
    };
    tick();
  }
  async stop() {
    clearTimeout(this.timer);
    this.controller.abort();
    await this.running;
    await this.repository.snapshotQueue;
  }
  async history(station, start, end) {
    const key = `${station}|${start}|${end}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (this.historyPending.has(key)) return this.historyPending.get(key);
    const operation = (async () => {
      const local = this.repository.history(station, start, end);
      const remote =
        this.config.mode !== "offline"
          ? await this.cloud.history(
              station,
              start,
              end,
              AbortSignal.any([
                this.controller.signal,
                AbortSignal.timeout(this.config.timeoutMs * 2),
              ]),
            )
          : null;
      const map = new Map();
      for (const row of remote || []) map.set(row.observed_at, row);
      for (const row of local) map.set(row.observed_at, row);
      const result = {
        observations: [...map.values()].sort(
          (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
        ),
        source:
          remote === null ? "local" : local.length ? "cloud+local" : "cloud",
        degraded: this.config.mode !== "offline" && remote === null,
      };
      if (this.cache.size >= 64)
        this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { expires: Date.now() + 30000, result });
      return result;
    })();
    this.historyPending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.historyPending.delete(key);
    }
  }
  status() {
    return {
      version: this.config.version,
      mode: this.config.mode,
      station_id: this.station(),
      station_name: this.config.stationName,
      server_time: new Date().toISOString(),
      rss_mb: Math.round(process.memoryUsage().rss / 1048576),
      observation: model.freshness(this.current()),
      observed_at: this.current()?.observed_at || null,
      ...this.health,
      cloud: this.cloud.health,
      local: this.repository.health,
      pending_uploads: this.repository.pendingCount(),
      stations: [
        ...new Set([this.station(), ...this.repository.stations()]),
      ].filter(Boolean),
    };
  }
}
module.exports = { WeatherService };
