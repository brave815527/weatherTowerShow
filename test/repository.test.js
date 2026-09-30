"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Repository } = require("../src/repository");
const { fixture, payload, temporary } = require("./helpers");
test("upsert is idempotent; acknowledged repeats do not requeue", async (t) => {
  const config = temporary(t),
    repo = new Repository(config);
  t.after(() => repo.close());
  const row = fixture();
  await repo.save(row, true);
  await repo.save(row, true);
  assert.equal(repo.pendingCount(), 1);
  repo.acknowledge([row]);
  await repo.save(row, true);
  assert.equal(repo.pendingCount(), 0);
  await repo.save({ ...row, temp: 26 }, true);
  assert.equal(repo.pendingCount(), 1);
  assert.equal(
    repo.history("TEST", Date.now() - 86400000, Date.now()).length,
    1,
  );
});
test("snapshot and pending queue survive restart", async (t) => {
  const config = temporary(t),
    row = fixture();
  const first = new Repository(config);
  await first.save(row, true);
  first.close();
  const second = new Repository(config);
  t.after(() => second.close());
  assert.equal(second.latest("TEST").observed_at, row.observed_at);
  assert.equal(second.pendingCount(), 1);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(config.dataDir, "latest.json"), "utf8"),
    ).observations[0].temp,
    row.temp,
  );
});
test("demo cannot be persisted", async (t) => {
  const repo = new Repository(temporary(t));
  t.after(() => repo.close());
  await assert.rejects(repo.save(fixture({ source: "demo" })), /INVALID/);
  assert.deepEqual(repo.stations(), []);
});
test("a damaged current snapshot never replaces the valid previous snapshot", async (t) => {
  const config = temporary(t),
    repo = new Repository(config);
  t.after(() => repo.close());
  await repo.save(fixture({ temp: 23 }));
  await repo.save(fixture({ temp: 24 }));
  const latest = path.join(config.dataDir, "latest.json");
  const previous = fs.readFileSync(`${latest}.previous`, "utf8");
  fs.writeFileSync(latest, "broken-json");
  await repo.save(fixture({ temp: 25 }));
  assert.equal(fs.readFileSync(`${latest}.previous`, "utf8"), previous);
  assert.equal(
    JSON.parse(fs.readFileSync(latest, "utf8")).observations[0].temp,
    25,
  );
});
test("legacy import verifies raw timestamp and preserves original file", (t) => {
  const config = temporary(t);
  const content = JSON.stringify([
    { temp: 10, created_at: new Date().toISOString() },
    { created_at: new Date().toISOString(), raw_data: payload() },
  ]);
  fs.writeFileSync(config.legacyPath, content);
  const repo = new Repository(config);
  t.after(() => repo.close());
  assert.equal(repo.health.legacy_imported, 1);
  assert.equal(repo.health.legacy_rejected, 1);
  assert.equal(repo.latest().source, "legacy-verified");
  assert.equal(fs.readFileSync(config.legacyPath, "utf8"), content);
});
test("damaged database restores snapshot and preserves damaged bytes", async (t) => {
  const config = temporary(t),
    row = fixture();
  const first = new Repository(config);
  await first.save(row);
  first.close();
  const damaged = path.join(config.dataDir, "observations.sqlite");
  fs.writeFileSync(damaged, "damaged-test-file");
  const second = new Repository(config);
  assert.equal(second.health.recovered, true);
  assert.equal(second.latest().temp, row.temp);
  assert.equal(fs.readFileSync(damaged, "utf8"), "damaged-test-file");
  await second.save(fixture({ temp: 27 }));
  const recoveryFile = second.dbPath;
  second.close();
  const third = new Repository(config);
  t.after(() => third.close());
  assert.equal(third.dbPath, recoveryFile);
  assert.equal(third.latest().temp, 27);
});
test("retention preserves last valid station value and unsent observations", async (t) => {
  const config = temporary(t),
    repo = new Repository(config);
  t.after(() => repo.close());
  const old = new Date(Date.now() - 60 * 86400000).toISOString();
  await repo.save(fixture({ station_id: "OLD", observed_at: old }), false);
  await repo.save(fixture({ observed_at: old }), true);
  await repo.save(fixture());
  assert.ok(repo.latest("OLD"));
  assert.equal(repo.pendingCount(), 1);
});
test("historical range is half open and station specific", async (t) => {
  const config = temporary(t),
    repo = new Repository(config);
  t.after(() => repo.close());
  const time = Date.now() - 600000;
  await repo.save(fixture({ observed_at: new Date(time).toISOString() }));
  await repo.save(
    fixture({ station_id: "OTHER", observed_at: new Date(time).toISOString() }),
  );
  assert.equal(repo.history("TEST", time, time + 1).length, 1);
  assert.equal(repo.history("TEST", time - 1, time).length, 0);
});
