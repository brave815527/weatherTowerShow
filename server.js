require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化 Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 中介軟體
app.use(cors());
app.use(express.json());

// 靜態檔案路由 (設定 public 資料夾存放前端 HTML)
app.use(express.static(path.join(__dirname, 'public')));

// 全局變數暫存最新觀測資料，以供前端快速讀取，降低 API 與資料庫請求
let latestWeatherData = null;

// 獲取最新資料 API Endpoint
app.get('/api/weather/latest', (req, res) => {
    if (latestWeatherData) {
        res.json(latestWeatherData);
    } else {
        res.status(503).json({ error: '目前尚無最新觀測資料，請稍後重試。' });
    }
});

// 負責向 IBM Weather 爬取資料或是從 Supabase 讀取資料的函式
async function fetchAndSaveWeatherData() {
    try {
        console.log(`[${new Date().toLocaleString()}] 準備獲取氣象資料...`);

        if (process.env.NODE_ENV === 'production') {
            // ----------------------------------------------------
            // 1. 雲端 Production 模式：爬取 IBM API 並寫入 DB
            // ----------------------------------------------------
            const response = await fetch(process.env.WEATHER_API_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const obs = data.observations[0];

            // 更新全域暫存
            latestWeatherData = data;

            // 準備寫入 Supabase 的資料結構
            const record = {
                station_id: obs.stationID,
                temp: obs.metric.temp,
                dewpt: obs.metric.dewpt,
                humidity: obs.humidity,
                wind_speed: obs.metric.windSpeed,
                wind_gust: obs.metric.windGust,
                wind_dir: obs.winddir,
                pressure: obs.metric.pressure,
                precip_total: obs.metric.precipTotal,
                precip_rate: obs.metric.precipRate,
                raw_data: data
            };

            const { error } = await supabase
                .from('weather_observations')
                .insert([record]);

            if (error) {
                console.error('寫入 Supabase 時發生錯誤:', error);
            } else {
                console.log('成功將最新資料從 API 抓取並寫入 Supabase!');
            }

        } else {
            // ----------------------------------------------------
            // 2. 本機 Development 模式：不呼叫 API，直接從 DB 撈最新一筆
            // ----------------------------------------------------
            const { data: dbData, error } = await supabase
                .from('weather_observations')
                .select('raw_data')
                .order('created_at', { ascending: false })
                .limit(1);

            if (error) {
                console.error('本機模式下從 Supabase 讀取資料失敗:', error);
                return;
            }

            if (dbData && dbData.length > 0) {
                // 將撈出的最新歷史資料送給前端暫存，模擬 API 抓下來的情境
                latestWeatherData = dbData[0].raw_data;
                console.log('本機開發模式 (development) - 成功從 Supabase 讀取最新歷史紀錄，不上傳。');
            } else {
                console.log('本機開發模式 (development) - 資料庫目前為空。');
            }
        }

    } catch (error) {
        console.error('獲取或處理氣象資料時失敗:', error);
    }
}

// 初次啟動時先抓一次
// 為了避免一啟動因為缺 Key 直接崩潰，我們先檢查是否有輸入 KEY
if (supabaseUrl && supabaseUrl !== '請填寫您的_Project_URL' && supabaseKey && supabaseKey !== '請填寫您的_Service_Role_Key') {
    fetchAndSaveWeatherData();

    // 設定 Cron Job: 每 1 分鐘執行一次
    // 若覺得太頻繁可以改成 '*/5 * * * *' (每 5 分鐘)
    cron.schedule('* * * * *', () => {
        fetchAndSaveWeatherData();
    });
} else {
    console.warn('\n=========================================');
    console.warn('警告: 尚未設定 Supabase 的 URL 或 KEY！');
    console.warn('請在 .env 檔案中填寫，否則定時抓取任務不會啟動。');
    console.warn('=========================================\n');
}

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器正運行於 http://localhost:${PORT}`);
});
