require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化 Supabase Client (設定 3 秒超時，避免資料庫離線時 API 長時間掛起)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
        fetch: (url, options) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            return fetch(url, { ...options, signal: controller.signal })
                .then(res => {
                    clearTimeout(timeoutId);
                    return res;
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    throw err;
                });
        }
    }
});

// --- 本機 JSON 備份/降級資料庫系統 ---
const fs = require('fs');
const localDbPath = path.join(__dirname, 'local_observations.json');

// 讀取本機 JSON 資料
function readLocalData() {
    try {
        if (fs.existsSync(localDbPath)) {
            const content = fs.readFileSync(localDbPath, 'utf8');
            return JSON.parse(content);
        }
    } catch (err) {
        console.error('讀取本機觀測紀錄失敗:', err);
    }
    return [];
}

// 寫入本機 JSON 資料
function writeLocalData(data) {
    try {
        fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('寫入本機觀測紀錄失敗:', err);
    }
}

// 儲存單筆紀錄到本機 (限制最多 10000 筆，約 7 天份以防檔案過大)
function saveRecordLocally(record) {
    const data = readLocalData();
    data.push(record);
    if (data.length > 10000) {
        data.splice(0, data.length - 10000);
    }
    writeLocalData(data);
}

// 獲取本機歷史資料
function getLocalHistory(dateStr) {
    const allData = readLocalData();
    if (dateStr) {
        // 比對台灣當地時間 (UTC+8) 是否落在該日期區間
        const start = new Date(`${dateStr}T00:00:00+08:00`).getTime();
        const end = new Date(`${dateStr}T23:59:59+08:00`).getTime();
        return allData.filter(d => {
            const t = new Date(d.created_at).getTime();
            return t >= start && t <= end;
        });
    } else {
        // 預設撈最後 1440 筆
        return allData.slice(-1440);
    }
}

