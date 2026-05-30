/**
 * Keith's Jian Weather Tower - Gauges Rendering Modules
 * Contains helper functions to build clean and high-fidelity SVGs for the dashboard dials.
 */

function getWindDirection(degree) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.floor((degree + 11.25) / 22.5) % 16;
    return directions[index];
}

/* 1. 溫度: 漸層彩色圓弧儀表板 (SVG 內建多段路徑實作) */
function buildSVGTempGauge(temp) {
    const minT = -10; const maxT = 40;
    let percent = (temp - minT) / (maxT - minT);
    if (percent < 0) percent = 0; if (percent > 1) percent = 1;
    const angle = -135 + (percent * 270);

    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
        <defs>
            <!-- 左半邊：由下(深藍) 到 上(亮綠) -->
            <linearGradient id="coolGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stop-color="#145A6E" />  <!-- 深青/藍 -->
                <stop offset="20%" stop-color="#8CD0E3" /> <!-- 淺藍 -->
                <stop offset="60%" stop-color="#1A8A4D" /> <!-- 深綠 -->
                <stop offset="100%" stop-color="#84C665" /> <!-- 亮綠 -->
            </linearGradient>
            <!-- 右半邊：由上(橘黃) 到 下(紫紅) -->
            <linearGradient id="warmGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#FCE182" />   <!-- 鵝黃 -->
                <stop offset="30%" stop-color="#F28E19" />  <!-- 橘色 -->
                <stop offset="60%" stop-color="#DE1A2C" />  <!-- 紅色 -->
                <stop offset="100%" stop-color="#702282" /> <!-- 紫色 -->
            </linearGradient>
        </defs>
        
        <!-- 底部暗黑背景圓弧 -->
        <path d="M 22 75 A 38 38 0 1 1 78 75" fill="none" stroke="#222" stroke-width="16" stroke-linecap="round" />
        
        <!-- 左半邊溫度軌道 (使用 stroke-dasharray 切割一半) -->
        <!-- 圓半徑 r=38, 圓周長為 238.76, 1/2 圓弧長度大概是 119 -->
        <path d="M 22 75 A 38 38 0 0 1 50 12" fill="none" stroke="url(#coolGrad)" stroke-width="16" stroke-linecap="round" />
        
        <!-- 右半邊溫度軌道 -->
        <path d="M 50 12 A 38 38 0 0 1 78 75" fill="none" stroke="url(#warmGrad)" stroke-width="16" stroke-linecap="round" />
        
        <!-- 白色指針 -->
        <g transform="translate(50, 50) rotate(${angle})">
            <line x1="0" y1="0" x2="0" y2="-28" stroke="#FFF" stroke-width="4.5" stroke-linecap="round"/>
            <circle cx="0" cy="0" r="7" fill="#FFF"/>
        </g>
    </svg>
    `;
}

/* 2. 露點: 藍色漸層水滴 */
function buildSVGDewPoint() {
    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%; filter: drop-shadow(0 0 8px rgba(0,0,0,0.5));">
        <defs>
            <linearGradient id="dropGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#38BDF8" />
                <stop offset="100%" stop-color="#0284C7" />
            </linearGradient>
        </defs>
        <path d="M50 15 C 50 15, 20 50, 20 70 A 30 30 0 0 0 80 70 C 80 50, 50 15, 50 15 Z" fill="url(#dropGradient)" />
        <circle cx="50" cy="70" r="14" fill="#7DD3FC" opacity="0.4"/>
    </svg>
    `;
}

/* 3. 濕度: 雷達掃描圓餅 */
function buildSVGHumidity(hum) {
    const radius = 38;
    const circum = 2 * Math.PI * radius;
    const dash = (hum / 100) * circum;
    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%; transform: rotate(-90deg); filter: drop-shadow(0 0 8px rgba(0,0,0,0.5));">
        <!-- 底部暗灰圈 -->
        <circle cx="50" cy="50" r="${radius}" fill="#455A64" opacity="0.3" />
        <!-- 藍色環形 (依據濕度填滿) -->
        <circle cx="50" cy="50" r="${radius}" fill="none" stroke="#0EA5E9" stroke-width="24" stroke-dasharray="${dash} ${circum}" opacity="0.85" />
        <!-- 內部深色圓 -->
        <circle cx="50" cy="50" r="26" fill="var(--card-bg)" />
    </svg>
    `;
}

/* 4. 風向風速: 具羅盤刻度的動態圓盤 */
function buildSVGWind(dir) {
    let ticks = '';
    for (let i = 0; i < 360; i += 5) {
        const isMajor = i % 90 === 0;
        const len = isMajor ? 5 : 2;
        ticks += `<line x1="50" y1="8" x2="50" y2="${8 + len}" stroke="${isMajor ? '#FFF' : '#666'}" stroke-width="${isMajor ? 2 : 1}" transform="rotate(${i} 50 50)" />`;
    }
    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%;">
        ${ticks}
        <!-- 羅盤文字 -->
        <text x="50" y="24" fill="#FFF" font-size="9" font-weight="bold" text-anchor="middle">N</text>
        <text x="50" y="83" fill="#FFF" font-size="9" font-weight="bold" text-anchor="middle">S</text>
        <text x="22" y="53" fill="#FFF" font-size="9" font-weight="bold" text-anchor="middle">W</text>
        <text x="78" y="53" fill="#FFF" font-size="9" font-weight="bold" text-anchor="middle">E</text>
        
        <!-- 動態風向箭頭 -->
        <g transform="translate(50,50) rotate(${dir})">
            <polygon points="-5,-30 5,-30 0,-42" fill="#FFF" />
        </g>
    </svg>
    `;
}

