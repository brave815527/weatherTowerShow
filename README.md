# Keith's Jian Weather Tower (氣象觀測儀表板)

此專案為一個全強化的即時氣象觀測與歷史時序分析系統。專案採用前後端分離的概念，透過 Node.js 爬取與整合最新氣象資料，並將數據持久化存入 Supabase，前端再透過精緻的黑階色調與漸層向量動畫表盤進行氣象數據的即時展示與製圖。

## 📱 功能亮點

1. **即時觀測儀表板 (Dashboard)**:
   * **溫度與露點**: 彩色漸層雙環 SVG 表盤設計。
   * **相對濕度**: 水波紋填滿動態效果。
   * **風向與風速**: 動態風向箭頭與平均風/陣風量表。
   * **日累積降雨量**: 漸進式水量填充圖。
   * **大氣壓力**: 精準氣壓指針表。
2. **高階時序圖交互視角 (History View)**:
   * 搭載 **Chart.js** 繪製平滑優美的 24 小時時序特徵圖。
   * 含有客製化的日期選擇器，可回溯指定日期的 1440 筆分鐘級觀測數據。
   * 自動計算並於橫幅總結當日的「最高溫、最低溫、最大風速、最大陣風、最大雨強」。

---

## 🏗️ 系統架構規劃

本專案採用三層式架構設計 (Three-tier Architecture)：

### 1. 介面展示層 (Frontend)
- **核心技術**: 純粹且高效的 Vanilla HTML / CSS / JavaScript。
- **UI框架/函式庫**: 
  - 手刻高質感深色模式 (Dark Theme)、玻璃擬物化 (Glassmorphism) 排版。
  - **Chart.js** : 處理大量(1400+筆)高頻時序畫圖。
- **設計哲學**: 
  - 核心儀表板使用 `SVG` 實作各類氣象指數的動態漸層與動畫表盤。
  - 支援 RWD 適應性佈局，手機、平板、桌布皆能平滑呈現。

### 2. 商業邏輯層 (Backend Server)
- **核心技術**: **Node.js** + **Express.js**
- **排程管理**: `node-cron` 每分鐘異步執行更新任務。
- **職責**: 
  - **生產環境 (`NODE_ENV=production`)**：伺服器每分鐘呼叫 **IBM Weather API** 抓取氣象資料，解析後存入遠端資料庫。
  - **開發環境 (`NODE_ENV=development`)**：伺服器不消耗外部 API 額度且不覆寫資料，而是直接從資料庫拉取最新的一筆資料以利開發測試。
  - 管理提供給前端渲染的兩支 API 路由：`/api/weather/latest` 與 `/api/weather/history`。

### 3. 資料持久層 (Database)
- **核心技術**: **Supabase** (基於 PostgreSQL)
- **特性**: 
  - 統一存放 `weather_observations` 表格。
  - 負責長期儲存每分鐘的連續天氣觀測數據，支援高效率的分頁與時間區間檢索 (`.gte()`, `.lte()`)。

---

## 🛣️ API 路由清單

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/weather/latest` | 獲取最新一筆即時天氣觀測結果以渲染 Dashboard。 |
| `GET` | `/api/weather/history` | 取得 24 小時(或指定日期)的歷史資料 (最多 1500 筆) 供繪製圖表。 |

*註：當前端附帶 `?date=YYYY-MM-DD` 參數呼叫 history 路由時，後端會自動轉換 ISO 時間區間過濾 Supabase 資料。*

---

## 🚀 部署策略 (Deployment)

*   **雲端託管**: **Render** 雲端運算平台 (Web Service)。
*   **觸發機制**: 掛載這份 GitHub 倉庫的 `main` 分支。當推播 (Push) 更新時，Render 將自動觸發 CI/CD 流程構建並發布。
*   **環境變數保護 (Environment Variables)**:
    在本地端仰賴 `.env` 檔案，而在伺服器 (Render) 則鎖在儀表板設定內，確保 `SUPABASE_KEY` 等高機密金鑰不外流。

## 💻 本地環境啟動

若要於本機啟動且不污染線上資料庫紀錄，請執行：
```bash
npm install
node server.js
```
伺服器將在 `http://localhost:3000` 提供服務，並且自動識別進入「**本機開發模式**」。
