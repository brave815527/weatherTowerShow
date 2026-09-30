"use strict";
const express = require("express");
const path = require("node:path");
const { Repository } = require("./repository");
const { CloudRepository } = require("./cloud");
const { WeatherService } = require("./weather-service");
const { demoLatest, demoHistory } = require("./demo");
const model = require("../public/js/model");
function queryRange(query, now = Date.now()) {
  if (query.date !== undefined) {
    if (
      typeof query.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.date)
    )
      throw new Error("日期格式不正確");
    const start = Date.parse(`${query.date}T00:00:00+08:00`);
    if (
      !Number.isFinite(start) ||
      model.dateKey(start) !== query.date ||
      query.date > model.dateKey(now) ||
      query.date < "2000-01-01"
    )
      throw new Error("日期超出可查詢範圍");
    return { start, end: start + 86400000, label: `${query.date} · UTC+8` };
  }
  const hours = query.hours === undefined ? 24 : Number(query.hours);
  if (![1, 6, 12, 24].includes(hours)) throw new Error("時間範圍不正確");
  const end = Math.ceil(now / 60000) * 60000;
  return {
    start: end - hours * 3600000,
    end,
    label: `最近 ${hours} 小時 · UTC+8`,
  };
}
async function createApplication(config, options = {}) {
  const repository = options.repository || new Repository(config),
    cloud = options.cloud || new CloudRepository(config, options.fetchImpl),
    service = new WeatherService(config, repository, cloud, options);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });
  const requests = new Map();
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now(),
      key = req.socket.remoteAddress;
    for (const [ip, item] of requests)
      if (item.reset < now) requests.delete(ip);
    if (!requests.has(key) && requests.size >= 1000)
      return res.status(429).json({ error: "請稍後重試" });
    const item = requests.get(key) || { count: 0, reset: now + 60000 };
    item.count++;
    requests.set(key, item);
    if (item.count > 180) {
      res.set("Retry-After", "60");
      return res.status(429).json({ error: "請求過於頻繁" });
    }
    next();
  });
  function selection(req) {
    const station =
      req.query.station === undefined ? service.station() : req.query.station;
    if (
      typeof station !== "string" ||
      (station && !/^[A-Za-z0-9_.-]{1,64}$/.test(station))
    )
      throw new Error("測站格式不正確");
    if (
      req.query.demo !== undefined &&
      !["true", "false"].includes(req.query.demo)
    )
      throw new Error("展示模式不正確");
    const demo = req.query.demo === "true";
    if (demo && !config.demoEnabled) throw new Error("示範模式未啟用");
    return { station, demo };
  }
  app.get("/api/weather/latest", (req, res) => {
    try {
      const { station, demo } = selection(req),
        observation = demo ? demoLatest() : service.current(station);
      res.json({
        version: 2,
        observation,
        status: model.freshness(observation),
        station_name: demo ? "吉安氣象觀測站 · 示範" : config.stationName,
        station_id: demo ? "DEMO" : station,
        server_time: new Date().toISOString(),
        poll_seconds: config.pollSeconds,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.get("/api/weather/history", async (req, res) => {
    let selected, range;
    try {
      selected = selection(req);
      range = queryRange(req.query);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      const result = selected.demo
        ? {
            observations: demoHistory(range.start, range.end),
            source: "demo",
            degraded: false,
          }
        : await service.history(selected.station, range.start, range.end);
      const expected =
        service.current(selected.station)?.expected_interval_seconds ||
        config.expectedInterval;
      res.json({
        version: 2,
        ...result,
        station_name: selected.demo
          ? "吉安氣象觀測站 · 示範"
          : config.stationName,
        station_id: selected.demo ? "DEMO" : selected.station,
        range: {
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
          label: range.label,
        },
        expected_interval_seconds: expected,
        empty: result.observations.length === 0,
      });
    } catch {
      res.status(503).json({ error: "歷史資料暫時無法取得" });
    }
  });
  app.get("/api/status", (req, res) => res.json(service.status()));
  app.get("/api/health", (req, res) =>
    res.json({ running: true, version: config.version }),
  );
  app.get("/control", (req, res) =>
    res.sendFile(path.join(__dirname, "..", "public", "control.html")),
  );
  app.get("/overlay", (req, res) =>
    res.sendFile(path.join(__dirname, "..", "public", "overlay.html")),
  );
  app.get("/index.html", (req, res) => res.redirect("/control"));
  app.get("/", (req, res) =>
    res.redirect(
      req.query.obs === "true"
        ? `/overlay?${new URLSearchParams(req.query)}`
        : "/control",
    ),
  );
  app.use(
    express.static(path.join(__dirname, "..", "public"), {
      index: false,
      maxAge: 0,
    }),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "找不到此服務" }),
  );
  app.use((error, req, res, next) =>
    res.status(500).json({ error: "服務暫時無法完成此操作" }),
  );
  return { app, service, repository, config };
}
module.exports = { createApplication, queryRange };