/* 5. 降雨: 立體網狀量筒 */
function buildSVGPrecip(precip) {
    // 抓取最大裝水量，假設 50mm 為滿
    let percent = precip / 50; if (percent > 1) percent = 1;
    const h = 50 * percent;
    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%; filter: drop-shadow(0 0 5px rgba(0,0,0,0.3));">
        <!-- 圓柱頂部開口 -->
        <ellipse cx="50" cy="25" rx="20" ry="6" fill="none" stroke="#666" stroke-width="2"/>
        <!-- 圓柱邊緣與底座 -->
        <path d="M 30 25 L 30 75 A 20 6 0 0 0 70 75 L 70 25" fill="none" stroke="#666" stroke-width="2"/>
        
        <!-- 若有降水則以藍色填充高度 -->
        ${h > 0 ? `<path d="M 30 ${75 - h} L 30 75 A 20 6 0 0 0 70 75 L 70 ${75 - h} A 20 6 0 0 1 30 ${75 - h}" fill="#38BDF8" opacity="0.6"/>` : ''}
    </svg>
    `;
}

/* 6. 氣壓: 小時鐘般的指針類比刻度 */
function buildSVGPressure(press) {
    // 將 950 ~ 1050 的氣壓範圍映射到羅盤的 270 度
    const minP = 950; const maxP = 1050;
    let percent = (press - minP) / (maxP - minP);
    if (percent < 0) percent = 0; if (percent > 1) percent = 1;
    const angle = -135 + (percent * 270);

    let ticks = '';
    for (let i = 0; i <= 100; i += 2) {
        const a = -135 + (i * 2.7);
        const isMajor = i % 10 === 0;
        const len = isMajor ? 6 : 3;
        ticks += `<line x1="50" y1="12" x2="50" y2="${12 + len}" stroke="${isMajor ? '#CCC' : '#666'}" stroke-width="${isMajor ? 2 : 1}" transform="rotate(${a} 50 50)" />`;
    }

    return `
    <svg viewBox="0 0 100 100" style="width:100%; height:100%;">
        <!-- 氣壓計邊框 -->
        <circle cx="50" cy="50" r="42" fill="#3A3A3C" stroke="#222" stroke-width="2"/>
        <!-- 白色圓盤 -->
        <circle cx="50" cy="50" r="38" fill="#F4F4F5"/>
        ${ticks}
        
        <!-- 羅盤數字 -->
        <g fill="#111" font-size="5" text-anchor="middle" font-weight="bold">
            <text x="50" y="27" transform="rotate(-90 50 50)">950</text>
            <text x="50" y="27" transform="rotate(-40 50 50)">982</text>
            <text x="50" y="27" transform="rotate(10 50 50)">1013</text>
            <text x="50" y="27" transform="rotate(60 50 50)">1040</text>
        </g>

        <!-- 紅色指針 -->
        <g transform="translate(50, 50) rotate(${angle})">
            <line x1="0" y1="0" x2="0" y2="-28" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="0" cy="0" r="4.5" fill="#EF4444"/>
            <circle cx="0" cy="-20" r="2" fill="#FFF"/> <!-- 紅色指針上的白光澤點 -->
        </g>
        <circle cx="50" cy="50" r="1.5" fill="#000"/>
    </svg>
    `;
}

/* --- 新風格 SVG 繪圖函式 (極致精細高級表盤版 - 霓虹太空艙風格) --- */
function buildPremiumArcGauge(val, min, max, color, type = 'needle') {
    let percent = (val - min) / (max - min);
    if (percent < 0) percent = 0; if (percent > 1) percent = 1;

    const radius = 70;
    const centerX = 100;
    const centerY = 85; // 稍微往上移，留白給下方的數值文字
    const startAngle = -210;
    const endAngle = 30;
    const range = endAngle - startAngle;
    const currentAngle = startAngle + (percent * range);

    // 霓虹發光濾鏡定義
    const colorId = color.replace('#', '');
    const glowFilter = `
        <filter id="glow-${colorId}" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
    `;

    // 計算極座標位置
    const getCoords = (angle, r) => {
        const rad = angle * Math.PI / 180;
        return {
            x: centerX + r * Math.cos(rad),
            y: centerY + r * Math.sin(rad)
        };
    };

    const startPos = getCoords(startAngle, radius);
    const endPos = getCoords(endAngle, radius);
    const currPos = getCoords(currentAngle, radius);
    const largeArc = (currentAngle - startAngle) > 180 ? 1 : 0;

    // 繪製極具未來感的薄霧微型刻度線
    let ticks = '';
    for (let i = 0; i <= 40; i++) {
        const angle = startAngle + (i / 40) * range;
        const isMajor = i % 10 === 0;
        const tickLen = isMajor ? 5 : 2;
        
        const outer = getCoords(angle, radius - 3);
        const inner = getCoords(angle, radius - 3 - tickLen);
        
        ticks += `<line x1="${outer.x}" y1="${outer.y}" x2="${inner.x}" y2="${inner.y}" stroke="${isMajor ? color : '#FFFFFF'}" stroke-width="${isMajor ? 1.2 : 0.8}" opacity="${isMajor ? 0.6 : 0.15}" />`;
    }

    // 端點數值標記 (極簡細緻灰色)
    const minPos = getCoords(startAngle, radius + 11);
    const maxPos = getCoords(endAngle, radius + 11);
    const minLabel = `<text x="${minPos.x}" y="${minPos.y}" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="middle" dominant-baseline="middle" font-weight="700">${min}</text>`;
    const maxLabel = `<text x="${maxPos.x}" y="${maxPos.y}" fill="rgba(255,255,255,0.4)" font-size="8" text-anchor="middle" dominant-baseline="middle" font-weight="700">${max}</text>`;

    // 霓虹游標或指針設計
    let indicator = '';
    if (type === 'needle') {
        // 未來科幻感薄指針 (超高亮白芯 + 霓虹邊緣)
        indicator = `
            <!-- 發光霓虹指針 -->
            <line x1="${centerX}" y1="${centerY}" x2="${currPos.x}" y2="${currPos.y}" stroke="${color}" stroke-width="1.8" filter="url(#glow-${colorId})" opacity="0.9" />
            <line x1="${centerX}" y1="${centerY}" x2="${currPos.x}" y2="${currPos.y}" stroke="#FFFFFF" stroke-width="1" stroke-linecap="round" />
            <!-- 中央精細軸心 -->
            <circle cx="${centerX}" cy="${centerY}" r="5" fill="#121418" stroke="${color}" stroke-width="1.5" />
            <circle cx="${centerX}" cy="${centerY}" r="2" fill="#FFFFFF" />
            <!-- 指針末梢發光游標點 -->
            <circle cx="${currPos.x}" cy="${currPos.y}" r="3.5" fill="#FFFFFF" filter="url(#glow-${colorId})" />
            <circle cx="${currPos.x}" cy="${currPos.y}" r="1.5" fill="${color}" />
        `;
    } else {
        // 霓虹進度條末端的發光粒子
        indicator = `
            <!-- 發光粒子 -->
            <circle cx="${currPos.x}" cy="${currPos.y}" r="5.5" fill="${color}" filter="url(#glow-${colorId})" opacity="0.8" />
            <circle cx="${currPos.x}" cy="${currPos.y}" r="3" fill="#FFFFFF" filter="url(#glow-${colorId})" />
            <circle cx="${currPos.x}" cy="${currPos.y}" r="1" fill="${color}" />
        `;
    }

    return `
    <svg viewBox="0 0 200 135" style="width:100%; height:100%; overflow: visible;">
        <defs>
            ${glowFilter}
            <!-- 漸變環形填充 -->
            <linearGradient id="arcGrad-${colorId}" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="${color}" stop-opacity="0.1" />
                <stop offset="60%" stop-color="${color}" stop-opacity="0.6" />
                <stop offset="100%" stop-color="${color}" stop-opacity="1" />
            </linearGradient>
        </defs>
        
        <!-- 背景暗軌道 -->
        <path d="M ${startPos.x} ${startPos.y} A ${radius} ${radius} 0 1 1 ${endPos.x} ${endPos.y}" 
              fill="none" stroke="#22252C" stroke-width="4.5" stroke-linecap="round" />
        
        <!-- 霓虹發光進度軌道 -->
        <path d="M ${startPos.x} ${startPos.y} A ${radius} ${radius} 0 ${largeArc} 1 ${currPos.x} ${currPos.y}" 
              fill="none" stroke="url(#arcGrad-${colorId})" stroke-width="4.5" stroke-linecap="round" filter="url(#glow-${colorId})" />
        
        <!-- 亮白色核心進度軌道 (增強清晰度) -->
        <path d="M ${startPos.x} ${startPos.y} A ${radius} ${radius} 0 ${largeArc} 1 ${currPos.x} ${currPos.y}" 
              fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.75" />
        
        ${ticks}
        ${minLabel}
        ${maxLabel}
        ${indicator}
    </svg>
    `;
}
