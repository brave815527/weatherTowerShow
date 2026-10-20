"use strict";
window.WeatherChart = class {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.compact = compact;
    this.chart = null;
    this.meta = null;
    const self = this;
    this.plugin = {
      id: "weatherAnnotations",
      afterDatasetsDraw(chart) {
        const meta = self.meta;
        if (!meta) return;
        const { ctx, chartArea: area, scales } = chart;
        const day = 24 * 60 * 60 * 1000,
          offset = 8 * 60 * 60 * 1000;
        ctx.save();
        ctx.font = `${self.compact ? 14 : 15}px "Noto Sans TC", sans-serif`;
        for (
          let time = Math.ceil((meta.start + offset) / day) * day - offset;
          time < meta.end;
          time += day
        ) {
          if (time <= meta.start) continue;
          const px = scales.x.getPixelForValue(time);
          ctx.strokeStyle = "#8fb3d966";
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(px, area.top);
          ctx.lineTo(px, area.bottom);
          ctx.stroke();
          const date = new Date(time + offset);
          ctx.setLineDash([]);
          ctx.fillStyle = "#a9c0dc";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(
            `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
            px + 6,
            area.top + 2,
          );
        }
        if (meta.extremes) {
          const valid = meta.points.filter((point) => point.y !== null);
          if (valid.length > 2) {
            const high = valid.reduce((a, b) => (b.y > a.y ? b : a)),
              low = valid.reduce((a, b) => (b.y < a.y ? b : a));
            if (high.y !== low.y) {
              ctx.textAlign = "center";
              ctx.fillStyle = meta.color;
              const pad = self.compact ? 38 : 30;
              for (const [point, above] of [
                [high, true],
                [low, false],
              ]) {
                const px = Math.min(
                    Math.max(
                      scales.x.getPixelForValue(point.x),
                      area.left + pad,
                    ),
                    area.right - pad,
                  ),
                  py = scales.y.getPixelForValue(point.y);
                ctx.beginPath();
                ctx.arc(
                  scales.x.getPixelForValue(point.x),
                  py,
                  self.compact ? 3 : 3.5,
                  0,
                  Math.PI * 2,
                );
                ctx.fill();
                ctx.textBaseline = above ? "bottom" : "top";
                ctx.fillText(
                  `${above ? "高 " : "低 "}${WeatherModel.format(point.y)}`,
                  px,
                  above
                    ? py - (self.compact ? 6 : 8)
                    : py + (self.compact ? 6 : 8),
                );
              }
            }
          }
        }
        ctx.restore();
      },
    };
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
    const isLine = key !== "rain" && key !== "direction";
    let lastIndex = -1;
    mainPoints.forEach((point, index) => {
      if (point.y !== null) lastIndex = index;
    });
    const fillGradient = (context) => {
      const area = context.chart.chartArea;
      if (!area) return "transparent";
      const gradient = context.chart.ctx.createLinearGradient(
        0,
        area.top,
        0,
        area.bottom,
      );
      gradient.addColorStop(0, `${color}${this.compact ? "40" : "55"}`);
      gradient.addColorStop(1, `${color}00`);
      return gradient;
    };
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
        backgroundColor: isLine
          ? fillGradient
          : key === "rain"
            ? "#22d3eecc"
            : color,
        fill: isLine ? "start" : false,
        borderWidth: this.compact ? 4 : 3,
        borderRadius: key === "rain" ? 3 : 0,
        tension: 0,
        cubicInterpolationMode: isLine ? "monotone" : "default",
        borderJoinStyle: "round",
        borderCapStyle: "round",
        pointRadius: isLine
          ? (context) => (context.dataIndex === lastIndex ? 6 : 0)
          : key === "direction"
            ? 4
            : 0,
        pointBackgroundColor: isLine ? "#0b1220" : color,
        pointBorderColor: color,
        pointBorderWidth: 3,
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
        pointRadius: this.compact ? 5 : 4,
        pointBorderColor: "#0b1220",
        pointBorderWidth: 1,
        spanGaps: false,
      });
    const type = key === "rain" ? "bar" : "line";
    this.meta = {
      start,
      end,
      color,
      points: mainPoints,
      extremes: isLine,
    };
    const options = {
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      devicePixelRatio: 1,
      layout: { padding: { right: 10, top: 6 } },
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          type: "linear",
          min: start,
          max: end,
          grid: { color: "#53565b77", drawTicks: false },
          border: { display: false, dash: [4, 6] },
          afterBuildTicks: (axis) => {
            const step = 3 * 60 * 60 * 1000;
            const taipeiOffset = 8 * 60 * 60 * 1000;
            const first =
              Math.ceil((start + taipeiOffset) / step) * step - taipeiOffset;
            axis.ticks = [];
            for (let value = first; value <= end; value += step) {
              axis.ticks.push({ value });
            }
          },
          ticks: {
            color: this.compact ? "#c6c8cb" : "#a2a5aa",
            font: { family: "Noto Sans TC", size: this.compact ? 20 : 19 },
            maxRotation: 0,
            autoSkip: false,
            callback: (value) => {
              const hour = String(
                new Date(Number(value) + 8 * 60 * 60 * 1000).getUTCHours(),
              ).padStart(2, "0");
              return hour;
            },
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
          grid: { color: "#53565b88", drawTicks: false },
          border: { display: false, dash: [4, 6] },
          ticks: {
            color: this.compact ? "#c6c8cb" : "#a2a5aa",
            font: { family: "Noto Sans TC", size: this.compact ? 20 : 19 },
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
        plugins: [this.plugin],
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
