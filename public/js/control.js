"use strict";
(function () {
  const M = WeatherModel,
    form = document.getElementById("settings-form"),
    preview = document.getElementById("preview-frame"),
    box = document.getElementById("preview-box");
  const sizes = {
    full: [1920, 1080],
    sidebar: [480, 1080],
    ticker: [1920, 180],
  };
  const fields = [
    "layout",
    "demo",
    "station",
    "theme",
    "windUnit",
    "chart",
    "hours",
    "cycle",
    "date",
  ];
  const incoming = new URLSearchParams(location.search);
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem("weather-tower-settings") || "{}");
  } catch {
    /* Private mode can disable local storage. */
  }
  for (const name of fields) {
    if (name === "station") continue;
    const value = incoming.get(name) ?? stored[name];
    if (value !== undefined) {
      const element = form.elements.namedItem(name);
      if (name === "layout") {
        if (Object.hasOwn(sizes, value)) element.value = value;
      } else if (element instanceof HTMLSelectElement) {
        if ([...element.options].some((option) => option.value === value))
          element.value = value;
      } else if (name === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value))
        element.value = value;
    }
  }
  document.getElementById("history-date").max = M.dateKey(Date.now());
  let settings = {},
    debounce,
    stopped = false,
    healthTimer,
    healthLoaded = false,
    stationInitialized = false;
  function resizePreview() {
    const [width, height] = sizes[settings.layout || "full"],
      available = box.clientWidth;
    const scale = Math.min(
      available / width,
      settings.layout === "sidebar" ? 680 / height : 1,
    );
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    preview.style.transform = `scale(${scale})`;
    preview.style.left = `${Math.max(0, (available - width * scale) / 2)}px`;
    box.style.height = `${Math.ceil(height * scale)}px`;
  }
  function apply() {
    settings = Object.fromEntries(new FormData(form));
    settings.station = document.getElementById("station-select").value;
    if (!Object.hasOwn(sizes, settings.layout)) settings.layout = "full";
    const query = new URLSearchParams();
    for (const name of fields)
      if (settings[name]) query.set(name, settings[name]);
    const url = `${location.origin}/overlay?${query}`;
    document.getElementById("overlay-url").value = url;
    document.getElementById("open-overlay").href = url;
    if (healthLoaded && preview.src !== url) preview.src = url;
    document.getElementById("preview-size").textContent =
      sizes[settings.layout].join(" × ");
    document.getElementById("chart-controls").hidden =
      settings.layout !== "full";
    document.getElementById("station-select").disabled =
      settings.demo === "true";
    try {
      localStorage.setItem("weather-tower-settings", JSON.stringify(settings));
    } catch {
      /* URL remains usable. */
    }
    history.replaceState(null, "", `/control?${query}`);
    resizePreview();
  }
  form.addEventListener("change", () => {
    clearTimeout(debounce);
    debounce = setTimeout(apply, 150);
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("reset-date").addEventListener("click", () => {
    document.getElementById("history-date").value = "";
    apply();
  });
  document.getElementById("copy-url").addEventListener("click", async () => {
    const input = document.getElementById("overlay-url"),
      label = document.getElementById("copy-status");
    try {
      await navigator.clipboard.writeText(input.value);
      label.textContent = "已複製。請貼到瀏覽器來源的網址欄位。";
    } catch {
      input.focus();
      input.select();
      label.textContent = "網址已選取，請按 Ctrl+C 複製。";
    }
  });
  new ResizeObserver(resizePreview).observe(box);
  apply();
  async function updateHealth() {
    try {
      const response = await fetch("/api/status", {
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
      const status = await response.json();
      if (stopped) return;
      document.getElementById("system-pill").textContent =
        { live: "即時收集", playback: "觀測回放", offline: "本機播放" }[
          status.mode
        ] || "服務運作中";
      document.getElementById("service-version").textContent =
        `v${status.version}`;
      const stationSelect = document.getElementById("station-select");
      const desired = stationInitialized
        ? settings.station
        : incoming.get("station") ||
          stored.station ||
          settings.station ||
          status.station_id;
      for (const station of status.stations || [])
        if (
          ![...stationSelect.options].some((option) => option.value === station)
        ) {
          const option = document.createElement("option");
          option.value = station;
          option.textContent = station;
          stationSelect.append(option);
        }
      if (
        desired &&
        [...stationSelect.options].some((option) => option.value === desired) &&
        stationSelect.value !== desired
      ) {
        stationSelect.value = desired;
        apply();
      }
      stationInitialized = true;
      const items = [
        [
          "最新觀測",
          status.observed_at
            ? `${M.timeLabel(status.observed_at, true)} · UTC+8`
            : "尚無有效觀測",
        ],
        ["資料新鮮度", status.observation?.label || "—"],
        [
          "最後成功讀取",
          status.last_fetch_success
            ? M.timeLabel(status.last_fetch_success, true)
            : "尚未成功讀取",
        ],
        [
          "雲端保存",
          {
            ready: "連線正常",
            unavailable: "暫時離線",
            disabled: "未啟用",
            waiting: "等待連線",
            configuration_error: "設定待確認",
          }[status.cloud?.state] || "—",
        ],
        ["待補傳觀測", `${status.pending_uploads || 0} 筆`],
        [
          "本機保存",
          status.storage_error
            ? "保存失敗"
            : status.local?.storage === "recovery"
              ? "已由快照復原"
              : status.local?.snapshot === "error"
                ? "資料庫正常 · 快照待確認"
                : "運作正常",
        ],
      ];
      const grid = document.getElementById("health-grid");
      grid.replaceChildren();
      for (const [name, value] of items) {
        const node = document.createElement("div");
        node.className = "health-item";
        const label = document.createElement("span"),
          detail = document.createElement("strong");
        label.textContent = name;
        detail.textContent = value;
        node.append(label, detail);
        grid.append(node);
      }
      const notes = [];
      if (status.local?.legacy_rejected)
        notes.push(
          `原有 ${status.local.legacy_rejected} 筆資料缺乏可驗證的來源或時間，原檔已保留，不會當成實測匯入。`,
        );
      if (status.cloud?.migration_required)
        notes.push("雲端資料表尚待設定，待補傳資料會保留在本機。");
      if (status.storage_error)
        notes.push("本機資料保存失敗，請確認儲存空間與目錄權限。");
      if (status.local?.recovered)
        notes.push("本機資料庫異常，已保留原檔並啟用復原資料庫，請檢查備份。");
      if (!status.observed_at)
        notes.push(
          "尚無有效觀測。可先選擇示範資料檢查版面，實際觀測不會自動補入模擬數值。",
        );
      const notice = document.getElementById("health-notice");
      notice.textContent =
        notes.join(" ") ||
        "最後有效觀測會保留在本機；資料中斷時，播出頁會明確標示延遲。";
      notice.classList.toggle("warning", notes.length > 0);
    } catch {
      if (stopped) return;
      document.getElementById("system-pill").textContent = "服務連線中斷";
      document.getElementById("health-notice").textContent =
        "目前無法讀取服務狀態，播出頁會保留最後有效觀測。";
    } finally {
      if (!stopped && !healthLoaded) {
        healthLoaded = true;
        apply();
      }
      if (!stopped) healthTimer = setTimeout(updateHealth, 30000);
    }
  }
  updateHealth();
  addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(healthTimer);
    clearTimeout(debounce);
  });
})();
