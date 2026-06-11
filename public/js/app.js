/**
 * Keith's Jian Weather Tower - Core Application Controller
 * Manages fetching real-time and historical database records, scheduling updates, and toggling UI states.
 */

const API_URL = '/api/weather/latest';

let isHistoryView = false;
let isPremiumView = false;
let charts = {};
let carouselIndex = 0;
let carouselIntervalId = null;
let lastHistoryData = [];

// Toast Notification Helper (Non-blocking replacement for native alerts)
function showNotification(message, isSuccess = false) {
    let notifyEl = document.getElementById('app-notification');
    if (!notifyEl) {
        notifyEl = document.createElement('div');
        notifyEl.id = 'app-notification';
        notifyEl.style.position = 'fixed';
        notifyEl.style.bottom = '20px';
        notifyEl.style.right = '20px';
        notifyEl.style.background = isSuccess ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)';
        notifyEl.style.color = 'white';
        notifyEl.style.padding = '12px 24px';
        notifyEl.style.borderRadius = '8px';
        notifyEl.style.zIndex = '1000';
        notifyEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        notifyEl.style.fontWeight = 'bold';
        notifyEl.style.transition = 'all 0.3s ease';
        document.body.appendChild(notifyEl);
    } else {
        notifyEl.style.background = isSuccess ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)';
    }
    notifyEl.innerText = message;
    notifyEl.style.opacity = '1';
    notifyEl.style.transform = 'translateY(0)';
    
    setTimeout(() => {
        notifyEl.style.opacity = '0';
        notifyEl.style.transform = 'translateY(20px)';
    }, 4000);
}

// Initialize date picker to today
const datePicker = document.getElementById('history-date-picker');
if (datePicker) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    datePicker.value = `${yyyy}-${mm}-${dd}`;
    
    // Bind change and input events to ensure instant update across all browsers
    datePicker.addEventListener('change', onDateChange);
    datePicker.addEventListener('input', onDateChange);
}

function onDateChange() {
    if (datePicker) {
        fetchHistoryData(datePicker.value);
    }
}

