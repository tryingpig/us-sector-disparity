/* ── 미국 섹터 ETF 이격도 트래커 — 공용 + 메인 렌더 ──────────────────
 * 프론트는 항상 같은 모양의 JSON(data/summary.json, data/{티커}.json)을 읽는다.
 * 데이터 출처가 커밋된 파일이든 향후 API든 화면 코드는 그대로 재사용한다.
 */

const ZONE_META = {
  overheated: { label: "과열",     color: "#ef4444" },
  warning:    { label: "경계",     color: "#f59e0b" },
  normal:     { label: "정상",     color: "#22c55e" },
  cooldown:   { label: "과열 해소", color: "#3b82f6" },
};

const ZONE_ORDER = ["overheated", "warning", "normal", "cooldown"];

// 데이터 경로(상대). index.html / sector.html 모두 루트에 있으므로 동일.
const DATA_BASE = "data";

function fmtNum(v, digits = 2) {
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// 가격 표기: ETF는 달러($), 지수는 포인트라 기호 없이 숫자만.
function money(v, kind) {
  return kind === "index" ? fmtNum(v) : `$${fmtNum(v)}`;
}

function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} KST`;
  } catch {
    return iso;
  }
}

async function loadJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 로드 실패 (${res.status})`);
  return res.json();
}

