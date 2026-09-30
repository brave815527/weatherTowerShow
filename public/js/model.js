(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WeatherModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const fields = {
    temp: [-90, 65],
    dewpt: [-100, 65],
    humidity: [0, 100],
    wind_speed: [0, 150],
    wind_gust: [0, 150],
    wind_dir: [0, 360],
    pressure: [800, 1100],
    precip_total: [0, 3000],
    precip_rate: [0, 2000],
  };
  const units = {
    temp: "°C",
    dewpt: "°C",
    humidity: "%",
    wind_speed: "m/s",
    wind_gust: "m/s",
    wind_dir: "°",
    pressure: "hPa",
    precip_total: "mm",
    precip_rate: "mm/h",
  };
  function number(value, min = -Infinity, max = Infinity) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      typeof value === "boolean"
    )
      return null;
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }
  function dateKey(value) {
    const n = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(n)
      ? new Date(n + 8 * 3600000).toISOString().slice(0, 10)
      : null;
  }
  function timeLabel(value, withDate = false) {
    if (!Number.isFinite(typeof value === "number" ? value : Date.parse(value)))
      return "—";
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      ...(withDate ? { month: "2-digit", day: "2-digit" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  }
  function timestamp(value) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }
  function normalize(input, now = Date.now()) {
    if (
      !input ||
      typeof input !== "object" ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(input.station_id || "") ||
      !["weather-api", "cloud", "legacy-verified", "demo"].includes(
        input.source,
      )
    )
      return null;
    const observed = timestamp(input.observed_at),
      fetched = timestamp(input.fetched_at);
    if (!observed || !fetched || Date.parse(observed) > now + 120000)
      return null;
    const result = {
      station_id: input.station_id,
      observed_at: observed,
      fetched_at: fetched,
      source: ["weather-api", "cloud", "legacy-verified", "demo"].includes(
        input.source,
      )
        ? input.source
        : "cloud",
      quality: ["passed", "suspect", "unchecked"].includes(input.quality)
        ? input.quality
        : "unchecked",
      expected_interval_seconds:
        number(input.expected_interval_seconds, 30, 3600) || 300,
    };
    for (const [field, range] of Object.entries(fields)) {
      result[field] = number(input[field], ...range);
      if (
        result[field] === null &&
        input[field] !== null &&
        input[field] !== undefined &&
        input[field] !== ""
      )
        result.quality = "suspect";
    }
    if (result.wind_dir === 360) result.wind_dir = 0;
    if (
      result.dewpt !== null &&
      result.temp !== null &&
      result.dewpt > result.temp + 0.5
    ) {
      result.dewpt = null;
      result.quality = "suspect";
    }
    if (
      result.wind_gust !== null &&
      result.wind_speed !== null &&
      result.wind_gust < result.wind_speed
    ) {
      result.wind_gust = null;
      result.quality = "suspect";
    }
    return Object.keys(fields).some((field) => result[field] !== null)
      ? result
      : null;
  }
  function fromWeather(
    payload,
    fetchedAt = new Date().toISOString(),
    defaultInterval = 300,
  ) {
    const obs = payload?.observations?.[0];
    if (!obs) return null;
    const metric = obs.metric_si || obs.metric;
    if (!metric) return null;
    const factor = obs.metric_si ? 1 : 1 / 3.6;
    const speed = number(metric.windSpeed, 0, 540),
      gust = number(metric.windGust, 0, 540);
    return normalize(
      {
        station_id: obs.stationID,
        observed_at:
          obs.obsTimeUtc ||
          (number(obs.epoch, 0, 4102444800) !== null
            ? new Date(Number(obs.epoch) * 1000).toISOString()
            : null),
        fetched_at: fetchedAt,
        source: "weather-api",
        quality:
          obs.qcStatus === 1
            ? "passed"
            : obs.qcStatus === 0
              ? "suspect"
              : "unchecked",
        expected_interval_seconds:
          number(obs.realtimeFrequency, 0.5, 60) !== null
            ? Number(obs.realtimeFrequency) * 60
            : defaultInterval,
        temp: metric.temp,
        dewpt: metric.dewpt,
        humidity: obs.humidity,
        wind_speed: speed === null ? null : speed * factor,
        wind_gust: gust === null ? null : gust * factor,
        wind_dir: obs.winddir,
        pressure: metric.pressure,
        precip_total: metric.precipTotal,
        precip_rate: metric.precipRate,
      },
      Date.parse(fetchedAt),
    );
  }
  function freshness(obs, now = Date.now(), reachable = true) {
    if (!obs) return { state: "empty", label: "尚無觀測", age_seconds: null };
    if (obs.source === "demo")
      return {
        state: "demo",
        label: "示範資料",
        age_seconds: Math.max(0, (now - Date.parse(obs.observed_at)) / 1000),
      };
    const age = Math.max(0, (now - Date.parse(obs.observed_at)) / 1000),
      interval = obs.expected_interval_seconds || 300;
    if (!reachable || age > Math.max(600, interval * 6))
      return {
        state: "offline",
        label: reachable ? "暫停更新" : "連線中斷",
        age_seconds: age,
      };
    if (age > Math.max(180, interval * 2.5))
      return { state: "stale", label: "資料延遲", age_seconds: age };
    if (obs.quality === "suspect")
      return { state: "suspect", label: "品質待確認", age_seconds: age };
    return {
      state: "fresh",
      label: obs.quality === "unchecked" ? "更新正常 · 未經品管" : "更新正常",
      age_seconds: age,
    };
  }
  function format(value, digits = 1) {
    return number(value) === null ? "—" : Number(value).toFixed(digits);
  }
  function direction(degrees) {
    if (number(degrees) === null) return "—";
    return [
      "北",
      "北北東",
      "東北",
      "東北東",
      "東",
      "東南東",
      "東南",
      "南南東",
      "南",
      "南南西",
      "西南",
      "西南西",
      "西",
      "西北西",
      "西北",
      "北北西",
    ][Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
  }
  function circularMean(rows) {
    const valid = rows.filter(
      (row) =>
        number(row.wind_dir, 0, 360) !== null &&
        number(row.wind_speed, 0.3, 150) !== null,
    );
    if (!valid.length) return null;
    const x = valid.reduce(
        (sum, row) => sum + Math.cos((row.wind_dir * Math.PI) / 180),
        0,
      ),
      y = valid.reduce(
        (sum, row) => sum + Math.sin((row.wind_dir * Math.PI) / 180),
        0,
      );
    if (Math.hypot(x, y) / valid.length < 0.1) return null;
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  function statistics(rows, field) {
    const values = rows
      .map((row) => number(row[field]))
      .filter((value) => value !== null);
    return {
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      average: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      count: values.length,
    };
  }
  function pointsWithGaps(rows, field, interval = 300) {
    const sorted = [...rows].sort(
        (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
      ),
      points = [];
    sorted.forEach((row, index) => {
      const x = Date.parse(row.observed_at),
        previous = sorted[index - 1];
      if (previous && x - Date.parse(previous.observed_at) > interval * 2500)
        points.push({
          x: Date.parse(previous.observed_at) + interval * 1000,
          y: null,
        });
      points.push({ x, y: number(row[field]) });
    });
    return points;
  }
  function rainBins(rows, start, end, interval = 300, binMinutes = 10) {
    const step = binMinutes * 60000,
      bins = new Map();
    for (let t = Math.floor(start / step) * step; t < end; t += step)
      bins.set(t, { x: t + step / 2, value: 0, covered: 0, invalid: false });
    const sorted = [...rows].sort(
      (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
    );
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1],
        b = sorted[i],
        t0 = Date.parse(a.observed_at),
        t1 = Date.parse(b.observed_at);
      if (t1 < start || t0 >= end || t1 <= t0) continue;
      const valid =
        number(a.precip_total) !== null &&
        number(b.precip_total) !== null &&
        b.precip_total >= a.precip_total &&
        dateKey(t0) === dateKey(t1) &&
        t1 - t0 <= interval * 2500;
      const key = Math.floor((t1 - 1) / step) * step,
        bin = bins.get(key);
      if (!bin) continue;
      const bucketStart = Math.max(start, key);
      // Do not distribute a measured interval across buckets or infer missing rain.
      if (!valid || t0 < bucketStart - 1000) {
        bin.invalid = true;
        continue;
      }
      bin.value += b.precip_total - a.precip_total;
      bin.covered += Math.max(0, Math.min(end, t1) - Math.max(start, t0));
    }
    return [...bins.entries()].map(([key, bin]) => ({
      x: bin.x,
      y:
        !bin.invalid &&
        bin.covered >= Math.min(end, key + step) - Math.max(start, key) - 1000
          ? bin.value
          : null,
    }));
  }
  return {
    fields,
    units,
    number,
    dateKey,
    timeLabel,
    normalize,
    fromWeather,
    freshness,
    format,
    direction,
    circularMean,
    statistics,
    pointsWithGaps,
    rainBins,
  };
});
