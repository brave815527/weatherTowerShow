"use strict";
(function () {
  const M = WeatherModel,
    params = new URLSearchParams(location.search);
  const layouts = {
    wall: [600, 640],
    full: [1920, 1080],
    sidebar: [480, 1080],
    ticker: [1920, 180],
  };
  const layout = Object.hasOwn(layouts, params.get("layout"))
    ? params.get("layout")
    : "full";
  const windUnit = params.get("windUnit") === "kmh" ? "kmh" : "ms",
    demo = params.get("demo") === "true";
  const theme =
    params.get("theme") === "transparent" || params.get("obs") === "true"
      ? "transparent"
      : "dark";
  const allowedCharts = [
      "temp",
      "humidity",
      "wind",
      "direction",
      "pressure",
      "rain",
    ],
    selectedChart = allowedCharts.includes(params.get("chart"))
      ? params.get("chart")
      : "temp";
  const cycling =
      params.get("chart") === "cycle" && ["full", "wall"].includes(layout),
    cycleSeconds = [7.5, 15, 20, 30].includes(Number(params.get("cycle")))
      ? Number(params.get("cycle"))
      : 7.5;
  const hours = [6, 12, 24].includes(Number(params.get("hours")))
    ? Number(params.get("hours"))
    : layout === "wall"
      ? 6
      : 12;
  const replayDate = params.get("date") || "",
    station = params.get("station") || "";
  const stage = document.getElementById("stage");
  stage.className = `stage layout-${layout}`;
  document.body.classList.add(`theme-${theme}`);
  document.documentElement.classList.add(`theme-${theme}`);
  stage.style.width = `${layouts[layout][0]}px`;
  stage.style.height = `${layouts[layout][1]}px`;
  function resize() {
    stage.style.setProperty(
      "--stage-scale",
      Math.min(
        innerWidth / layouts[layout][0],
        innerHeight / layouts[layout][1],
      ),
    );
  }
  addEventListener("resize", resize);
  resize();
  const definitions = [
    ["temp", "氣溫", "°C", "#fb7185", -10, 45],
    ["humidity", "相對濕度", "%", "#60a5fa", 0, 100],
    [
      "wind_speed",
      "風速／風向",
      windUnit === "kmh" ? "km/h" : "m/s",
      "#4ade80",
      0,
      15,
    ],
    ["precip_total", "今日累積雨量", "mm", "#22d3ee", 0, 100],
    ["pressure", "海平面氣壓", "hPa", "#c4b5fd", 960, 1040],
    ["dewpt", "露點溫度", "°C", "#7dd3fc", -10, 35],
  ];
  const nodes = new Map();
  for (const [key, title, unit, color, min, max] of definitions) {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.dataset.metric = key;
    card.style.setProperty("--metric-color", color);
    card.innerHTML = `<div class="metric-top"><h2 class="metric-label"></h2><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WeatherIcons[key]}</svg></div><div class="metric-value-row"><span class="metric-value">—</span><span class="metric-unit"></span></div><div class="metric-sub">等待觀測</div><div class="metric-track" aria-hidden="true"><span></span></div>`;
    card.querySelector(".metric-label").textContent = title;
    card.querySelector(".metric-unit").textContent = unit;
    document.getElementById("metrics").append(card);
    nodes.set(key, {
      card,
      value: card.querySelector(".metric-value"),
      sub: card.querySelector(".metric-sub"),
      min,
      max,
    });
  }
  const chart = ["full", "wall"].includes(layout)
    ? new WeatherChart(document.getElementById("trend-chart"), {
        compact: layout === "wall",
      })
    : null;
  let observation = null,
    reachable = true,
    history = null,
    chartKey = selectedChart,
    polling = 60000,
    closed = false,
    requestController = null,
    chartBusy = false,
    latestBusy = false;
  const controllers = new Set();
  function apiQuery(extra = {}) {
    const query = new URLSearchParams({ demo: String(demo), ...extra });
    if (station) query.set("station", station);
    return query;
  }
  async function getJson(url, signal) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    if (signal)
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("REQUEST_FAILED");
      const body = await response.json();
      if (body.version !== 2) throw new Error("INVALID_RESPONSE");
      return body;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function renderValues() {
    for (const [key] of definitions) {
      const node = nodes.get(key),
        value = M.number(observation?.[key]);
      const shown =
        value === null
          ? null
          : key === "wind_speed" && windUnit === "kmh"
            ? value * 3.6
            : value;
      node.value.textContent = M.format(shown, key === "humidity" ? 0 : 1);
      node.card.dataset.missing = String(value === null);
      node.card.style.setProperty(
        "--metric-progress",
        `${value === null ? 0 : Math.max(0, Math.min(100, ((value - node.min) * 100) / (node.max - node.min)))}%`,
      );
      if (value === null) {
        node.sub.textContent = "此項觀測未提供";
        if (key === "wind_speed")
          node.card.querySelector(".wind-needle").style.opacity = "0";
        continue;
      }
      if (key === "temp") node.sub.textContent = demo ? "示範氣溫" : "實際氣溫";
      if (key === "humidity") node.sub.textContent = "空氣相對濕度";
      if (key === "dewpt") node.sub.textContent = "空氣飽和時的溫度";
      if (key === "pressure") node.sub.textContent = "海平面校正";
      if (key === "precip_total")
        node.sub.textContent = `雨強 ${M.format(observation?.precip_rate)} mm/h`;
      if (key === "wind_speed") {
        const gust = M.number(observation?.wind_gust);
        const bearing = M.number(observation?.wind_dir, 0, 360);
        const needle = node.card.querySelector(".wind-needle");
        needle.setAttribute("transform", `rotate(${bearing ?? 0} 12 12)`);
        needle.style.opacity = bearing === null || value < 0.3 ? "0" : "1";
        const dir = value < 0.3 ? "靜風" : M.direction(observation?.wind_dir);
        node.sub.textContent = `${dir} · 陣風 ${M.format(gust === null ? null : gust * (windUnit === "kmh" ? 3.6 : 1))}${layout === "ticker" ? "" : ` ${windUnit === "kmh" ? "km/h" : "m/s"}`}`;
      }
    }
    document.getElementById("observation-time").textContent = observation
      ? `觀測 ${M.timeLabel(observation.observed_at, true)}${layout === "wall" ? "" : " · UTC+8"}`
      : "觀測時間 — · UTC+8";
    document.getElementById("source-label").textContent = demo
      ? "示範資料 · 非實測 · 不代表現場天氣"
      : replayDate
        ? `歷史回放 ${replayDate} · 缺測不推估`
        : observation
          ? "資料來源 Weather Company / PWS"
          : "尚無有效觀測 · 請在工作台確認資料來源";
    document.getElementById("station-code").textContent =
      `${demo ? "DEMO" : observation?.station_id || station || "—"} / UTC+8`;
    updateStatus();
  }
  function updateStatus() {
    const state = M.freshness(observation, Date.now(), reachable);
    const pill = document.getElementById("status-pill");
    pill.dataset.state = demo ? "demo" : replayDate ? "replay" : state.state;
    document.getElementById("status-label").textContent = demo
      ? "示範資料 · 非實測"
      : replayDate
        ? `歷史回放 · ${replayDate}`
        : `${state.label}${layout === "wall" && ["stale", "offline"].includes(state.state) && state.age_seconds !== null ? ` · ${Math.floor(state.age_seconds / 60)} 分鐘前` : ""}`;
    document.getElementById("observation-age").textContent = demo
      ? "僅供播出版面預覽"
      : replayDate
        ? "顯示該日最後一筆有效觀測"
        : state.age_seconds === null
          ? "等待有效資料，不以模擬值替代"
          : `${Math.floor(state.age_seconds / 60)} 分鐘前${reachable ? "" : " · 保留最後有效觀測"}`;
    document.body.dataset.dataState = pill.dataset.state;
  }
  function renderChart() {
    if (closed || !chart || !history) return;
    const message = document.getElementById("chart-message");
    document.getElementById("trend-range").textContent =
      `${layout === "wall" ? (replayDate ? `${replayDate} · 回放` : `近 ${hours} 小時 · UTC+8`) : history.range.label}${demo ? " · 示範" : ""}${replayDate && layout !== "wall" ? " · 歷史回放" : ""}`;
    try {
      const output = chart.render(history, chartKey, windUnit);
      const heading = document.getElementById("trend-title");
      heading.replaceChildren(document.createTextNode(output.title));
      const unit = document.createElement("span");
      unit.className = "trend-unit";
      unit.textContent = output.unit;
      heading.append(unit);
      const stats = document.getElementById("trend-stats");
      stats.replaceChildren();
      for (const [label, value] of output.labels) {
        const node = document.createElement("div");
        node.className = "trend-stat";
        const name = document.createElement("span"),
          number = document.createElement("strong");
        name.textContent = label;
        number.textContent = value;
        node.append(name, number);
        stats.append(node);
      }
      const legend = document.getElementById("trend-legend");
      legend.replaceChildren();
      for (const [label, color] of output.legend) {
        const item = document.createElement("span");
        item.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.setProperty("--legend-color", color);
        item.append(swatch, document.createTextNode(label));
        legend.append(item);
      }
      document.getElementById("trend-note").textContent = history.degraded
        ? "本機備援 · 缺測區段留空"
        : output.note;
      message.hidden = output.hasData;
      message.textContent = "此時段沒有有效觀測紀錄";
    } catch {
      message.hidden = false;
      message.textContent = "趨勢圖暫時無法顯示";
    }
  }
  async function refreshHistory() {
    if (closed || (!chart && !replayDate) || chartBusy) return;
    chartBusy = true;
    try {
      const payload = await getJson(
        `/api/weather/history?${apiQuery(replayDate ? { date: replayDate } : { hours: String(hours) })}`,
      );
      if (closed) return;
      if (!Array.isArray(payload.observations) || !payload.range)
        throw new Error("INVALID_HISTORY");
      history = payload;
      if (replayDate && payload.station_name)
        document.getElementById("station-name").textContent =
          payload.station_name;
      if (replayDate) {
        observation =
          payload.observations
            .map((row) => M.normalize(row))
            .filter(Boolean)
            .at(-1) || null;
        reachable = true;
        renderValues();
      }
      renderChart();
    } catch {
      if (closed) return;
      if (replayDate) {
        observation = null;
        renderValues();
      }
      if (chart) {
        document.getElementById("chart-message").hidden = false;
        document.getElementById("chart-message").textContent =
          "歷史資料暫時無法取得";
        document.getElementById("trend-note").textContent = "資料未更新";
      }
    } finally {
      chartBusy = false;
    }
  }
  async function refreshLatest() {
    if (closed || replayDate || latestBusy) return;
    latestBusy = true;
    requestController = new AbortController();
    try {
      const payload = await getJson(
        `/api/weather/latest?${apiQuery()}`,
        requestController.signal,
      );
      if (closed) return;
      if (payload.observation !== null && !M.normalize(payload.observation))
        throw new Error("INVALID_OBSERVATION");
      if (payload.observation) observation = M.normalize(payload.observation);
      reachable = Boolean(payload.observation);
      polling = Math.max(
        30000,
        Math.min(3600000, (payload.poll_seconds || 60) * 1000),
      );
      document.getElementById("station-name").textContent =
        payload.station_name || "氣象觀測站";
      renderValues();
    } catch {
      if (closed) return;
      reachable = false;
      renderValues();
    } finally {
      latestBusy = false;
    }
  }
  let latestTimer, historyTimer, cycleTimer;
  async function latestLoop() {
    await refreshLatest();
    if (!closed && !replayDate) latestTimer = setTimeout(latestLoop, polling);
  }
  async function historyLoop() {
    await refreshHistory();
    if (!closed) historyTimer = setTimeout(historyLoop, 300000);
  }
  renderValues();
  latestLoop();
  historyLoop();
  if (replayDate)
    document.getElementById("station-name").textContent = demo
      ? "吉安氣象觀測站 · 示範"
      : "氣象觀測歷史回放";
  const ageTimer = setInterval(updateStatus, 10000);
  function scheduleCycle() {
    clearInterval(cycleTimer);
    if (!closed && cycling && !document.hidden)
      cycleTimer = setInterval(() => {
        const cycleCharts =
          layout === "wall"
            ? ["temp", "wind", "rain", "pressure"]
            : allowedCharts;
        chartKey =
          cycleCharts[(cycleCharts.indexOf(chartKey) + 1) % cycleCharts.length];
        renderChart();
      }, cycleSeconds * 1000);
  }
  scheduleCycle();
  document.addEventListener("visibilitychange", () => {
    scheduleCycle();
    if (!document.hidden) {
      if (!replayDate) refreshLatest();
      refreshHistory();
    }
  });
  addEventListener("pagehide", () => {
    closed = true;
    clearTimeout(latestTimer);
    clearTimeout(historyTimer);
    clearInterval(cycleTimer);
    clearInterval(ageTimer);
    for (const controller of controllers) controller.abort();
    chart?.clear();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted && closed) location.reload();
  });
  if (document.fonts?.ready)
    document.fonts.ready.then(() => {
      if (!closed) renderChart();
    });
})();