// Fetch current real-time metrics
async function fetchWeatherData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        const obs = data.observations[0];
        const metric = obs.metric;

        // Process wind direction & speed
        const reversedWindDir = (obs.winddir + 180) % 360;
        const windSpeedMsNum = metric.windSpeed / 3.6;
        const windGustMsNum = metric.windGust / 3.6;

        const dashboard = document.getElementById('dashboard');
        const premiumDashboard = document.getElementById('premium-dashboard');

        // 1. Populate Premium Dashboard
        if (premiumDashboard) {
            premiumDashboard.innerHTML = `
                <!-- 1. Temperature -->
                <div class="premium-card temp-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge(metric.temp, -10, 30, '#FF4D4D', 'needle')}
                        <div class="premium-value-container">
                            <span class="premium-unit">°C</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#FF4D4D" stroke-width="2.5"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/></svg>
                                <div class="premium-main-val">${metric.temp}</div>
                            </div>
                            <div class="premium-label">Temperature</div>
                        </div>
                    </div>
                </div>

                <!-- 2. Precipitation -->
                <div class="premium-card precip-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge(metric.precipTotal, 0, 10, '#38BDF8', 'arc')}
                        <div class="premium-value-container">
                            <span class="premium-unit">mm/10min</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" stroke-width="2.5"><path d="M20 16.2A4.5 4.5 0 0 1 17.5 24a4.5 4.5 0 0 1-2.5-7.8V12h5v4.2z"/><path d="M12 2v20"/><path d="M5 16.2A4.5 4.5 0 1 0 7.5 24a4.5 4.5 0 0 0 2.5-7.8V12H5v4.2z"/></svg>
                                <div class="premium-main-val">${metric.precipTotal.toFixed(1)}</div>
                            </div>
                            <div class="premium-label">Precipitation</div>
                        </div>
                    </div>
                </div>

                <!-- 3. Wind -->
                <div class="premium-card wind-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge((windSpeedMsNum * 3.6).toFixed(1), 0, 140, '#F472B6', 'needle')}
                        <div class="premium-value-container">
                            <span class="premium-unit">km/h</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#F472B6" stroke-width="2.5"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
                                <div class="premium-main-val">${(windSpeedMsNum * 3.6).toFixed(1)}</div>
                            </div>
                            <div class="premium-label">Wind from the ${getWindDirection(reversedWindDir)}</div>
                            <div class="premium-sub-info" style="color:#F472B6">▼ Gust peak</div>
                        </div>
                    </div>
                </div>

                <!-- 4. Sunshine -->
                <div class="premium-card sun-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge(10, 0, 10, '#FACC15', 'arc')}
                        <div class="premium-value-container">
                            <span class="premium-unit">min/10min</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#FACC15" stroke-width="2.5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                                <div class="premium-main-val">10</div>
                            </div>
                            <div class="premium-label">Sunshine</div>
                        </div>
                    </div>
                </div>

                <!-- 5. Pressure -->
                <div class="premium-card pressure-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge(metric.pressure, 950, 1050, '#A78BFA', 'needle')}
                        <div class="premium-value-container">
                            <span class="premium-unit">hPa</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2.5"><path d="M12 2v20M2 12h20M5.45 5.45l13.1 13.1M5.45 18.55l13.1-13.1"/></svg>
                                <div class="premium-main-val">${metric.pressure.toFixed(1)}</div>
                            </div>
                            <div class="premium-label">Pressure</div>
                        </div>
                    </div>
                </div>

                <!-- 6. Humidity -->
                <div class="premium-card hum-card">
                    <div class="premium-gauge-container">
                        ${buildPremiumArcGauge(obs.humidity, 0, 100, '#4ADE80', 'needle')}
                        <div class="premium-value-container">
                            <span class="premium-unit">%</span>
                            <div class="premium-icon-box">
                                <svg class="premium-icon" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="2.5"><path d="M12 22.6c5.8 0 10.6-4.8 10.6-10.6S17.8 1.4 12 1.4 1.4 6.2 1.4 12s4.8 10.6 10.6 10.6zM6.6 12l3.6 3.6 7.2-7.2"/></svg>
                                <div class="premium-main-val">${obs.humidity}</div>
                            </div>
                            <div class="premium-label">Humidity</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 2. Populate Standard Dashboard (overwriting skeletons)
        if (dashboard) {
            dashboard.innerHTML = `
                <div class="card">
                    <div class="card-title">目前溫度</div>
                    <div class="widget-container">
                        ${buildSVGTempGauge(metric.temp)}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${metric.temp}</span><span class="unit">°C</span>
                        <div class="sub-value">TEMPERATURE</div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">露點溫度</div>
                    <div class="widget-container">
                        ${buildSVGDewPoint()}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${metric.dewpt}</span><span class="unit">°C</span>
                        <div class="sub-value">DEW POINT</div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">相對濕度</div>
                    <div class="widget-container">
                        ${buildSVGHumidity(obs.humidity)}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${obs.humidity}</span><span class="unit">%</span>
                        <div class="sub-value">HUMIDITY</div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">風向風速</div>
                    <div class="widget-container">
                        ${buildSVGWind(reversedWindDir)}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${windSpeedMsNum.toFixed(1)}</span><span class="unit">m/s</span>
                        <div class="sub-value">GUST ${windGustMsNum.toFixed(1)} m/s</div>
                        <div class="sub-value-2">${reversedWindDir}° ${getWindDirection(reversedWindDir)}</div>
                        <div class="sub-value-2" style="margin-top: 8px;">WIND</div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">日降雨量</div>
                    <div class="widget-container">
                        ${buildSVGPrecip(metric.precipTotal)}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${metric.precipTotal.toFixed(1)}</span><span class="unit">mm</span>
                        <div class="sub-value">${metric.precipRate.toFixed(1)} MM/HR</div>
                        <div class="sub-value-2">PRECIPITATION</div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">大氣壓力</div>
                    <div class="widget-container">
                        ${buildSVGPressure(metric.pressure)}
                    </div>
                    <div class="value-box">
                        <span class="main-value">${Math.round(metric.pressure)}</span><span class="unit">hPa</span>
                        <div class="sub-value">PRESSURE</div>
                    </div>
                </div>
            `;
        }

        const updateTimeText = document.getElementById('update-time-text');
        if (updateTimeText) {
            updateTimeText.innerText = `資料時間: ${new Date().toLocaleTimeString()}`;
        }

    } catch (error) {
        console.error('獲取天氣數據失敗:', error);
        const dashboard = document.getElementById('dashboard');
        if (dashboard) {
            dashboard.innerHTML = '<div style="color:white;text-align:center;width:100%;grid-column: 1/-1;">無法載入資料，請確認後端伺服器已啟動。</div>';
        }
    }
}

// Fetch historical database records
async function fetchHistoryData(dateStr) {
    try {
        const t = Date.now();
        const url = dateStr ? `/api/weather/history?date=${dateStr}&t=${t}` : `/api/weather/history?t=${t}`;
        console.log(`[Frontend] Fetching history from: ${url}`);
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data && data.length > 0) {
            // Update the display date label dynamically
            const dateDisplay = document.getElementById('history-display-date');
            if (dateDisplay) {
                if (dateStr) {
                    dateDisplay.innerText = dateStr;
                } else {
                    const today = new Date();
                    const yyyy = today.getFullYear();
                    const mm = String(today.getMonth() + 1).padStart(2, '0');
                    const dd = String(today.getDate()).padStart(2, '0');
                    dateDisplay.innerText = `${yyyy}-${mm}-${dd}`;
                }
            }
            renderCharts(data);
        } else {
            showNotification(`選取的日期 (${dateStr || '今天'}) 沒有觀測紀錄。`);
        }
    } catch (error) {
        console.error('取得時序圖資料失敗:', error);
    }
}

// Toggle Standard vs Time-series History View
function toggleView() {
    const dashboard = document.getElementById('dashboard');
    const premiumDashboard = document.getElementById('premium-dashboard');
    const carousel = document.getElementById('dashboard-carousel');
    const historyView = document.getElementById('history-view');
    const toggleBtn = document.getElementById('toggle-view-btn');
    const togglePremiumBtn = document.getElementById('toggle-premium-btn');

    isHistoryView = !isHistoryView;
    isPremiumView = false; // Reset premium view

    if (isHistoryView) {
        if (dashboard) dashboard.style.display = 'none';
        if (premiumDashboard) premiumDashboard.style.display = 'none';
        if (carousel) carousel.style.display = 'none';
        if (historyView) historyView.style.display = 'flex';
        if (datePicker) datePicker.style.display = 'block';
        if (toggleBtn) toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> 返回儀表板';
        if (datePicker) fetchHistoryData(datePicker.value);
    } else {
        if (dashboard) dashboard.style.display = 'grid';
        if (premiumDashboard) premiumDashboard.style.display = 'none';
        if (carousel) carousel.style.display = 'block';
        if (historyView) historyView.style.display = 'none';
        if (datePicker) datePicker.style.display = 'none';
        if (toggleBtn) toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg> 切換時序圖';
        fetchHistoryData();
    }
}

// Toggle Standard vs Premium Gauge Dashboard
function togglePremiumView() {
    const dashboard = document.getElementById('dashboard');
    const premiumDashboard = document.getElementById('premium-dashboard');
    const carousel = document.getElementById('dashboard-carousel');
    const historyView = document.getElementById('history-view');
    const toggleBtn = document.getElementById('toggle-view-btn');
    const togglePremiumBtn = document.getElementById('toggle-premium-btn');

    isPremiumView = !isPremiumView;
    isHistoryView = false; // Reset history view

    if (isPremiumView) {
        if (dashboard) dashboard.style.display = 'none';
        if (premiumDashboard) premiumDashboard.style.display = 'grid';
        if (carousel) carousel.style.display = 'none';
        if (historyView) historyView.style.display = 'none';
        if (datePicker) datePicker.style.display = 'none';
        if (toggleBtn) toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg> 切換時序圖';
        if (togglePremiumBtn) togglePremiumBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg> 返回普通儀表';
    } else {
        if (dashboard) dashboard.style.display = 'grid';
        if (premiumDashboard) premiumDashboard.style.display = 'none';
        if (carousel) carousel.style.display = 'block';
        if (historyView) historyView.style.display = 'none';
        if (datePicker) datePicker.style.display = 'none';
        if (togglePremiumBtn) togglePremiumBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg> 高級儀表';
    }
}

function init() {
    // OBS mode custom handling via query param
    const params = new URLSearchParams(window.location.search);
    if (params.get('obs') === 'true') {
        const header = document.getElementById('main-header');
        const carousel = document.getElementById('dashboard-carousel');
        if (header) header.style.display = 'none';
        if (carousel) {
            carousel.style.borderTop = 'none';
            carousel.style.marginTop = '15px';
        }
        document.body.style.background = 'transparent';
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.style.padding = '0';
    }

    // Fetch initial datasets
    fetchWeatherData();
    fetchHistoryData();

    // Set intervals
    setInterval(fetchWeatherData, 60000); // Update gauges every 1 minute
    setInterval(() => {
        // Periodically refresh history datasets every 10 minutes to stay fresh
        const currentPickerVal = datePicker ? datePicker.value : null;
        fetchHistoryData(isHistoryView ? currentPickerVal : null);
    }, 600000);
}

// Start application
init();
