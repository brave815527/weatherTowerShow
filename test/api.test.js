"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApplication, queryRange } = require("../src/app");
const { loadConfig } = require("../src/config");
const { temporary } = require("./helpers");
test("startup does not require cloud keys and invalid live config fails clearly", () => {
  assert.equal(loadConfig({ APP_MODE: "offline" }).supabaseKey, "");
  assert.throws(() => loadConfig({ APP_MODE: "live" }), /requires/);
  assert.throws(() => loadConfig({ PORT: "invalid" }));
});
test("calendar validation rejects invalid dates, arrays and future dates", () => {
  for (const date of ["2026-02-30", "oops", ["2026-01-01"], "2100-01-01"])
    assert.throws(() => queryRange({ date }));
  const range = queryRange({ date: "2026-01-01" });
  assert.equal(new Date(range.start).toISOString(), "2025-12-31T16:00:00.000Z");
  assert.equal(range.end - range.start, 86400000);
});
test("recent history is a time range independent of sample count", () => {
  const range = queryRange({ hours: "12" });
  assert.equal(range.end - range.start, 12 * 3600000);
  assert.throws(() => queryRange({ hours: "999" }));
});
test("API demo and empty history are read only; headers and input validation are enforced", async (t) => {
  const runtime = await createApplication(temporary(t));
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await runtime.service.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    runtime.repository.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const latest = await fetch(`${origin}/api/weather/latest`);
  assert.equal((await latest.json()).observation, null);
  assert.equal(latest.headers.get("access-control-allow-origin"), null);
  assert.match(
    latest.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  const history = await fetch(`${origin}/api/weather/history?date=2026-01-01`);
  assert.deepEqual((await history.json()).observations, []);
  const demo = await fetch(`${origin}/api/weather/history?demo=true`);
  const body = await demo.json();
  assert.ok(body.observations.length);
  assert.ok(
    body.observations.every(
      (row) =>
        row.source === "demo" && Date.parse(row.observed_at) <= Date.now(),
    ),
  );
  assert.deepEqual(runtime.repository.stations(), []);
  for (const query of [
    "date=2026-02-30",
    "station=bad%20station",
    "demo=1",
    "hours=100",
    "date=2026-01-01&date=2026-01-02",
  ])
    assert.equal(
      (await fetch(`${origin}/api/weather/history?${query}`)).status,
      400,
    );
  const control = await fetch(`${origin}/control`);
  assert.match(await control.text(), /直播畫面工作台/);
  const overlay = await fetch(`${origin}/overlay?layout=ticker`);
  assert.match(await overlay.text(), /metric/);
  const status = await (await fetch(`${origin}/api/status`)).json();
  assert.equal(status.mode, "offline");
  assert.ok(!JSON.stringify(status).includes("supabaseKey"));
});
