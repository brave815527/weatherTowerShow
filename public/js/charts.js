"use strict";
window.WeatherChart = class {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.compact = compact;
    this.chart = null;
  }
  clear() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
  render(payload, key, windUnit) {
    const M = WeatherModel,
      rows = payload.observations || [],
      interval = payload.expected_interval_seconds || 300;
    const start = Date.parse(payload.range.start),
      end = Date.parse(payload.range.end);
    const definitions = {
      temp: ["氣溫趨勢", "°C", "temp", "#fb7185"],
      humidity: ["相對濕度", "%", "humidity", "#60a5fa"],
      wind: [
        "風速與陣風",
        windUnit === "kmh" ? "km/h" : "m/s",
        "wind_speed",
        "#4ade80",
      ],
      direction: ["風向分布", "°", "wind_dir", "#4ade80"],
      pressure: ["海平面氣壓", "hPa", "pressure", "#c4b5fd"],
      rain: ["十分鐘雨量", "mm", "precip_total", "#22d3ee"],
    };
    const [title, unit, field, color] = definitions[key];
    const multiplier = key === "wind" && windUnit === "kmh" ? 3.6 : 1;
    const mainPoints =
      key === "rain"
        ? M.rainBins(rows, start, Math.min(end, Date.now()), interval)
        : M.pointsWithGaps(rows, field, interval).map((point) => ({
            x: point.x,
            y: point.y === null ? null : point.y * multiplier,
          }));
    const datasets = [
      {
        label:
          key === "rain"
            ? "完整區間雨量"
            : key === "direction"
              ? "觀測風向"
              : payload.source === "demo"
                ? "示範序列"
                : "實際觀測",
        data: mainPoints,
        borderColor: color,
        backgroundColor: key === "rain" ? "#22d3eeaa" : color,
        borderWidth: this.compact ? 4 : 3,
        tension: 0,
        pointRadius: key === "direction" ? 3 : 0,
        showLine: key !== "direction",
        spanGaps: false,
      },
    ];
    if (key === "temp")
      datasets.push({
        label: "露點",
        data: M.pointsWithGaps(rows, "dewpt", interval),
        borderColor: "#7dd3fc",
        borderWidth: this.compact ? 3 : 2,
        borderDash: [6, 5],
        pointRadius: 0,
        tension: 0,
        spanGaps: false,
      });
    if (key === "wind")
      datasets.push({
        label: "陣風",
        data: M.pointsWithGaps(rows, "wind_gust", interval).map((point) => ({
          x: point.x,
          y: point.y === null ? null : point.y * multiplier,
        })),
        borderColor: "#fbbf77",
        backgroundColor: "#fbbf77",
        showLine: false,
        pointRadius: 3,
        spanGaps: false,
      });
    const type = key === "rain" ? "bar" : "line";
    const options = {
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      devicePixelRatio: 1,
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          type: "linear",
          min: start,
          max: end,
          grid: { display: false },
          border: { display: false },
          ...(this.compact
            ? {
                afterBuildTicks: (axis) => {
                  axis.ticks = Array.from({ length: 4 }, (_, index) => ({
                    value: start + ((end - start) * index) / 3,
                  }));
                },
              }
            : {}),
          ticks: {
            color: this.compact ? "#d3dfef" : "#859ab7",
            font: { family: "Noto Sans TC", size: this.compact ? 22 : 19 },
            maxRotation: 0,
            maxTicksLimit: this.compact ? 4 : 7,
            autoSkip: !this.compact,
            callback: (value) =>
              M.timeLabel(
                Number(value),
                !this.compact && M.dateKey(start) !== M.dateKey(end - 1),
              ),
          },
        },
        y: {
          ...(key === "humidity"
            ? { min: 0, max: 100 }
            : key === "direction"
              ? { min: 0, max: 360 }
              : key === "wind" || key === "rain"
                ? { beginAtZero: true }
                : { grace: "15%" }),
          grid: { color: "#26334a" },
          border: { display: false },
          ticks: {
            color: this.compact ? "#d3dfef" : "#859ab7",
            font: { family: "Noto Sans TC", size: this.compact ? 22 : 19 },
            maxTicksLimit: this.compact ? 4 : 5,
            precision: key === "direction" ? 0 : 1,
            callback: (value) => (key === "direction" ? `${value}°` : value),
          },
        },
      },
    };
    if (typeof Chart !== "function") throw new Error("CHART_UNAVAILABLE");
    if (this.chart && this.chart.config.type === type) {
      this.chart.data.datasets = datasets;
      this.chart.options = options;
      this.chart.update("none");
    } else {
      this.clear();
      this.canvas.width = this.canvas.parentElement.clientWidth;
      this.canvas.height = this.canvas.parentElement.clientHeight;
      this.chart = new Chart(this.canvas, {
        type,
        data: { datasets },
        options,
      });
    }
    const stats = M.statistics(rows, field),
      labels = [];
    if (key === "direction") {
      const mean = M.circularMean(rows);
      labels.push([
        "主向（圓形平均）",
        mean === null
          ? "無明確主向"
          : `${M.direction(mean)} ${Math.round(mean)}°`,
      ]);
    } else if (key === "rain") {
      const totals = rows.filter((row) => M.number(row.precip_total) !== null);
      const last = totals.at(-1);
      labels.push(
        ["當日累積", last ? `${M.format(last.precip_total)} mm` : "—"],
        [
          "有效區間",
          `${mainPoints.filter((point) => point.y !== null).length} 段`,
        ],
      );
    } else {
      labels.push(
        [
          "最低",
          stats.min === null
            ? "—"
            : `${M.format(stats.min * multiplier)} ${unit}`,
        ],
        [
          "樣本平均",
          stats.average === null
            ? "—"
            : `${M.format(stats.average * multiplier)} ${unit}`,
        ],
        [
          "最高",
          stats.max === null
            ? "—"
            : `${M.format(stats.max * multiplier)} ${unit}`,
        ],
      );
    }
    return {
      title,
      unit,
      labels,
      legend: datasets.map((dataset) => [dataset.label, dataset.borderColor]),
      hasData: datasets.some((dataset) =>
        dataset.data.some((point) => point.y !== null),
      ),
      note:
        key === "rain"
          ? "缺測、重置與不完整區間不推估"
          : key === "direction"
            ? "散點觀測 · 低風速不列入主向"
            : `${payload.source === "demo" ? "示範序列" : "實際觀測"} · 缺測區段留空`,
    };
  }
};
