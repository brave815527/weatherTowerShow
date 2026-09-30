"use strict";
process.env.APP_MODE = "offline";
require("../server")
  .main()
  .catch(() => {
    console.error("本機播放啟動失敗");
    process.exitCode = 1;
  });
