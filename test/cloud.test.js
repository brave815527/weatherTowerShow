"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CloudRepository } = require("../src/cloud");
const { temporary, fixture, payload } = require("./helpers");
test("missing v2 table falls back to verified legacy data without writing", async (t) => {
  const config = temporary(t, {
    mode: "playback",
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "test-only-key",
  });
  let writes = 0;
  const cloud = new CloudRepository(config, async (url, options) => {
    if (options.method && options.method !== "GET") writes++;
    if (String(url).includes("weather_observations_v2"))
      return new Response(
        JSON.stringify({ code: "PGRST205", message: "missing" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    return new Response(
      JSON.stringify([
        { created_at: new Date().toISOString(), raw_data: payload() },
      ]),
      { headers: { "content-type": "application/json" } },
    );
  });
  const row = await cloud.latest("TEST", AbortSignal.timeout(1000));
  assert.equal(row.wind_speed, 2);
  assert.equal(cloud.health.migration_required, true);
  assert.equal(writes, 0);
});
test("new and old real history are merged when new table already exists", async (t) => {
  const row = fixture(),
    config = temporary(t, {
      mode: "playback",
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "test-only-key",
    });
  const cloud = new CloudRepository(
    config,
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("weather_observations_v2")
            ? [row]
            : [
                {
                  created_at: new Date().toISOString(),
                  raw_data: payload({
                    obsTimeUtc: new Date(Date.now() - 120000).toISOString(),
                  }),
                },
              ],
        ),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const history = await cloud.history(
    "TEST",
    Date.now() - 3600000,
    Date.now(),
    AbortSignal.timeout(1000),
  );
  assert.equal(history.length, 2);
});

test("legacy failure preserves v2 history and leaves uploads available", async (t) => {
  const row = fixture();
  const config = temporary(t, {
    mode: "playback",
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "test-only-key",
  });
  const cloud = new CloudRepository(config, async (url, options) => {
    if (!String(url).includes("weather_observations_v2"))
      throw new Error("legacy request timed out");
    return new Response(
      JSON.stringify(options.method === "POST" ? null : [row]),
      {
        headers: { "content-type": "application/json" },
      },
    );
  });
  const history = await cloud.history(
    "TEST",
    Date.now() - 3600000,
    Date.now(),
    AbortSignal.timeout(1000),
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].observed_at, row.observed_at);
  assert.equal(cloud.health.state, "ready");
  assert.equal(cloud.health.legacy_history_unavailable, true);
  assert.equal(await cloud.upload([row], AbortSignal.timeout(1000)), true);
});