/* ── 메인 페이지 ─────────────────────────────────────── */
async function initMain() {
  const statusEl = document.getElementById("status-bar");
  const tableWrap = document.getElementById("table-view");
  const heatWrap = document.getElementById("heat-view");

  let data;
  try {
    data = await loadJSON(`${DATA_BASE}/summary.json`);
  } catch (e) {
    tableWrap.innerHTML = `<div class="error-box">데이터를 불러오지 못했습니다.<br>${e.message}</div>`;
    return;
  }

  const sectors = data.sectors;

  // 상태 요약 바
  const counts = ZONE_ORDER.reduce((acc, z) => {
    acc[z] = sectors.filter((s) => s.zone === z).length;
    return acc;
  }, {});
  statusEl.innerHTML = `
    <span class="status-pill">기준일 <strong>${data.as_of_date}</strong></span>
    <span class="status-pill">갱신 <strong>${fmtDateTime(data.updated_at)}</strong></span>
    <span class="status-pill">MA <strong>${data.ma_period}일</strong></span>
    ${ZONE_ORDER.map(
      (z) =>
        `<span class="status-pill"><span class="dot" style="background:${ZONE_META[z].color}"></span>${ZONE_META[z].label} <strong>${counts[z]}</strong></span>`
    ).join("")}
  `;

  // 상단 지수 카드 (data.indices, 정의 순서 유지). 없으면 섹션 숨김.
  const indices = data.indices || [];
  const idxSection = document.getElementById("index-section");
  const idxStrip = document.getElementById("index-strip");
  if (idxStrip) {
    if (indices.length) {
      idxStrip.innerHTML = indices
        .map(
          (s) => `
        <div class="index-card ${s.zone}" onclick="location.href='sector.html?ticker=${s.ticker}'">
          <div class="ic-top">
            <span class="ic-name">${s.name_ko}</span>
            <span class="ic-ticker">${s.symbol || s.ticker}</span>
          </div>
          <div class="ic-mid">
            <span class="ic-disp ${s.zone}">${fmtNum(s.disparity, 1)}</span>
            <span class="badge ${s.zone}">${ZONE_META[s.zone].label}</span>
          </div>
          <div class="ic-sub">${money(s.price, s.kind)} · 50일선 ${money(s.ma50, s.kind)}</div>
        </div>`
        )
        .join("");
    } else if (idxSection) {
      idxSection.style.display = "none";
    }
  }

  // 순위표 (이미 summary.json이 이격도 내림차순으로 정렬·rank 부여됨)
  const rows = sectors
    .map(
      (s) => `
    <tr onclick="location.href='sector.html?ticker=${s.ticker}'">
      <td class="left rk">${s.rank}</td>
      <td class="left">
        <div class="sector-name">${s.name_ko}</div>
        <div class="sector-theme hide-sm">${s.theme}</div>
      </td>
      <td class="left"><span class="ticker">${s.ticker}</span></td>
      <td class="hide-sm">$${fmtNum(s.price)}</td>
      <td class="hide-sm">$${fmtNum(s.ma50)}</td>
      <td><span class="disp ${s.zone}">${fmtNum(s.disparity)}</span></td>
      <td><span class="badge ${s.zone}">${ZONE_META[s.zone].label}</span></td>
      <td class="arrow">›</td>
    </tr>`
    )
    .join("");

  tableWrap.innerHTML = `
    <table class="rank-table">
      <thead>
        <tr>
          <th class="left">#</th>
          <th class="left">섹터</th>
          <th class="left">티커</th>
          <th class="hide-sm">현재가</th>
          <th class="hide-sm">50일선</th>
          <th>이격도</th>
          <th>구간</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // 히트맵
  heatWrap.innerHTML = `<div class="heatmap">${sectors
    .map(
      (s) => `
      <div class="heat-cell ${s.zone}" onclick="location.href='sector.html?ticker=${s.ticker}'">
        <div class="hc-top">
          <span class="hc-ticker">${s.ticker}</span>
          <span class="hc-disp" style="color:${ZONE_META[s.zone].color}">${fmtNum(s.disparity, 1)}</span>
        </div>
        <div class="hc-name">${s.name_ko}</div>
        <div class="hc-theme">${s.theme}</div>
      </div>`
    )
    .join("")}</div>`;

  // 보기 전환 (순위표 ↔ 히트맵)
  const btnTable = document.getElementById("btn-table");
  const btnHeat = document.getElementById("btn-heat");
  function setView(view) {
    const isTable = view === "table";
    tableWrap.style.display = isTable ? "" : "none";
    heatWrap.style.display = isTable ? "none" : "";
    btnTable.classList.toggle("active", isTable);
    btnHeat.classList.toggle("active", !isTable);
  }
  btnTable.onclick = () => setView("table");
  btnHeat.onclick = () => setView("heat");
  setView("table");
}

/* ── 상세 페이지 ─────────────────────────────────────── */
const RANGES = [
  { key: "3M", days: 63 },
  { key: "6M", days: 126 },
  { key: "1Y", days: 252 },
  { key: "2Y", days: 504 },
  { key: "5Y", days: 1300 },
];

function zoneOf(d, zones) {
  if (d >= zones.warning_max) return "overheated";
  if (d >= zones.normal_max) return "warning";
  if (d >= zones.cooldown_max) return "normal";
  return "cooldown";
}

// 반원 게이지(SVG). 90~140% 구간을 호에 매핑하고 구간별 색을 칠한다.
function buildGauge(disparity, zone) {
  const MIN = 90, MAX = 140;
  const clamp = Math.max(MIN, Math.min(MAX, disparity));
  const frac = (clamp - MIN) / (MAX - MIN); // 0~1
  const angle = Math.PI * (1 - frac);       // π(왼,90) → 0(오,140)
  const cx = 110, cy = 110, r = 92;

  // 임계값(105/120/130) 위치의 호 구간을 색칠
  const segs = [
    { from: 90,  to: 105, color: "#3b82f6" },
    { from: 105, to: 120, color: "#22c55e" },
    { from: 120, to: 130, color: "#f59e0b" },
    { from: 130, to: 140, color: "#ef4444" },
  ];
  const polar = (val) => {
    const f = (val - MIN) / (MAX - MIN);
    const a = Math.PI * (1 - f);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arcs = segs
    .map((s) => {
      const [x1, y1] = polar(s.from);
      const [x2, y2] = polar(s.to);
      return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"
        fill="none" stroke="${s.color}" stroke-width="14" stroke-linecap="butt" opacity="0.85"/>`;
    })
    .join("");
  const nx = cx + (r - 18) * Math.cos(angle);
  const ny = cy - (r - 18) * Math.sin(angle);
  const color = ZONE_META[zone].color;

  return `
    <svg viewBox="0 0 220 130" class="gauge-svg" width="220" height="130">
      ${arcs}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"
        stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="${color}"/>
      <text x="20" y="125" fill="#6b7280" font-size="11">90</text>
      <text x="190" y="125" fill="#6b7280" font-size="11">140</text>
    </svg>`;
}

