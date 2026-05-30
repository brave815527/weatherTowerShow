/**
 * Keith's Jian Weather Tower - Chart.js Rendering Module
 * Handles drawing history charts, sliding window analytics, and high-performance carousel updates.
 */

// Chart.js 共用設定
Chart.defaults.color = '#FFFFFF';
Chart.defaults.font.family = "'Roboto', sans-serif";
Chart.defaults.font.size = 14;

const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    elements: {
        point: { radius: 0 },
        line: { tension: 0.4, borderWidth: 4 } // 加粗平均線 (Avg) 到 4
    },
    scales: {
        x: {
            grid: { display: false, drawBorder: false },
            ticks: {
                color: '#FFFFFF',
                maxRotation: 0,
                autoSkip: false,
                padding: 10,
                callback: function (val, index) {
                    const label = this.getLabelForValue(val);
                    if (label.endsWith(':00')) return label.split(':')[0];
                    return '';
                }
            }
        },
        y: {
            grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
            ticks: { color: '#FFFFFF', padding: 10 }
        }
    },
    plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
    }
};

// 資料處理：計算滑動窗口統計量，模擬 Min/Avg/Max 線條
function getWindowStats(data, field, windowSize = 10) {
    let mins = [], maxs = [], avgs = [];
    for (let i = 0; i < data.length; i++) {
        let start = Math.max(0, i - Math.floor(windowSize / 2));
        let end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
        let windowData = data.slice(start, end).map(d => d[field]).filter(v => v != null);

        if (windowData.length > 0) {
            mins.push(Math.min(...windowData));
            maxs.push(Math.max(...windowData));
            avgs.push(windowData.reduce((a, b) => a + b, 0) / windowData.length);
        } else {
            mins.push(null); maxs.push(null); avgs.push(null);
        }
    }
    return { mins, maxs, avgs };
}

// 建立 Badge HTML
function createBadges(stats, unit, containerId, colors) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const avg = stats.avgs.reduce((a, b) => a + (b || 0), 0) / stats.avgs.filter(v => v != null).length;
    const min = Math.min(...stats.mins.filter(v => v != null));
    const max = Math.max(...stats.maxs.filter(v => v != null));

    let html = `
        <div class="badge"><span class="badge-type" style="background:${colors.min}">Min</span> <span class="badge-val">${min.toFixed(1)} ${unit}</span></div>
        <div class="badge"><span class="badge-type" style="background:${colors.avg}">Avg</span> <span class="badge-val">${avg.toFixed(1)} ${unit}</span></div>
        <div class="badge"><span class="badge-type" style="background:${colors.max}">Max</span> <span class="badge-val">${max.toFixed(1)} ${unit}</span></div>
    `;

    // 特殊處理：如果有 Gust
    if (stats.gusts && colors.gust) {
        const maxGust = Math.max(...stats.gusts.filter(v => v != null));
        const badgeHtml = `<div class="badge"><span class="badge-type" style="background:${colors.gust}">Gust</span> <span class="badge-val">${maxGust.toFixed(1)} ${unit}</span></div>`;
        html += badgeHtml;
    }

    // 特殊處理：如果有 Dewpoint
    if (stats.dewpts && colors.dewpt) {
        const avgDew = stats.dewpts.reduce((a, b) => a + (b || 0), 0) / stats.dewpts.filter(v => v != null).length;
        const badgeHtml = `<div class="badge"><span class="badge-type" style="background:${colors.dewpt}">Dewpt</span> <span class="badge-val">${avgDew.toFixed(1)} ${unit}</span></div>`;
        html += badgeHtml;
    }

    container.innerHTML = html;
}