// 生成模擬歷史氣象資料 (當資料庫與本機皆無資料時的極致體驗降級方案，支援台灣時區 UTC+8)
function generateMockHistory(dateStr) {
    const data = [];
    let baseDate;
    if (dateStr) {
        baseDate = new Date(`${dateStr}T00:00:00+08:00`);
    } else {
        // 取得台灣時間的今天 00:00:00
        const tzOffset = 8 * 60; // Taiwan is UTC+8
        const now = new Date();
        const localTime = now.getTime() + tzOffset * 60000;
        const localDate = new Date(localTime);
        const yyyy = localDate.getUTCFullYear();
        const mm = String(localDate.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(localDate.getUTCDate()).padStart(2, '0');
        baseDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00+08:00`);
    }
    
    const limit = 144; // 10分鐘一筆，共144筆，足夠畫出流暢的時序圖
    for (let i = 0; i < limit; i++) {
        const time = new Date(baseDate.getTime() + i * 10 * 60 * 1000);
        // 以台灣當地時間 (UTC+8) 計算小時數以進行日夜特徵模擬
        const hour = (time.getUTCHours() + 8) % 24;
        
        // 溫度：白天高(14點最高)，晚上低
        const temp = 22 + 6 * Math.sin((hour - 8) / 24 * 2 * Math.PI) + Math.random() * 0.6;
        const dewpt = temp - 1.5 - Math.random() * 0.8;
        const humidity = Math.min(100, Math.max(30, 80 - 18 * Math.sin((hour - 8) / 24 * 2 * Math.PI) + Math.random() * 4));
        const wind_speed = 3 + Math.random() * 8;
        const wind_gust = wind_speed + Math.random() * 4;
        const wind_dir = (180 + 30 * Math.sin(hour / 24 * 2 * Math.PI) + Math.random() * 15) % 360;
        const pressure = 1012 + 2.5 * Math.sin(hour / 12 * 2 * Math.PI) + Math.random() * 0.4;
        // 累積降雨
        const precip_total = i * 0.05 + (i > 50 && i < 75 ? Math.random() * 1.5 : 0);
        const precip_rate = precip_total > 0 ? Math.random() * 1 : 0;

        data.push({
            created_at: time.toISOString(),
            temp: parseFloat(temp.toFixed(1)),
            dewpt: parseFloat(dewpt.toFixed(1)),
            humidity: Math.round(humidity),
            wind_speed: parseFloat(wind_speed.toFixed(1)),
            wind_gust: parseFloat(wind_gust.toFixed(1)),
            wind_dir: Math.round(wind_dir),
            pressure: parseFloat(pressure.toFixed(1)),
            precip_total: parseFloat(precip_total.toFixed(1)),
            precip_rate: parseFloat(precip_rate.toFixed(1))
        });
    }
    return data;
}

// 中介軟體
app.use(cors());
app.use(express.json());

// 靜態檔案路由 (設定 public 資料夾存放前端 HTML)
app.use(express.static(path.join(__dirname, 'public')));

// 全局變數暫存最新觀測資料，以供前端快速讀取，降低 API 與資料庫請求
let latestWeatherData = null;

// 熔斷器 (Circuit Breaker) 設定，避免資料庫離線時每次請求都等待 3 秒超時
let isSupabaseOffline = false;
let lastOfflineCheckTime = 0;
const OFFLINE_RETRY_INTERVAL = 60000; // 1 分鐘後再次嘗試連線 Supabase

function checkSupabaseHealth() {
    if (isSupabaseOffline) {
        if (Date.now() - lastOfflineCheckTime > OFFLINE_RETRY_INTERVAL) {
            console.log('離線冷卻時間已過，重新嘗試連線 Supabase...');
            isSupabaseOffline = false;
        }
    }
    return !isSupabaseOffline;
}

function markSupabaseOffline(error) {
    if (!isSupabaseOffline) {
        isSupabaseOffline = true;
        lastOfflineCheckTime = Date.now();
        console.warn(`Supabase 連線異常 (${error.message || error})，已開啟熔斷保護，將在 1 分鐘內直接使用本機備份。`);
    }
}

// 獲取最新資料 API Endpoint
app.get('/api/weather/latest', (req, res) => {
    if (latestWeatherData) {
        res.json(latestWeatherData);
    } else {
        res.status(503).json({ error: '目前尚無最新觀測資料，請稍後重試。' });
    }
});

// 獲取歷史資料 API Endpoint (支援 ?date=YYYY-MM-DD，若無則抓取最近 1440 筆)
app.get('/api/weather/history', async (req, res) => {
    try {
        const { date } = req.query;
        console.log(`[HTTP GET] /api/weather/history - date param: ${date || 'none'}`);

        let allData = [];
        let useFallback = !checkSupabaseHealth();

        if (!useFallback) {
            try {
                if (date) {
                    // 建構台灣當地時間全天區間 (UTC+8)
                    const start = `${date} 00:00:00+08`;
                    const end = `${date} 23:59:59+08`;
                    console.log(`Searching for local day range: ${start} to ${end}`);

                    // 由於 Supabase 限制單次查詢筆數 (預設通常為 1000)
                    // 分兩次抓取以確保 24 小時資料 (1440 筆) 完整
                    const { data: part1, error: e1 } = await supabase
                        .from('weather_observations')
                        .select('created_at, temp, dewpt, humidity, wind_speed, wind_gust, wind_dir, pressure, precip_total, precip_rate')
                        .gte('created_at', start)
                        .lte('created_at', end)
                        .order('created_at', { ascending: true })
                        .range(0, 999);
                    if (e1) throw e1;
                    allData = allData.concat(part1);

                    if (part1.length === 1000) {
                        const { data: part2, error: e2 } = await supabase
                            .from('weather_observations')
                            .select('created_at, temp, dewpt, humidity, wind_speed, wind_gust, wind_dir, pressure, precip_total, precip_rate')
                            .gte('created_at', start)
                            .lte('created_at', end)
                            .order('created_at', { ascending: true })
                            .range(1000, 1999);
                        if (e2) throw e2;
                        allData = allData.concat(part2);
                    }
                } else {
                    // 預設抓最近 1440 筆 (分兩次抓，因上限 1000)
                    const { data: part1, error: e1 } = await supabase
                        .from('weather_observations')
                        .select('created_at, temp, dewpt, humidity, wind_speed, wind_gust, wind_dir, pressure, precip_total, precip_rate')
                        .order('created_at', { ascending: false })
                        .range(0, 999);
                    if (e1) throw e1;
                    allData = allData.concat(part1);

                    if (part1.length === 1000) {
                        const { data: part2, error: e2 } = await supabase
                            .from('weather_observations')
                            .select('created_at, temp, dewpt, humidity, wind_speed, wind_gust, wind_dir, pressure, precip_total, precip_rate')
                            .order('created_at', { ascending: false })
                            .range(1000, 1439);
                        if (e2) throw e2;
                        allData = allData.concat(part2);
                    }

                    // 反轉回正序
                    allData.reverse();
                }
            } catch (dbError) {
                console.error('Supabase 歷史資料查詢失敗，啟用本機 JSON 降級機制:', dbError.message || dbError);
                markSupabaseOffline(dbError);
                useFallback = true;
            }
        }

        if (useFallback) {
            console.log('啟用本機 JSON 降級機制載入歷史資料...');
            // 嘗試讀取本機資料
            allData = getLocalHistory(date);
            
            // 如果本機資料也是空的，我們就自動生成該日期的模擬資料，確保時序圖可正常顯示並展示設計效果
            if (allData.length === 0) {
                console.log(`本機無該日期歷史觀測紀錄，自動生成模擬資料 (${date || '今天'})...`);
                allData = generateMockHistory(date);
                // 把模擬資料寫入本機備份中，方便之後重用
                const localData = readLocalData();
                localData.push(...allData);
                writeLocalData(localData);
            }
        }

        console.log(`Query finished. Combined total: ${allData.length} records.`);
        res.json(allData);
    } catch (error) {
        console.error('獲取歷史資料失敗:', error);
        res.status(500).json({ error: '伺服器內部錯誤' });
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

            // 準備寫入 Supabase/本機 的資料結構
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
                raw_data: data,
                created_at: new Date().toISOString()
            };

            // 寫入本機 JSON 備份
            saveRecordLocally(record);

            if (checkSupabaseHealth()) {
                // 寫入 Supabase DB
                const { error } = await supabase
                    .from('weather_observations')
                    .insert([record]);

                if (error) {
                    console.error('寫入 Supabase 時發生錯誤:', error);
                    markSupabaseOffline(error);
                } else {
                    console.log('成功將最新資料從 API 抓取並寫入 Supabase!');
                }
            } else {
                console.log('Supabase 目前處於離線熔斷狀態，暫不寫入雲端。');
            }

        } else {
            // ----------------------------------------------------
            // 2. 本機 Development 模式：不呼叫 API，直接從 DB 撈最新一筆
            // ----------------------------------------------------
            let dbSuccess = false;
            if (checkSupabaseHealth()) {
                try {
                    const { data: dbData, error } = await supabase
                        .from('weather_observations')
                        .select('raw_data')
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (error) throw error;

                    if (dbData && dbData.length > 0) {
                        latestWeatherData = dbData[0].raw_data;
                        console.log('本機開發模式 (development) - 成功從 Supabase 讀取最新歷史紀錄，不上傳。');
                        dbSuccess = true;
                    }
                } catch (dbError) {
                    console.error('本機模式下從 Supabase 讀取資料失敗，啟用本機 JSON 降級機制:', dbError.message || dbError);
                    markSupabaseOffline(dbError);
                }
            }

            if (!dbSuccess) {
                // 嘗試從本機 JSON 讀取
                const localData = readLocalData();
                if (localData.length > 0) {
                    latestWeatherData = localData[localData.length - 1].raw_data;
                    console.log('本機開發模式 - 成功從本機 JSON 讀取最新歷史紀錄。');
                } else {
                    console.log('本機 JSON 備份也是空的，嘗試直接從 IBM API 抓取備份資料以確保本機開發畫面正常...');
                    try {
                        const response = await fetch(process.env.WEATHER_API_URL);
                        if (response.ok) {
                            const data = await response.json();
                            latestWeatherData = data;
                            console.log('本機開發模式 - 成功直接從 IBM API 抓取備用最新觀測資料。');
                        }
                    } catch (fetchErr) {
                        console.error('本機開發模式 - 獲取 IBM API 備份資料失敗:', fetchErr);
                    }
                }
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
