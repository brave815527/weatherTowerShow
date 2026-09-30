"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const target = path.join(root, "public", "vendor");
fs.mkdirSync(path.join(target, "fonts", "files"), { recursive: true });
fs.copyFileSync(
  path.join(root, "node_modules", "chart.js", "dist", "chart.umd.js"),
  path.join(target, "chart.umd.js"),
);
fs.copyFileSync(
  path.join(root, "node_modules", "chart.js", "LICENSE.md"),
  path.join(target, "CHART-LICENSE.md"),
);
const fontDir = path.join(root, "node_modules", "@fontsource", "noto-sans-tc");
let count = 0;
for (const weight of [400, 700]) {
  const css = fs
    .readFileSync(path.join(fontDir, `${weight}.css`), "utf8")
    .replace(/, url\([^)]*\.woff\) format\('woff'\)/g, "");
  fs.writeFileSync(path.join(target, "fonts", `${weight}.css`), css);
  for (const match of css.matchAll(/url\(\.\/files\/([^)]*)\)/g)) {
    fs.copyFileSync(
      path.join(fontDir, "files", match[1]),
      path.join(target, "fonts", "files", match[1]),
    );
    count++;
  }
}
for (const file of ["LICENSE", "LICENSE.txt", "OFL.txt"])
  if (fs.existsSync(path.join(fontDir, file)))
    fs.copyFileSync(path.join(fontDir, file), path.join(target, "fonts", file));
fs.writeFileSync(
  path.join(target, "versions.json"),
  JSON.stringify(
    {
      chart: require("../node_modules/chart.js/package.json").version,
      font: require("../node_modules/@fontsource/noto-sans-tc/package.json")
        .version,
    },
    null,
    2,
  ),
);
console.log(`本機圖表與字型準備完成（${count} 個字型分片）`);
