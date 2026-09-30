"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const model = require("../public/js/model");
async function atomicJson(file, data) {
  const temp = `${file}.tmp`,
    handle = await fsp.open(temp, "w");
  try {
    await handle.writeFile(JSON.stringify(data), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    JSON.parse(await fsp.readFile(file, "utf8"));
    await fsp.copyFile(file, `${file}.previous`);
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  await fsp.rename(temp, file);
}
class Repository {
  constructor(config) {
    this.config = config;
    this.health = {
      storage: "ready",
      snapshot: "ready",
      legacy_imported: 0,
      legacy_rejected: 0,
      recovered: false,
    };
    this.snapshotQueue = Promise.resolve();
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.dbPath = path.join(config.dataDir, "observations.sqlite");
    this.snapshotPath = path.join(config.dataDir, "latest.json");
    const pointerPath = path.join(config.dataDir, "active-database.json");
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
      if (
        /^recovery-\d+\.sqlite$/.test(pointer.file) &&
        fs.existsSync(path.join(config.dataDir, pointer.file))
      ) {
        this.dbPath = path.join(config.dataDir, pointer.file);
        this.health.storage = "recovery";
        this.health.recovered = true;
      }
    } catch {
      /* No recovery database has been selected. */
    }
    let db;
    try {
      db = new DatabaseSync(this.dbPath, { timeout: 1000, defensive: true });
      const check = db.prepare("PRAGMA quick_check").get();
      if (Object.values(check)[0] !== "ok") throw new Error("CORRUPT_DATABASE");
    } catch {
      db?.close();
      this.health.storage = "recovery";
      this.health.recovered = true;
      this.dbPath = path.join(config.dataDir, `recovery-${Date.now()}.sqlite`);
      db = new DatabaseSync(this.dbPath, { timeout: 1000, defensive: true });
    }
    this.db = db;
    if (this.health.recovered) {
      fs.writeFileSync(
        `${pointerPath}.tmp`,
        JSON.stringify({ file: path.basename(this.dbPath) }),
      );
      fs.renameSync(`${pointerPath}.tmp`, pointerPath);
    }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS observations(station_id TEXT NOT NULL, observed_at TEXT NOT NULL, record TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(station_id, observed_at));
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS observations_time ON observations(observed_at);
          CREATE INDEX IF NOT EXISTS observations_pending ON observations(pending, observed_at);`);
    if (this.health.recovered && !this.latest()) this.recoverSnapshot();
    this.importLegacy();
  }
  recoverSnapshot() {
    for (const file of [this.snapshotPath, `${this.snapshotPath}.previous`]) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(file, "utf8")),
          records = Array.isArray(snapshot.observations)
            ? snapshot.observations
            : [];
        let restored = 0;
        for (const value of records) {
          const record = model.normalize(value);
          if (record && record.source !== "demo") {
            this.put(
              record,
              this.config.mode === "live" && Boolean(this.config.supabaseKey),
            );
            restored++;
          }
        }
        if (restored) return;
      } catch {
        /* Preserve damaged files; try the previous snapshot. */
      }
    }
    this.health.snapshot = "missing";
  }
  importLegacy() {
    const saved = this.db
      .prepare("SELECT value FROM metadata WHERE key='legacy'")
      .get();
    if (saved) {
      Object.assign(this.health, JSON.parse(saved.value));
      return;
    }
    let imported = 0,
      rejected = 0;
    try {
      const records = JSON.parse(
        fs.readFileSync(this.config.legacyPath, "utf8"),
      );
      if (!Array.isArray(records)) throw new Error("INVALID_LEGACY");
      this.db.exec("BEGIN");
      try {
        for (const row of records) {
          const record = row.raw_data
            ? model.fromWeather(
                row.raw_data,
                row.created_at,
                this.config.expectedInterval,
              )
            : null;
          if (!record) {
            rejected++;
            continue;
          }
          record.source = "legacy-verified";
          this.put(record, false);
          imported++;
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      if (error.code !== "ENOENT") this.health.legacy_error = true;
    }
    const result = { legacy_imported: imported, legacy_rejected: rejected };
    Object.assign(this.health, result);
    this.db
      .prepare("INSERT OR REPLACE INTO metadata VALUES ('legacy',?)")
      .run(JSON.stringify(result));
  }
  put(record, pending) {
    const existing = this.db
      .prepare(
        "SELECT record,pending FROM observations WHERE station_id=? AND observed_at=?",
      )
      .get(record.station_id, record.observed_at);
    const old = existing ? JSON.parse(existing.record) : null;
    const changed =
      !old ||
      [...Object.keys(model.fields), "quality"].some(
        (key) => old[key] !== record[key],
      );
    this.db
      .prepare(
        "INSERT INTO observations VALUES (?,?,?,?) ON CONFLICT(station_id,observed_at) DO UPDATE SET record=excluded.record,pending=excluded.pending",
      )
      .run(
        record.station_id,
        record.observed_at,
        JSON.stringify(record),
        pending && changed ? 1 : existing?.pending || 0,
      );
  }
  async save(record, pending = false) {
    record = model.normalize(record);
    if (!record || record.source === "demo")
      throw new Error("INVALID_OBSERVATION");
    this.put(record, pending);
    this.db
      .prepare(
        "DELETE FROM observations WHERE observed_at<? AND pending=0 AND (station_id,observed_at) NOT IN (SELECT station_id,MAX(observed_at) FROM observations GROUP BY station_id)",
      )
      .run(
        new Date(
          Date.now() - this.config.retentionDays * 86400000,
        ).toISOString(),
      );
    const observations = this.stations()
      .map((station) => this.latest(station))
      .filter(Boolean);
    this.snapshotQueue = this.snapshotQueue
      .catch(() => {})
      .then(() => atomicJson(this.snapshotPath, { version: 2, observations }));
    try {
      await this.snapshotQueue;
      this.health.snapshot = "ready";
    } catch {
      this.health.snapshot = "error";
    }
  }
  latest(station) {
    const row = station
      ? this.db
          .prepare(
            "SELECT record FROM observations WHERE station_id=? ORDER BY observed_at DESC LIMIT 1",
          )
          .get(station)
      : this.db
          .prepare(
            "SELECT record FROM observations ORDER BY observed_at DESC LIMIT 1",
          )
          .get();
    return row ? model.normalize(JSON.parse(row.record)) : null;
  }
  stations() {
    return this.db
      .prepare(
        "SELECT DISTINCT station_id FROM observations ORDER BY station_id",
      )
      .all()
      .map((row) => row.station_id);
  }
  history(station, start, end, limit = 10000) {
    return this.db
      .prepare(
        "SELECT record FROM observations WHERE station_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at ASC LIMIT ?",
      )
      .all(
        station,
        new Date(start).toISOString(),
        new Date(end).toISOString(),
        limit,
      )
      .map((row) => model.normalize(JSON.parse(row.record)))
      .filter(Boolean);
  }
  pending(limit = 250) {
    return this.db
      .prepare(
        "SELECT record FROM observations WHERE pending=1 ORDER BY observed_at LIMIT ?",
      )
      .all(limit)
      .map((row) => JSON.parse(row.record));
  }
  acknowledge(records) {
    this.db.exec("BEGIN");
    try {
      const stmt = this.db.prepare(
        "UPDATE observations SET pending=0 WHERE station_id=? AND observed_at=?",
      );
      for (const row of records) stmt.run(row.station_id, row.observed_at);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  pendingCount() {
    return this.db
      .prepare("SELECT COUNT(*) AS count FROM observations WHERE pending=1")
      .get().count;
  }
  close() {
    this.db.close();
  }
}
module.exports = { Repository, atomicJson };
