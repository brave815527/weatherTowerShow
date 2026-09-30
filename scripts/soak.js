"use strict";
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const origin = new URL(option("--url", "http://127.0.0.1:3005"));
const hours = Number(option("--hours", "8"));
if (
  !Number.isFinite(hours) ||
  hours <= 0 ||
  hours > 24 ||
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
)
  throw new Error("Only a local 0–24 hour soak is supported");
const started = Date.now(),
  until = started + hours * 3600000,
  samples = [];
const directory = path.join(__dirname, "..", "review");
fs.mkdirSync(directory, { recursive: true });
const file = path.join(
  directory,
  `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
(async () => {
  while (!stopped) {
    const t = Date.now();
    try {
      const response = await fetch(new URL("/api/status", origin), {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("HTTP");
      const status = await response.json();
      samples.push({
        timestamp: new Date().toISOString(),
        ok: true,
        latency_ms: Date.now() - t,
        rss_mb: status.rss_mb,
        observed_at: status.observed_at,
        state: status.observation.state,
        pending_uploads: status.pending_uploads,
      });
    } catch {
      samples.push({ timestamp: new Date().toISOString(), ok: false });
    }
    const complete = Date.now() >= until;
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          complete,
          elapsed_seconds: (Date.now() - started) / 1000,
          purpose: "服務耐久測試；不等同於 OBS 錄製驗收",
          failures: samples.filter((row) => !row.ok).length,
          samples,
        },
        null,
        2,
      ),
    );
    if (complete || stopped) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, until - Date.now())),
    );
  }
  console.log(`耐久測試紀錄：${file}`);
  if (samples.some((row) => !row.ok)) process.exitCode = 1;
})().catch(() => {
  process.exitCode = 1;
});
