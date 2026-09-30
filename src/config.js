"use strict";
const path = require("node:path");
const version = require("../package.json").version;
function integer(value, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("Invalid configuration");
  return n;
}
function loadConfig(env = process.env) {
  const mode =
    env.APP_MODE || (env.NODE_ENV === "production" ? "live" : "playback");
  if (!["live", "playback", "offline"].includes(mode))
    throw new Error("Invalid APP_MODE");
  let stationId = env.STATION_ID || "";
  const weatherUrl = env.WEATHER_API_URL || "";
  if (weatherUrl) {
    const url = new URL(weatherUrl);
    if (url.protocol !== "https:")
      throw new Error("Weather API requires HTTPS");
    stationId ||= url.searchParams.get("stationId") || "";
  }
  if (stationId && !/^[A-Za-z0-9_.-]{1,64}$/.test(stationId))
    throw new Error("Invalid station");
  if (mode === "live" && !weatherUrl)
    throw new Error("Live mode requires WEATHER_API_URL");
  return {
    version,
    mode,
    port: integer(env.PORT, 3005, 1, 65535),
    host: env.HOST || (env.RENDER ? "0.0.0.0" : "127.0.0.1"),
    stationId,
    stationName: (env.STATION_NAME || "吉安氣象觀測站").slice(0, 80),
    weatherUrl,
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, "..", "data")),
    legacyPath: path.join(__dirname, "..", "local_observations.json"),
    supabaseUrl: env.SUPABASE_URL || "",
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    cloudTable: "weather_observations_v2",
    expectedInterval: integer(env.EXPECTED_INTERVAL_SECONDS, 300, 30, 3600),
    pollSeconds: integer(env.POLL_SECONDS, 60, 30, 3600),
    timeoutMs: integer(env.REQUEST_TIMEOUT_MS, 8000, 1000, 30000),
    retentionDays: integer(env.RETENTION_DAYS, 30, 7, 365),
    demoEnabled: env.DEMO_ENABLED !== "false",
    autoStart: env.AUTO_START !== "false",
  };
}
module.exports = { loadConfig };