// --- Carousel High-Performance Logic ---
function renderSingleCarousel() {
    if (!lastHistoryData || !lastHistoryData.length) return;
    const data = lastHistoryData;
    const titleEl = document.getElementById('carousel-title');
    const badgesEl = document.getElementById('carousel-badges');
    const canvas = document.getElementById('chart-carousel');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = data.map(d => {
        const date = new Date(d.created_at);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    });

    let type = 'line';
    let datasets = [];
    let options = { ...commonOptions };

    switch (carouselIndex) {
        case 0: // Temperature
            titleEl.innerText = '溫度 (°C)';
            const tempStats = getWindowStats(data, 'temp', 15);
            const dewpts = data.map(d => d.dewpt);
            createBadges({ ...tempStats, dewpts }, '°C', 'carousel-badges', { min: '#C0392B', avg: '#E74C3C', max: '#7B241C', dewpt: '#1ABC9C' });
            datasets = [
                { label: 'Min', data: tempStats.mins, borderColor: '#C0392B', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Avg', data: tempStats.avgs, borderColor: '#E74C3C', borderWidth: 3, fill: false, tension: 0.4 },
                { label: 'Max', data: tempStats.maxs, borderColor: '#7B241C', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Dewpoint', data: dewpts, borderColor: '#1ABC9C', borderWidth: 1, fill: false, tension: 0.4 }
            ];
            break;
        case 1: // Humidity
            titleEl.innerText = '濕度 (%)';
            const humStats = getWindowStats(data, 'humidity', 15);
            createBadges(humStats, '%', 'carousel-badges', { min: '#1F618D', avg: '#2980B9', max: '#1B4F72' });
            datasets = [
                { label: 'Min', data: humStats.mins, borderColor: '#1F618D', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Avg', data: humStats.avgs, borderColor: '#2980B9', borderWidth: 3, fill: false, tension: 0.4 },
                { label: 'Max', data: humStats.maxs, borderColor: '#1B4F72', borderWidth: 1, fill: false, tension: 0.4 }
            ];
            break;
        case 2: // Wind Speed
            titleEl.innerText = '風速 (m/s)';
            const windStats = getWindowStats(data, 'wind_speed', 15);
            const processedWind = {
                mins: windStats.mins.map(v => v / 3.6),
                maxs: windStats.maxs.map(v => v / 3.6),
                avgs: windStats.avgs.map(v => v / 3.6),
                gusts: data.map(d => d.wind_gust / 3.6)
            };
            createBadges(processedWind, 'm/s', 'carousel-badges', { min: '#117864', avg: '#1ABC9C', max: '#0E6251', gust: '#D35400' });
            datasets = [
                { label: 'Min', data: processedWind.mins, borderColor: '#117864', borderWidth: 1, tension: 0.4 },
                { label: 'Avg', data: processedWind.avgs, borderColor: '#1ABC9C', borderWidth: 3, tension: 0.4 },
                { label: 'Max', data: processedWind.maxs, borderColor: '#0E6251', borderWidth: 1, tension: 0.4 },
                { label: 'Gust', data: processedWind.gusts, backgroundColor: '#D35400', pointRadius: 3, showLine: false, pointStyle: 'circle' }
            ];
            break;
        case 3: // Wind Direction
            titleEl.innerText = '風向 (°)';
            const windDirs = data.map(d => (d.wind_dir + 180) % 360);
            const avgDir = windDirs.reduce((a, b) => a + (b || 0), 0) / windDirs.filter(v => v != null).length;
            badgesEl.innerHTML = `<div class="badge"><span class="badge-type" style="background:#2E86C1">Avg</span> <span class="badge-val">${avgDir.toFixed(0)}° (${getWindDirection(avgDir)})</span></div>`;
            datasets = [{
                label: 'Direction',
                data: windDirs,
                backgroundColor: '#2E86C1',
                pointRadius: 2,
                showLine: false,
                pointStyle: 'circle'
            }];
            options = {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y: {
                        min: 0, max: 360,
                        ticks: {
                            stepSize: 45,
                            callback: (v) => v + '°'
                        }
                    }
                }
            };
            break;
        case 4: // Pressure
            titleEl.innerText = '大氣壓力 (hPa)';
            const pressStats = getWindowStats(data, 'pressure', 15);
            createBadges(pressStats, 'hPa', 'carousel-badges', { min: '#7D3C98', avg: '#AF7AC5', max: '#4A235A' });
            datasets = [
                { label: 'Min', data: pressStats.mins, borderColor: '#7D3C98', borderWidth: 1, tension: 0.4 },
                { label: 'Avg', data: pressStats.avgs, borderColor: '#AF7AC5', borderWidth: 3, tension: 0.4 },
                { label: 'Max', data: pressStats.maxs, borderColor: '#4A235A', borderWidth: 1, tension: 0.4 }
            ];
            break;
        case 5: // Precipitation
            titleEl.innerText = '降雨量 (mm)';
            const totalRain = data.length > 0 ? data[data.length - 1].precip_total : 0;
            const maxRainDaily = Math.max(...data.map(d => d.precip_total));
            let hourlyData = new Array(labels.length).fill(0);
            for (let i = 1; i < data.length; i++) {
                const diff = Math.max(0, data[i].precip_total - data[i - 1].precip_total);
                if (diff > 0) hourlyData[i] = diff;
            }
            badgesEl.innerHTML = `
                <div class="badge"><span class="badge-type" style="background:#2E86C1">Total</span> <span class="badge-val">${totalRain.toFixed(1)} mm</span></div>
                <div class="badge"><span class="badge-type" style="background:#1B4F72">Max</span> <span class="badge-val">${maxRainDaily.toFixed(1)} mm</span></div>
            `;
            type = 'bar';
            datasets = [{ label: 'Total', data: hourlyData, backgroundColor: '#2E86C1', borderRadius: 2, barPercentage: 1.0, categoryPercentage: 1.0 }];
            options = { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, beginAtZero: true, suggestedMax: 1.0 } } };
            break;
    }

    // HIGH-PERFORMANCE UPDATE: Only destroy/create if chart type changes
    if (charts.carousel && charts.carousel.config.type === type) {
        charts.carousel.data.labels = labels;
        charts.carousel.data.datasets = datasets;
        charts.carousel.options = options;
        charts.carousel.update('none'); // Silent update (no redraw animation)
    } else {
        if (charts.carousel) charts.carousel.destroy();
        charts.carousel = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: datasets
            },
            options: options
        });
    }
}

