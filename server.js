"use strict";
require("dotenv").config({ quiet: true });
const { loadConfig } = require("./src/config");
const { createApplication } = require("./src/app");
async function main() {
  const runtime = await createApplication(loadConfig());
  const server = runtime.app.listen(
    runtime.config.port,
    runtime.config.host,
    () => {
      console.log(
        `Weather Tower ${runtime.config.version} · http://${runtime.config.host}:${runtime.config.port}/control`,
      );
      runtime.service.start();
    },
  );
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await runtime.service.stop();
    server.close(() => {
      runtime.repository.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
if (require.main === module)
  main().catch(() => {
    console.error("啟動失敗：請檢查設定、Node.js 版本與資料目錄權限。");
    process.exitCode = 1;
  });
module.exports = { main };
