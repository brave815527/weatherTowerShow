"use strict";
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { loadConfig } = require("../src/config");
(async () => {
  const config = loadConfig(),
    root = config.dataDir;
  let databaseFile = path.join(root, "observations.sqlite");
  try {
    const pointer = JSON.parse(
      fs.readFileSync(path.join(root, "active-database.json"), "utf8"),
    );
    if (/^recovery-\d+\.sqlite$/.test(pointer.file))
      databaseFile = path.join(root, pointer.file);
  } catch {}
  if (!fs.existsSync(databaseFile)) throw new Error("NO_DATABASE");
  const destination = path.join(root, "backups");
  fs.mkdirSync(destination, { recursive: true });
  const filename = path.join(
    destination,
    `weather-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    await backup(db, filename);
  } finally {
    db.close();
  }
  console.log(`備份完成：${filename}`);
})().catch(() => {
  console.error("備份失敗：請檢查資料庫與備份目錄。");
  process.exitCode = 1;
});
