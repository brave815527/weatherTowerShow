"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../src/config");
function fixture(overrides = {}) {
  const time = new Date(Date.now() - 60000).toISOString();
  return {
    station_id: "TEST",
    observed_at: time,
    fetched_at: time,
    source: "weather-api",
    quality: "passed",
    expected_interval_seconds: 60,
    temp: 25.2,
    dewpt: 21,
    humidity: 76,
    wind_speed: 2,
    wind_gust: 4,
    wind_dir: 359,
    pressure: 1012.2,
    precip_total: 1,
    precip_rate: 0,
    ...overrides,
  };
}
function payload(overrides = {}) {
  const row = fixture();
  return {
    observations: [
      {
        stationID: "TEST",
        obsTimeUtc: row.observed_at,
        humidity: 76,
        winddir: 359,
        qcStatus: 1,
        realtimeFrequency: 1,
        metric: {
          temp: 25.2,
          dewpt: 21,
          windSpeed: 7.2,
          windGust: 14.4,
          pressure: 1012.2,
          precipTotal: 1,
          precipRate: 0,
        },
        ...overrides,
      },
    ],
  };
}
function temporary(t, options = {}) {
  const root = path.resolve(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, "weather-tower-test-"));
  process.once("exit", () => {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== root ||
      !path.basename(resolved).startsWith("weather-tower-test-")
    )
      throw new Error("Unsafe cleanup target");
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    ...loadConfig({
      APP_MODE: "offline",
      AUTO_START: "false",
      DATA_DIR: dir,
      STATION_ID: "TEST",
      EXPECTED_INTERVAL_SECONDS: "60",
    }),
    legacyPath: path.join(dir, "legacy.json"),
    ...options,
  };
}
function disabledCloud() {
  return {
    health: { state: "disabled", migration_required: false },
    latest: async () => null,
    history: async () => null,
    upload: async () => false,
  };
}
module.exports = { fixture, payload, temporary, disabledCloud };
