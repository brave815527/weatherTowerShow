"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
let child,
  timer,
  stopped = false,
  failures = 0;
function start() {
  const began = Date.now();
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", () => {
    if (stopped) return;
    failures = Date.now() - began > 60000 ? 0 : failures + 1;
    const delay = Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
    console.error(`服務已停止，${delay / 1000} 秒後重新啟動。`);
    timer = setTimeout(start, delay);
  });
  child.on("error", () => {
    console.error("無法啟動服務，請檢查執行環境。");
    process.exitCode = 1;
  });
}
function stop() {
  stopped = true;
  clearTimeout(timer);
  child?.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
start();