let priceChart, dispChart;

function renderCharts(series, zones, rangeDays) {
  const data = series.slice(-rangeDays);
  const labels = data.map((d) => d.date);
  const prices = data.map((d) => d.price);
  const ma50 = data.map((d) => d.ma50);
  const disp = data.map((d) => d.disparity);

  const gridColor = "rgba(255,255,255,0.05)";
  const tickColor = "#6b7280";
  const baseOpts = (extraY) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#9aa0ac", boxWidth: 14, font: { size: 12 } } },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: {
        ticks: { color: tickColor, maxTicksLimit: 7, font: { size: 11 } },
        grid: { color: gridColor },
      },
      y: { ...extraY, ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
    },
  });

  // 가격 + MA50
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.getElementById("priceChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "종가", data: prices, borderColor: "#a06ad4", backgroundColor: "rgba(160,106,212,0.08)", borderWidth: 2, pointRadius: 0, fill: true, tension: 0.1 },
        { label: "50일 이동평균", data: ma50, borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0, borderDash: [5, 4], tension: 0.1 },
      ],
    },
    options: baseOpts(),
  });

  // 이격도 추이 + 105/130 기준선
  const annoLines = {
    l130: { type: "line", yMin: 130, yMax: 130, borderColor: "#ef4444", borderWidth: 1, borderDash: [4, 4], label: { display: true, content: "130 과열", position: "end", color: "#ef4444", backgroundColor: "transparent", font: { size: 10 } } },
    l120: { type: "line", yMin: 120, yMax: 120, borderColor: "#f59e0b", borderWidth: 1, borderDash: [4, 4] },
    l105: { type: "line", yMin: 105, yMax: 105, borderColor: "#3b82f6", borderWidth: 1, borderDash: [4, 4], label: { display: true, content: "105 과열해소", position: "start", color: "#3b82f6", backgroundColor: "transparent", font: { size: 10 } } },
  };
  if (dispChart) dispChart.destroy();
  const dOpts = baseOpts();
  dOpts.plugins.annotation = { annotations: annoLines };
  dispChart = new Chart(document.getElementById("dispChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "이격도(%)", data: disp, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.08)", borderWidth: 2, pointRadius: 0, fill: true, tension: 0.1 },
      ],
    },
    options: dOpts,
  });
}