// 啟動 Carousel
function startCarousel(data) {
    lastHistoryData = data;
    if (carouselIntervalId) clearInterval(carouselIntervalId);

    // 立即顯示第一張
    renderSingleCarousel();

    // 每 5 秒切換
    carouselIntervalId = setInterval(() => {
        carouselIndex = (carouselIndex + 1) % 6;
        renderSingleCarousel();
    }, 5000);
}

// 繪製六張主要時序圖
function renderCharts(data) {
    startCarousel(data);
    const labels = data.map(d => {
        const date = new Date(d.created_at);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    });

    // 1. 溫度 - 三條線 (Min, Avg, Max) + Dewpoint
    const tempStats = getWindowStats(data, 'temp', 15);
    const dewpts = data.map(d => d.dewpt);
    createBadges({ ...tempStats, dewpts }, '°C', 'badges-temp', { min: '#C0392B', avg: '#E74C3C', max: '#7B241C', dewpt: '#1ABC9C' });

    const ctxTemp = document.getElementById('chart-temp').getContext('2d');
    if (charts.temp) charts.temp.destroy();
    charts.temp = new Chart(ctxTemp, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Min', data: tempStats.mins, borderColor: '#C0392B', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Avg', data: tempStats.avgs, borderColor: '#E74C3C', borderWidth: 3, fill: false, tension: 0.4 },
                { label: 'Max', data: tempStats.maxs, borderColor: '#7B241C', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Dewpoint', data: dewpts, borderColor: '#1ABC9C', borderWidth: 1, fill: false, tension: 0.4 }
            ]
        },
        options: commonOptions
    });

    // 2. 濕度 - 三條線
    const humStats = getWindowStats(data, 'humidity', 15);
    createBadges(humStats, '%', 'badges-humidity', { min: '#1F618D', avg: '#2980B9', max: '#1B4F72' });

    const ctxHum = document.getElementById('chart-humidity').getContext('2d');
    if (charts.humidity) charts.humidity.destroy();
    charts.humidity = new Chart(ctxHum, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Min', data: humStats.mins, borderColor: '#1F618D', borderWidth: 1, fill: false, tension: 0.4 },
                { label: 'Avg', data: humStats.avgs, borderColor: '#2980B9', borderWidth: 3, fill: false, tension: 0.4 },
                { label: 'Max', data: humStats.maxs, borderColor: '#1B4F72', borderWidth: 1, fill: false, tension: 0.4 }
            ]
        },
        options: commonOptions
    });

    // 3. 風速
    const windStats = getWindowStats(data, 'wind_speed', 15);
    const processedWindSpeeds = {
        mins: windStats.mins.map(v => v / 3.6),
        maxs: windStats.maxs.map(v => v / 3.6),
        avgs: windStats.avgs.map(v => v / 3.6),
        gusts: data.map(d => d.wind_gust / 3.6)
    };
    createBadges(processedWindSpeeds, 'm/s', 'badges-windspeed', { min: '#117864', avg: '#1ABC9C', max: '#0E6251', gust: '#D35400' });

    const ctxWind = document.getElementById('chart-wind-speed').getContext('2d');
    if (charts.windSpeed) charts.windSpeed.destroy();
    charts.windSpeed = new Chart(ctxWind, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Min', data: processedWindSpeeds.mins, borderColor: '#117864', borderWidth: 1, tension: 0.4 },
                { label: 'Avg', data: processedWindSpeeds.avgs, borderColor: '#1ABC9C', borderWidth: 3, tension: 0.4 },
                { label: 'Max', data: processedWindSpeeds.maxs, borderColor: '#0E6251', borderWidth: 1, tension: 0.4 },
                {
                    label: 'Gust',
                    data: processedWindSpeeds.gusts,
                    backgroundColor: '#D35400',
                    pointRadius: 3,
                    showLine: false,
                    pointStyle: 'circle'
                }
            ]
        },
        options: commonOptions
    });

    // 4. 風向 - 散佈圖 + 側邊 Y 軸
    const windDirs = data.map(d => (d.wind_dir + 180) % 360);
    const avgDir = windDirs.reduce((a, b) => a + (b || 0), 0) / windDirs.filter(v => v != null).length;
    document.getElementById('badges-winddir').innerHTML = `<div class="badge"><span class="badge-type" style="background:#2E86C1">Avg</span> <span class="badge-val">${avgDir.toFixed(0)}° (${getWindDirection(avgDir)})</span></div>`;

    const ctxWindDir = document.getElementById('chart-wind-dir').getContext('2d');
    if (charts.windDir) charts.windDir.destroy();
    charts.windDir = new Chart(ctxWindDir, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Direction',
                data: windDirs,
                backgroundColor: '#2E86C1',
                pointRadius: 2,
                showLine: false,
                pointStyle: 'circle'
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    min: 0, max: 360,
                    ticks: {
                        stepSize: 45,
                        callback: (v) => v + '°'
                    }
                },
                y2: {
                    position: 'right',
                    min: 0, max: 360,
                    ticks: {
                        stepSize: 45,
                        callback: (v) => {
                            const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N' };
                            return labels[v] || '';
                        }
                    },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    // 5. 氣壓
    const pressStats = getWindowStats(data, 'pressure', 15);
    createBadges(pressStats, 'hPa', 'badges-pressure', { min: '#7D3C98', avg: '#AF7AC5', max: '#4A235A' });

    const ctxPress = document.getElementById('chart-pressure').getContext('2d');
    if (charts.pressure) charts.pressure.destroy();
    charts.pressure = new Chart(ctxPress, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Min', data: pressStats.mins, borderColor: '#7D3C98', borderWidth: 1, tension: 0.4 },
                { label: 'Avg', data: pressStats.avgs, borderColor: '#AF7AC5', borderWidth: 3, tension: 0.4 },
                { label: 'Max', data: pressStats.maxs, borderColor: '#4A235A', borderWidth: 1, tension: 0.4 }
            ]
        },
        options: commonOptions
    });

    // 6. 降雨
    const totalRain = data.length > 0 ? data[data.length - 1].precip_total : 0;
    const maxRainDaily = Math.max(...data.map(d => d.precip_total));

    let hourlyData = new Array(labels.length).fill(0);
    for (let i = 1; i < data.length; i++) {
        const diff = Math.max(0, data[i].precip_total - data[i - 1].precip_total);
        if (diff > 0) hourlyData[i] = diff;
    }

    const badgesPrecip = document.getElementById('badges-precip');
    badgesPrecip.innerHTML = `
        <div class="badge"><span class="badge-type" style="background:#2E86C1">Total</span> <span class="badge-val">${totalRain.toFixed(1)} mm</span></div>
        <div class="badge"><span class="badge-type" style="background:#1B4F72">Max</span> <span class="badge-val">${maxRainDaily.toFixed(1)} mm</span></div>
    `;

    const ctxPrecip = document.getElementById('chart-precip').getContext('2d');
    if (charts.precip) charts.precip.destroy();
    charts.precip = new Chart(ctxPrecip, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total',
                data: hourlyData,
                backgroundColor: '#2E86C1',
                borderRadius: 2,
                barPercentage: 1.0,
                categoryPercentage: 1.0
            }]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    beginAtZero: true,
                    suggestedMax: 1.0
                }
            }
        }
    });
}
