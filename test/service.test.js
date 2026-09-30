"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WeatherService } = require("../src/weather-service");
const { Repository } = require("../src/repository");
const { fetchJson } = require("../src/network");
const { fixture, payload, temporary, disabledCloud } = require("./helpers");
test("collector skips overlapping requests", async (t) => {
  const config = temporary(t, {
      mode: "live",
      weatherUrl: "https://example.test/weather",
    }),
    repo = new Repository(config);
  t.after(() => repo.close());
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = new WeatherService(config, repo, disabledCloud(), {
    fetchImpl: async () => {
      await gate;
      return new Response(JSON.stringify(payload()));
    },
  });
  const first = service.collect();
  assert.equal(await service.collect(), false);
  assert.equal(service.health.skipped_overlaps, 1);
  release();
  assert.equal(await first, true);
});
test("upstream failure retains last valid observation and reports failure", async (t) => {
  const config = temporary(t, {
      mode: "live",
      weatherUrl: "https://example.test/weather",
    }),
    repo = new Repository(config);
  t.after(() => repo.close());
  await repo.save(fixture());
  const service = new WeatherService(config, repo, disabledCloud(), {
    fetchImpl: async () => new Response("", { status: 401 }),
  });
  const old = service.current();
  assert.equal(await service.collect(), false);
  assert.equal(service.current().observed_at, old.observed_at);
  assert.equal(service.health.collector, "unavailable");
});
test("offline mode never invokes external clients", async (t) => {
  const repo = new Repository(temporary(t));
  t.after(() => repo.close());
  const cloud = disabledCloud();
  cloud.latest = () => {
    throw new Error("unexpected request");
  };
  const service = new WeatherService(repo.config, repo, cloud);
  assert.equal(await service.collect(), false);
  assert.equal(
    (await service.history("TEST", Date.now() - 1000, Date.now())).observations
      .length,
    0,
  );
});
test("cloud outage queues records; recovery acknowledges without duplication", async (t) => {
  const config = temporary(t, {
      mode: "live",
      weatherUrl: "https://example.test/weather",
    }),
    repo = new Repository(config);
  t.after(() => repo.close());
  let available = false;
  const cloud = {
    ...disabledCloud(),
    client: {},
    upload: async () => available,
  };
  const data = payload(),
    service = new WeatherService(config, repo, cloud, {
      fetchImpl: async () => new Response(JSON.stringify(data)),
    });
  await service.collect();
  assert.equal(repo.pendingCount(), 1);
  available = true;
  await service.collect();
  assert.equal(repo.pendingCount(), 0);
  assert.equal(
    repo.history("TEST", Date.now() - 86400000, Date.now()).length,
    1,
  );
});
test("history reads merge and cache without persisting remotely read data", async (t) => {
  const config = temporary(t, { mode: "playback" }),
    repo = new Repository(config);
  t.after(() => repo.close());
  let calls = 0;
  const cloud = {
    ...disabledCloud(),
    history: async () => {
      calls++;
      return [fixture()];
    },
  };
  const service = new WeatherService(config, repo, cloud),
    start = Date.now() - 86400000,
    end = Date.now();
  const result = await service.history("TEST", start, end);
  assert.equal(result.observations.length, 1);
  await service.history("TEST", start, end);
  assert.equal(calls, 1);
  assert.deepEqual(repo.stations(), []);
});
test("network timeout includes reading the response body", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
  });
  const fetchImpl = async (url, options) => {
    options.signal.addEventListener(
      "abort",
      () => stream.cancel().catch(() => {}),
      { once: true },
    );
    return {
      ok: true,
      json: () =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
    };
  };
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      fetchJson("https://example.test", {
        fetchImpl,
        timeoutMs: 20,
        retries: 0,
      }),
      /UPSTREAM/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
test("permanent HTTP errors do not retry; transient errors have limited retry", async () => {
  let calls = 0;
  await assert.rejects(
    fetchJson("https://example.test", {
      fetchImpl: async () => {
        calls++;
        return new Response("", { status: 401 });
      },
    }),
  );
  assert.equal(calls, 1);
  calls = 0;
  const data = await fetchJson("https://example.test", {
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ ok: true }), {
        status: calls === 1 ? 503 : 200,
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(data.ok, true);
});