async function initDetail() {
  const params = new URLSearchParams(location.search);
  const ticker = (params.get("ticker") || "").toUpperCase();
  const root = document.getElementById("detail-root");

  if (!ticker) {
    root.innerHTML = `<div class="error-box">티커가 지정되지 않았습니다. <a href="index.html" style="color:#a06ad4">메인으로</a></div>`;
    return;
  }

  let data, summary;
  try {
    [data, summary] = await Promise.all([
      loadJSON(`${DATA_BASE}/${ticker}.json`),
      loadJSON(`${DATA_BASE}/summary.json`),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="error-box">데이터를 불러오지 못했습니다 (${ticker}).<br>${e.message}<br><a href="index.html" style="color:#a06ad4">메인으로</a></div>`;
    return;
  }

  const zones = summary.zones;
  const series = data.series;
  const last = series[series.length - 1];
  const zone = zoneOf(last.disparity, zones);
  const kind = data.kind || "sector";
  document.title = `${data.name_ko} (${ticker}) — 이격도 트래커`;

  root.innerHTML = `
    <div class="detail-head">
      <span class="ticker-lg">${ticker}</span>
      <h1>${data.name_ko}</h1>
      <span class="badge ${zone}">${ZONE_META[zone].label}</span>
    </div>
    <p class="subtitle" style="color:#9aa0ac;margin:6px 0 0">${data.name_en} · ${data.theme}</p>

    <div class="detail-stats">
      <div class="stat"><div class="label">현재가</div><div class="value">${money(last.price, kind)}</div></div>
      <div class="stat"><div class="label">50일 이동평균</div><div class="value">${money(last.ma50, kind)}</div></div>
      <div class="stat"><div class="label">이격도</div><div class="value" style="color:${ZONE_META[zone].color}">${fmtNum(last.disparity)}</div></div>
      <div class="stat"><div class="label">기준일</div><div class="value" style="font-size:16px">${last.date}</div></div>
    </div>

    <section class="card">
      <h2>현재 이격도 게이지</h2>
      <div class="gauge-wrap">
        <div class="gauge">${buildGauge(last.disparity, zone)}</div>
        <div class="gauge-readout">
          <div class="g-val" style="color:${ZONE_META[zone].color}">${fmtNum(last.disparity)}</div>
          <div class="g-zone" style="color:${ZONE_META[zone].color}">${ZONE_META[zone].label}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>가격 + 50일 이동평균</h2>
        <div class="range-toggle" id="range-toggle"></div>
      </div>
      <div class="chart-box"><canvas id="priceChart"></canvas></div>
    </section>

    <section class="card">
      <h2>이격도 추이 (105 · 130 기준선)</h2>
      <div class="chart-box"><canvas id="dispChart"></canvas></div>
    </section>

    <section class="card method">
      <h2>이그전 해석법 요약</h2>
      <ul>
        <li><strong style="color:#ef4444">과열 (≥130)</strong> — 추격매수(패닉 바잉) 자제</li>
        <li><strong style="color:#f59e0b">경계 (120–130)</strong> — 분할·속도 조절 관심</li>
        <li><strong style="color:#22c55e">정상 (105–120)</strong> — 추세 추종 유효</li>
        <li><strong style="color:#3b82f6">과열 해소 (≤105)</strong> — 투매 자제, 조정 끝난 섹터부터 매수</li>
      </ul>
    </section>

    <section class="card">
      <h2>최근 기록</h2>
      <table class="rank-table" id="recent-table"></table>
    </section>

    <p class="disclaimer">본 사이트는 정보 제공용이며 투자 권유가 아닙니다. 투자 판단의 책임은 이용자 본인에게 있습니다.</p>
  `;

  // 최근 기록 표 (최근 12거래일, 최신순)
  const recent = series.slice(-12).reverse();
  document.getElementById("recent-table").innerHTML = `
    <thead><tr>
      <th class="left">날짜</th><th>종가</th><th>50일선</th><th>이격도</th><th>구간</th>
    </tr></thead>
    <tbody>${recent
      .map((d) => {
        const z = zoneOf(d.disparity, zones);
        return `<tr style="cursor:default">
          <td class="left">${d.date}</td>
          <td>${money(d.price, kind)}</td>
          <td>${money(d.ma50, kind)}</td>
          <td><span class="disp ${z}" style="font-size:14px">${fmtNum(d.disparity)}</span></td>
          <td><span class="badge ${z}">${ZONE_META[z].label}</span></td>
        </tr>`;
      })
      .join("")}</tbody>`;

  // 기간 토글 (데이터가 있는 범위만 활성)
  const maxDays = series.length;
  const toggleEl = document.getElementById("range-toggle");
  const available = RANGES.filter((r, i) => i === 0 || RANGES[i - 1].days < maxDays);
  let activeKey = available.includes(RANGES.find((r) => r.key === "1Y")) ? "1Y" : available[available.length - 1].key;
  function drawToggle() {
    toggleEl.innerHTML = available
      .map((r) => `<button data-days="${r.days}" data-key="${r.key}" class="${r.key === activeKey ? "active" : ""}">${r.key}</button>`)
      .join("");
    toggleEl.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        activeKey = b.dataset.key;
        drawToggle();
        renderCharts(series, zones, Number(b.dataset.days));
      };
    });
  }
  drawToggle();
  const initDays = RANGES.find((r) => r.key === activeKey).days;
  renderCharts(series, zones, initDays);
}

/* ── 페이지 자동 초기화 ──────────────────────────────── */
const PAGE = document.body.dataset.page;
if (PAGE === "main") initMain();
else if (PAGE === "detail") initDetail();
