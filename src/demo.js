"use strict";
function demoRow(time) {
  const dayTime = ((time + 8 * 3600000) % 86400000) / 3600000;
  const temp = 24 + 4.5 * Math.sin(((dayTime - 8) * Math.PI) / 12);
  const wind = 2.2 + 1.3 * Math.sin(time / 3600000);
  return {
    station_id: "DEMO",
    observed_at: new Date(time).toISOString(),
    fetched_at: new Date(time).toISOString(),
    source: "demo",
    quality: "passed",
    expected_interval_seconds: 300,
    temp: Math.round(temp * 10) / 10,
    dewpt: Math.round((temp - 3) * 10) / 10,
    humidity: Math.round(76 - 10 * Math.sin(((dayTime - 8) * Math.PI) / 12)),
    wind_speed: Math.round(wind * 10) / 10,
    wind_gust: Math.round((wind + 1.8) * 10) / 10,
    wind_dir: Math.round((42 + 32 * Math.sin(time / 7200000) + 360) % 360),
    pressure:
      Math.round((1012.6 + 1.7 * Math.sin((dayTime * Math.PI) / 6)) * 10) / 10,
    precip_total: Math.round(Math.max(0, Math.min(dayTime - 13, 3)) * 48) / 10,
    precip_rate: dayTime > 13 && dayTime < 16 ? 4.8 : 0,
  };
}
function demoLatest(now = Date.now()) {
  return demoRow(Math.floor(now / 300000) * 300000);
}
function demoHistory(start, end, now = Date.now()) {
  const rows = [];
  for (
    let t = Math.ceil(start / 300000) * 300000;
    t < Math.min(end, now + 1);
    t += 300000
  )
    rows.push(demoRow(t));
  return rows;
}
module.exports = { demoLatest, demoHistory };
