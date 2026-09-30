"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../public/js/model");
const { fixture, payload } = require("./helpers");
test("missing, boolean and invalid numbers never become zero", () => {
  for (const value of [
    null,
    undefined,
    "",
    " ",
    false,
    true,
    NaN,
    Infinity,
    "oops",
    {},
  ])
    assert.equal(M.number(value), null);
  assert.equal(M.number(0), 0);
  assert.equal(M.format(null), "—");
});
test("Weather metric wind converts km/h to m/s once", () => {
  const row = M.fromWeather(payload());
  assert.equal(row.wind_speed, 2);
  assert.equal(row.wind_gust, 4);
  assert.equal(row.precip_total, 1);
});
test("out of range fields are isolated and flagged as suspect", () => {
  const row = M.normalize(
    fixture({ humidity: 140, pressure: "invalid", temp: 25 }),
  );
  assert.equal(row.humidity, null);
  assert.equal(row.pressure, null);
  assert.equal(row.temp, 25);
  assert.equal(row.quality, "suspect");
});
test("SI winds are not converted twice", () => {
  const data = payload();
  data.observations[0].metric_si = {
    ...data.observations[0].metric,
    windSpeed: 2,
    windGust: 4,
  };
  assert.equal(M.fromWeather(data).wind_speed, 2);
});
test("observation time is required and never replaced by ingestion time", () => {
  assert.equal(M.fromWeather(payload({ obsTimeUtc: null })), null);
  assert.equal(M.fromWeather({ observations: [] }), null);
  assert.equal(M.fromWeather(payload({ epoch: 1e30, obsTimeUtc: null })), null);
});
test("future, unknown-source and all-null records are rejected", () => {
  assert.equal(
    M.normalize(
      fixture({ observed_at: new Date(Date.now() + 600000).toISOString() }),
    ),
    null,
  );
  assert.equal(M.normalize(fixture({ source: "unknown" })), null);
  assert.equal(
    M.normalize(
      fixture(
        Object.fromEntries(Object.keys(M.fields).map((key) => [key, null])),
      ),
    ),
    null,
  );
});
test("partial missing and unrealistic fields remain local to their metric", () => {
  const row = M.normalize(
    fixture({ pressure: 99999, humidity: null, dewpt: 40 }),
  );
  assert.equal(row.pressure, null);
  assert.equal(row.humidity, null);
  assert.equal(row.dewpt, null);
  assert.equal(row.temp, 25.2);
  assert.equal(row.quality, "suspect");
});
test("old observations stay stale after a successful new fetch", () => {
  const row = fixture({
    observed_at: new Date(Date.now() - 3600000).toISOString(),
    fetched_at: new Date().toISOString(),
  });
  assert.equal(M.freshness(row).state, "offline");
});
test("state distinguishes demo, suspect, missing and disconnected", () => {
  assert.equal(M.freshness(fixture({ source: "demo" })).state, "demo");
  assert.equal(M.freshness(fixture({ quality: "suspect" })).state, "suspect");
  assert.equal(M.freshness(null).state, "empty");
  assert.equal(M.freshness(fixture(), Date.now(), false).state, "offline");
});
test("wind direction wraps north instead of averaging south", () => {
  const result = M.circularMean([
    { wind_dir: 359, wind_speed: 2 },
    { wind_dir: 1, wind_speed: 2 },
  ]);
  assert.ok(Math.min(result, 360 - result) < 0.01);
  assert.equal(
    M.circularMean([
      { wind_dir: 90, wind_speed: 2 },
      { wind_dir: 270, wind_speed: 2 },
    ]),
    null,
  );
  assert.equal(M.circularMean([{ wind_dir: 90, wind_speed: 0 }]), null);
});
test("all missing statistics have no extrema or mean", () => {
  assert.deepEqual(M.statistics([{ temp: null }], "temp"), {
    min: null,
    max: null,
    average: null,
    count: 0,
  });
});
test("time gaps keep real spacing and insert a null break", () => {
  const rows = [
    fixture({ observed_at: "2026-01-01T00:00:00Z" }),
    fixture({ observed_at: "2026-01-01T01:00:00Z" }),
  ];
  const points = M.pointsWithGaps(rows, "temp", 60);
  assert.equal(points.length, 3);
  assert.equal(points[1].y, null);
  assert.equal(points[2].x - points[0].x, 3600000);
});
function rainRows(values, start) {
  return values.map((value, index) => ({
    observed_at: new Date(start + index * 300000).toISOString(),
    precip_total: value,
  }));
}
test("rain missing intervals do not create a false spike", () => {
  const start = Date.parse("2026-01-01T02:00:00Z");
  assert.equal(
    M.rainBins(rainRows([2, null, 2.2], start), start, start + 600000, 300)[0]
      .y,
    null,
  );
});
test("complete dry and wet rain bins keep real zero and increments", () => {
  const start = Date.parse("2026-01-01T02:00:00Z");
  assert.equal(
    M.rainBins(rainRows([2, 2, 2], start), start, start + 600000, 300)[0].y,
    0,
  );
  assert.ok(
    Math.abs(
      M.rainBins(rainRows([2, 2.1, 2.2], start), start, start + 600000, 300)[0]
        .y - 0.2,
    ) < 1e-10,
  );
});
test("midnight resets, counter corrections and uncovered bins are null", () => {
  const start = Date.parse("2026-01-01T15:50:00Z");
  assert.equal(
    M.rainBins(rainRows([5, 5, 0], start), start, start + 600000, 300)[0].y,
    null,
  );
  assert.equal(
    M.rainBins(rainRows([5, 4, 4.1], start), start, start + 600000, 300)[0].y,
    null,
  );
  assert.equal(M.rainBins([], start, start + 600000, 300)[0].y, null);
});
test("Taipei dates are independent of the process timezone", () => {
  assert.equal(M.dateKey("2026-01-01T16:00:00Z"), "2026-01-02");
  assert.match(M.timeLabel("2026-01-01T16:00:00Z"), /00:00/);
});
