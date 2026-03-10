// ═══════════════════════════════
// GLOBALS
// ═══════════════════════════════
const CHARTS = {};
const COLORS = [
  "#e8620a",
  "#f0a500",
  "#39ff6e",
  "#0d6fff",
  "#e02020",
  "#ff8c42",
  "#4da6ff",
  "#00c44f",
  "#ffd166",
  "#ff4444",
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

let _allPositions = [];
let _allTxs = [];
let _DBSData = null;
let _SCData = null;
let _accountData = null;
let _timelineMonths = 12;
let _sortCol = "market_value";
let _sortDir = -1;
let _portfolioSubtab = "equity";

// Retirement profile — loaded from server, saved back on submit
let _retirementProfile = null;

// Health score cache — used by AI insights trigger
let _lastHealthScore = null;
let _healthHistory = [];

// Diversification warning thresholds
const WARN_THRESHOLD = 0.5; // single bucket > 50% → warning
const ALERT_THRESHOLD = 0.7; // single bucket > 70% → alert

// ═══════════════════════════════
// HELPERS — CURRENCY
// ═══════════════════════════════
// USD exchange rate to SGD — update this or pull from API as needed
const USD_TO_SGD = 1.34;

// Format a number with a given prefix (default USD "$")
function fmt(v, pre = "$") {
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return (
    pre +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// Format as explicit USD — used for portfolio/brokerage values
function fmtUSD(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return (
    "USD " +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// Format as explicit SGD — used for bank accounts and retirement
function fmtSGD(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return (
    "SGD " +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// Format in a position's native currency (from the currency field)
function fmtCcy(v, currency = "USD") {
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  const sym =
    currency === "SGD"
      ? "SGD "
      : currency === "HKD"
        ? "HKD "
        : currency === "GBP"
          ? "£"
          : "USD ";
  return (
    sym +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// Convert USD value to SGD for the net worth bar
function toSGD(usdVal) {
  return parseFloat(usdVal) * USD_TO_SGD;
}

function fmtPct(v) {
  return parseFloat(v).toFixed(2) + "%";
}
function pnlClass(v) {
  return parseFloat(v) >= 0 ? "pos" : "neg";
}

function setLoading(on) {
  document.getElementById("loading-bar").classList.toggle("active", on);
  const btn = document.getElementById("btn-refresh");
  btn.disabled = on;
  btn.textContent = on ? "SYNCING..." : "↺ RESYNC";
}

function makeChart(id, type, data, options = {}) {
  if (CHARTS[id]) CHARTS[id].destroy();
  const ctx = document.getElementById(id)?.getContext("2d");
  if (!ctx) return;
  CHARTS[id] = new Chart(ctx, {
    type,
    data,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: {
            color: "#7a90aa",
            font: { family: "Share Tech Mono", size: 10 },
            boxWidth: 10,
          },
        },
      },
      scales:
        type === "bar" || type === "line"
          ? {
              x: {
                ticks: {
                  color: "#7a90aa",
                  font: { family: "Share Tech Mono", size: 9 },
                },
                grid: { color: "#141b28" },
              },
              y: {
                ticks: {
                  color: "#7a90aa",
                  font: { family: "Share Tech Mono", size: 9 },
                },
                grid: { color: "#141b28" },
              },
            }
          : {},
      ...options,
    },
  });
}

// ═══════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════
function switchTab(name) {
  document
    .querySelectorAll(".nav-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelector(`.nav-tab[onclick*="${name}"]`)
    .classList.add("active");
  document.getElementById(`tab-${name}`).classList.add("active");
  setTimeout(() => Object.values(CHARTS).forEach((c) => c?.update()), 50);
}

// ═══════════════════════════════
// TIMELINE — BUG FIX
// "SEMI-ANNUAL" contains "ANNUAL" so we must match exactly by months value,
// not by button text substring.
// ═══════════════════════════════
function setTimeline(months) {
  _timelineMonths = months;
  document.querySelectorAll(".tl-btn").forEach((b) => {
    const btnMonths = parseInt(b.dataset.months, 10);
    b.classList.toggle("active", btnMonths === months);
  });
  const labels = {
    1: "[ MONTHLY VIEW ]",
    6: "[ SEMI-ANNUAL — 6 MONTHS ]",
    12: "[ ANNUAL — 12 MONTHS ]",
  };
  document.getElementById("timeline-label-text").textContent = labels[months];
  if (_DBSData && _SCData) {
    renderBankingCharts(_DBSData, _SCData);
    renderBankCards(_DBSData, _SCData);
  }
}

// ═══════════════════════════════
// FORCE REFRESH
// ═══════════════════════════════
async function forceRefresh() {
  await fetch("/api/refresh");
  await load();
}

// ═══════════════════════════════
// MAIN LOAD
// ═══════════════════════════════
async function load() {
  setLoading(true);
  try {
    const [sR, aR, pR, tR, cR, mR, hR] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/account"),
      fetch("/api/portfolio"),
      fetch("/api/transactions"),
      fetch("/api/bank/DBS"),
      fetch("/api/bank/SC"),
      fetch("/api/health/history"),
    ]);
    const status = await sR.json();
    const account = await aR.json();
    const portfolio = await pR.json();
    const txData = await tR.json();
    _DBSData = await cR.json();
    _SCData = await mR.json();
    const historyData = await hR.json();
    _allPositions = portfolio.positions;
    _allTxs = txData.transactions;
    _accountData = account;
    _healthHistory = historyData.history || [];

    const cacheAge = status.cached?.portfolio;
    const el = document.getElementById("data-source-note");
    if (el)
      el.innerHTML =
        cacheAge != null
          ? `<span style="color:var(--muted)">CACHE: ${cacheAge}s AGO</span>`
          : `<span style="color:var(--green)">◉ LIVE FEED</span>`;

    renderNetWorth(account, _DBSData, _SCData);
    renderBankCards(_DBSData, _SCData);
    renderBankingCharts(_DBSData, _SCData);
    renderPortfolio(_allPositions, _allTxs, account);
    renderAnalysis(_allPositions);
    const healthResult = renderHealthScore(
      _allPositions,
      account,
      _DBSData,
      _SCData,
    );
    if (healthResult) {
      await syncHealthHistory(healthResult);
    } else {
      renderHealthTrend(_healthHistory);
    }

    document.getElementById("last-updated").textContent =
      "SYNC: " + new Date().toLocaleTimeString();
  } catch (err) {
    console.error(err);
    document.getElementById("last-updated").textContent =
      "FAULT: " + err.message;
  } finally {
    setLoading(false);
  }
}

// ═══════════════════════════════
// NET WORTH
// ═══════════════════════════════
function renderNetWorth(account, DBS, SC) {
  const brokerageUSD = parseFloat(account.NetLiquidation || 0);
  const DBSSGD = parseFloat(
    DBS.account.balance || DBS.account.current_balance || 0,
  );
  const SCSGD = parseFloat(
    SC.account.balance || SC.account.current_balance || 0,
  );
  // Convert brokerage to SGD for total net worth
  const brokerageSGD = toSGD(brokerageUSD);
  const totalNetSGD = brokerageSGD + DBSSGD + SCSGD;
  const unrealUSD = parseFloat(account.UnrealizedPnL || 0);
  const realUSD = parseFloat(account.RealizedPnL || 0);
  document.getElementById("networth-bar").innerHTML = `
    <div class="nw-item">
      <div class="nw-label">TOTAL NET WORTH</div>
      <div class="nw-value a1">${fmtSGD(totalNetSGD)}</div>
      <div class="nw-ccy-note">BROKERAGE CONVERTED @ ${USD_TO_SGD} USD/SGD</div>
    </div>
    <div class="nw-divider"></div>
    <div class="nw-item">
      <div class="nw-label">BROKERAGE</div>
      <div class="nw-value a2">${fmtUSD(brokerageUSD)}</div>
      <div class="nw-ccy-note">≈ ${fmtSGD(brokerageSGD)}</div>
    </div>
    <div class="nw-item">
      <div class="nw-label">DBS CHECKING</div>
      <div class="nw-value">${fmtSGD(DBSSGD)}</div>
    </div>
    <div class="nw-item">
      <div class="nw-label">SC SAVINGS</div>
      <div class="nw-value">${fmtSGD(SCSGD)}</div>
    </div>
    <div class="nw-divider"></div>
    <div class="nw-item">
      <div class="nw-label">UNREALIZED P&amp;L</div>
      <div class="nw-value ${pnlClass(unrealUSD)}">${fmtUSD(unrealUSD)}</div>
    </div>
    <div class="nw-item">
      <div class="nw-label">REALIZED P&amp;L</div>
      <div class="nw-value ${pnlClass(realUSD)}">${fmtUSD(realUSD)}</div>
    </div>
    <div class="nw-divider"></div>
    <div class="nw-item">
      <div class="nw-label">AVG MONTHLY INCOME</div>
      <div class="nw-value pos">${fmtSGD(DBS.monthly_income)}</div>
    </div>
    <div class="nw-item">
      <div class="nw-label">AVG MONTHLY EXPENSES</div>
      <div class="nw-value neg">${fmtSGD(DBS.monthly_expenses)}</div>
    </div>`;
}

// ═══════════════════════════════
// BANK CARDS
// ═══════════════════════════════
function filterByTimeline(items) {
  if (_timelineMonths >= 12) return items;
  const allDates = items
    .map((t) => t.date)
    .filter(Boolean)
    .sort();
  if (!allDates.length) return items;
  const latest = new Date(allDates[allDates.length - 1]);
  const cutoff = new Date(
    latest.getFullYear(),
    latest.getMonth() - _timelineMonths + 1,
    1,
  );
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;
  return items.filter((t) => t.date >= cutoffStr);
}

function renderBankCards(DBS, SC) {
  function card(b, tag, tagClass) {
    const a = b.account;
    // Key names come from CSV col B — support both old and new naming conventions
    const bankName = a.bank_name || a.name || a.bank || tag;
    const acctType = a.account_type || a.type || a.acct_type || "ACCOUNT";
    const acctNum = a.account_number || a.account_no || a.number || "—";
    const intRate = parseFloat(a.interest_rate || a.rate || a.apy || 0);
    const rateLabel = intRate > 1 ? `APY ${intRate}%` : `APR ${intRate}%`;
    const balance = a.balance || a.current_balance || 0;
    const inc = filterByTimeline(b.income);
    const exp = filterByTimeline(b.expenses);
    const totalInc = inc.reduce((s, t) => s + t.amount, 0);
    const totalExp = exp.reduce((s, t) => s + t.amount, 0);
    const netCF = totalInc - totalExp;
    const months = Math.min(_timelineMonths, 12);
    const maxV = Math.max(totalInc, totalExp, 1);
    const iPct = ((totalInc / maxV) * 100).toFixed(1);
    const ePct = ((totalExp / maxV) * 100).toFixed(1);
    const recent = [...inc, ...exp]
      .sort((x, y) => y.date.localeCompare(x.date))
      .slice(0, 6);
    return `<div class="card">
      <div class="bank-header">
        <div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div class="bank-name">${bankName.toUpperCase()}</div>
            <span class="card-tag ${tagClass}">${tag.toUpperCase()}</span>
          </div>
          <div class="bank-meta">${acctType.toUpperCase()} · ${acctNum}</div>
        </div>
        <div style="text-align:right">
          <div class="bank-bal">${fmtSGD(balance)}</div>
          <div class="bank-rate">${rateLabel.toUpperCase()}</div>
        </div>
      </div>
      <div style="display:flex;gap:0.75rem;margin-bottom:0.9rem">
        <div class="stat-card" style="flex:1">
          <div class="stat-label">INCOME</div>
          <div class="stat-value pos" style="font-size:1rem">${fmtSGD(totalInc)}</div>
          <div class="stat-sub">${months}MO · ~${fmtSGD(totalInc / months)}/MO</div>
        </div>
        <div class="stat-card" style="flex:1;border-left-color:var(--red2)">
          <div class="stat-label">EXPENSES</div>
          <div class="stat-value neg" style="font-size:1rem">${fmtSGD(totalExp)}</div>
          <div class="stat-sub">${months}MO · ~${fmtSGD(totalExp / months)}/MO</div>
        </div>
        <div class="stat-card" style="flex:1;border-left-color:var(--amber)">
          <div class="stat-label">NET FLOW</div>
          <div class="stat-value ${pnlClass(netCF)}" style="font-size:1rem">${fmtSGD(netCF)}</div>
          <div class="stat-sub">${months}-MONTH TOTAL</div>
        </div>
      </div>
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin-bottom:2px;letter-spacing:0.1em"><span>INCOME</span><span>${fmtSGD(totalInc)}</span></div>
        <div class="cf-bar"><div class="cf-fill" style="width:${iPct}%;background:var(--green)"></div></div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin-bottom:2px;margin-top:0.4rem;letter-spacing:0.1em"><span>EXPENSES</span><span>${fmtSGD(totalExp)}</span></div>
        <div class="cf-bar"><div class="cf-fill" style="width:${ePct}%;background:var(--red2)"></div></div>
      </div>
      <div class="card-title" style="margin-bottom:0.6rem">RECENT TRANSACTIONS</div>
      <div class="tx-list">${recent
        .map(
          (t) => `
        <div class="tx-row">
          <div><div class="tx-desc">${t.description}</div><div class="tx-date">${t.date}</div></div>
          <div class="tx-amount ${t.direction === "credit" ? "pos" : "neg"}">${t.direction === "credit" ? "+" : "-"}${fmtSGD(t.amount)}</div>
        </div>`,
        )
        .join("")}</div>
    </div>`;
  }
  document.getElementById("bank-grid").innerHTML =
    card(DBS, "DBS", "DBS") + card(SC, "SC", "SC");
}

// ═══════════════════════════════
// BANKING CHARTS
// ═══════════════════════════════
function getMonthlyData(bankData, months) {
  const allItems = [...bankData.income, ...bankData.expenses];
  const allDates = allItems
    .map((t) => t.date)
    .filter(Boolean)
    .sort();
  const anchor = allDates.length
    ? new Date(allDates[allDates.length - 1])
    : new Date();
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label =
      MONTH_NAMES[d.getMonth()] +
      (months > 6 ? ` '${String(d.getFullYear()).slice(2)}` : "");
    const inc = bankData.income
      .filter((t) => t.date.startsWith(key))
      .reduce((s, t) => s + t.amount, 0);
    const exp = bankData.expenses
      .filter((t) => t.date.startsWith(key))
      .reduce((s, t) => s + t.amount, 0);
    result.push({ label, inc, exp });
  }
  return result;
}

function renderBankingCharts(DBS, SC) {
  const months = _timelineMonths;
  const DBSMonthly = getMonthlyData(DBS, months);
  makeChart(
    "chart-cashflow-DBS",
    "bar",
    {
      labels: DBSMonthly.map((m) => m.label),
      datasets: [
        {
          label: "Income",
          data: DBSMonthly.map((m) => m.inc),
          backgroundColor: "rgba(57,255,110,0.15)",
          borderColor: "#39ff6e",
          borderWidth: 2,
        },
        {
          label: "Expenses",
          data: DBSMonthly.map((m) => m.exp),
          backgroundColor: "rgba(224,32,32,0.15)",
          borderColor: "#e02020",
          borderWidth: 2,
        },
      ],
    },
    { plugins: { legend: { position: "bottom" } } },
  );

  const SCMonthly = getMonthlyData(SC, months);
  makeChart(
    "chart-cashflow-SC",
    "bar",
    {
      labels: SCMonthly.map((m) => m.label),
      datasets: [
        {
          label: "Income",
          data: SCMonthly.map((m) => m.inc),
          backgroundColor: "rgba(77,166,255,0.15)",
          borderColor: "#4da6ff",
          borderWidth: 2,
        },
        {
          label: "Expenses",
          data: SCMonthly.map((m) => m.exp),
          backgroundColor: "rgba(224,32,32,0.15)",
          borderColor: "#e02020",
          borderWidth: 2,
        },
      ],
    },
    { plugins: { legend: { position: "bottom" } } },
  );

  function buildPie(filtered, fallbackLabels, fallbackData) {
    const cats = {};
    filtered.forEach((e) => {
      const cat = e.description.split(" - ")[0].split(" ")[0];
      cats[cat] = (cats[cat] || 0) + e.amount;
    });
    const keys = Object.keys(cats);
    return {
      labels: keys.length ? keys : fallbackLabels,
      data: keys.length ? keys.map((k) => cats[k].toFixed(2)) : fallbackData,
    };
  }

  const cP = buildPie(filterByTimeline(DBS.expenses), [], []);
  makeChart(
    "chart-expenses-DBS",
    "doughnut",
    {
      labels: cP.labels,
      datasets: [{ data: cP.data, backgroundColor: COLORS, borderWidth: 0 }],
    },
    {
      plugins: {
        legend: { position: "right", labels: { font: { size: 10 } } },
      },
    },
  );

  const mP = buildPie(
    filterByTimeline(SC.expenses),
    ["Transfers to Brokerage", "Emergency Fund"],
    [9000, 1500],
  );
  makeChart(
    "chart-expenses-SC",
    "doughnut",
    {
      labels: mP.labels,
      datasets: [{ data: mP.data, backgroundColor: COLORS, borderWidth: 0 }],
    },
    {
      plugins: {
        legend: { position: "right", labels: { font: { size: 10 } } },
      },
    },
  );
}

// ═══════════════════════════════
// PORTFOLIO — sort + filter
// ═══════════════════════════════
function sortPositions(col) {
  if (_sortCol === col) _sortDir *= -1;
  else {
    _sortCol = col;
    _sortDir = -1;
  }
  document.querySelectorAll("#positions-table th").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.getAttribute("onclick")?.includes(col))
      th.classList.add(_sortDir === 1 ? "sort-asc" : "sort-desc");
  });
  renderPositionsTable();
}

function filterPositions() {
  renderPositionsTable();
}

function getPortfolioSubtabBucket(position) {
  const secType = (position.sec_type || "").toUpperCase();
  const assetClass = (position.asset_class || "").toLowerCase();

  if (secType === "CRYPTO" || assetClass.includes("digital")) return "crypto";
  if (secType === "STK" || assetClass === "equity" || assetClass === "etf")
    return "equity";
  return "others";
}

function switchPortfolioSubtab(subtab) {
  _portfolioSubtab = subtab;
  document.querySelectorAll(".portfolio-subtab").forEach((btn) => {
    const isActive = btn.getAttribute("onclick")?.includes(`'${subtab}'`);
    btn.classList.toggle("active", !!isActive);
  });
  renderPositionsTable();
}

function renderPositionsTable() {
  const q = document.getElementById("pos-search")?.value.toLowerCase() || "";
  let rows = _allPositions.filter(
    (p) => getPortfolioSubtabBucket(p) === _portfolioSubtab,
  );
  if (q)
    rows = rows.filter(
      (p) =>
        (p.symbol || "").toLowerCase().includes(q) ||
        (p.company_name || "").toLowerCase().includes(q) ||
        (p.sector || "").toLowerCase().includes(q),
    );
  rows.sort((a, b) => {
    const av = typeof a[_sortCol] === "string" ? a[_sortCol] : a[_sortCol] || 0;
    const bv = typeof b[_sortCol] === "string" ? b[_sortCol] : b[_sortCol] || 0;
    return typeof av === "string"
      ? av.localeCompare(bv) * _sortDir
      : (av - bv) * _sortDir;
  });

  if (!rows.length) {
    document.getElementById("positions-body").innerHTML =
      '<tr><td class="pos-empty-row" colspan="12">NO POSITIONS IN THIS SUBTAB.</td></tr>';
    return;
  }

  document.getElementById("positions-body").innerHTML = rows
    .map((p) => {
      const pct52 =
        p.week_52_high > p.week_52_low
          ? (
              ((p.market_price - p.week_52_low) /
                (p.week_52_high - p.week_52_low)) *
              100
            ).toFixed(0)
          : 50;
      const ccy = p.currency || "USD";
      return `<tr>
      <td>
        <div class="sym">${p.symbol}</div>
        <div class="co-name">${p.company_name || ""}</div>
      </td>
      <td>
        <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--muted)">${p.asset_class}</span>
        <span class="ccy-badge">${ccy}</span>
      </td>
      <td style="font-family:var(--font-mono)">${p.position}</td>
      <td style="font-family:var(--font-mono)">${fmtCcy(p.market_price, ccy)}</td>
      <td style="font-family:var(--font-mono)">${fmtCcy(p.market_value, ccy)}</td>
      <td style="font-family:var(--font-mono)">${fmtCcy(p.avg_cost, ccy)}</td>
      <td style="font-family:var(--font-mono)" class="${pnlClass(p.unrealized_pnl)}">${fmtCcy(p.unrealized_pnl, ccy)}</td>
      <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted)">${p.sector || "—"}</td>
      <td style="font-family:var(--font-mono)">${p.dividend_yield > 0 ? fmtPct(p.dividend_yield) : "—"}</td>
      <td style="font-family:var(--font-mono)">${p.pe_ratio > 0 ? p.pe_ratio.toFixed(1) + "x" : "—"}</td>
      <td style="font-family:var(--font-mono)" class="${p.beta > 1.2 ? "neg" : p.beta < 0.8 && p.beta > 0 ? "pos" : ""}">${p.beta > 0 ? p.beta.toFixed(2) : "—"}</td>
      <td style="min-width:110px">
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--muted);display:flex;justify-content:space-between">
          <span>${fmtCcy(p.week_52_low, ccy)}</span><span>${fmtCcy(p.week_52_high, ccy)}</span>
        </div>
        <div class="range-bar"><div class="range-dot" style="left:${pct52}%"></div></div>
      </td>
    </tr>`;
    })
    .join("");
}

function filterTx() {
  const q = document.getElementById("tx-search")?.value.toLowerCase() || "";
  let rows = [..._allTxs];
  if (q)
    rows = rows.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.action.toLowerCase().includes(q),
    );
  document.getElementById("tx-body").innerHTML = rows
    .map(
      (t) => `<tr>
    <td style="font-family:var(--font-mono);font-size:0.75rem">${t.date}</td>
    <td class="sym">${t.symbol}</td>
    <td class="${t.action === "BUY" ? "buy" : "sell"}">${t.action}</td>
    <td style="font-family:var(--font-mono)">${t.quantity}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.price)}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.value)}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.commission)}</td>
    <td style="font-family:var(--font-mono)" class="${pnlClass(t.realized_pnl)}">${t.realized_pnl > 0 ? fmtUSD(t.realized_pnl) : "—"}</td>
  </tr>`,
    )
    .join("");
}

// ═══════════════════════════════
// PORTFOLIO RENDER
// ═══════════════════════════════
function renderPortfolio(positions, txs, account) {
  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  const totalUnreal = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalReal = positions.reduce((s, p) => s + p.realized_pnl, 0);
  const totalCost = positions.reduce((s, p) => s + p.avg_cost * p.position, 0);
  const totalReturn =
    totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
  document.getElementById("portfolio-stats").innerHTML = [
    {
      label: "PORTFOLIO VALUE (USD)",
      value: fmtUSD(totalValue),
      sub: `${positions.length} POSITIONS — LIVE`,
      cls: "",
    },
    {
      label: "TOTAL RETURN",
      value: fmtPct(totalReturn),
      sub: `COST BASIS: ${fmtUSD(totalCost)}`,
      cls: pnlClass(totalReturn),
    },
    {
      label: "UNREALIZED P&L (USD)",
      value: fmtUSD(totalUnreal),
      sub: "OPEN POSITIONS",
      cls: pnlClass(totalUnreal),
    },
    {
      label: "REALIZED P&L (USD)",
      value: fmtUSD(totalReal),
      sub: "CLOSED TRADES",
      cls: pnlClass(totalReal),
    },
  ]
    .map(
      (s) =>
        `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value ${s.cls}">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`,
    )
    .join("");
  renderPositionsTable();
  document.getElementById("tx-body").innerHTML = txs
    .map(
      (t) => `<tr>
    <td style="font-family:var(--font-mono);font-size:0.75rem">${t.date}</td>
    <td class="sym">${t.symbol}</td>
    <td class="${t.action === "BUY" ? "buy" : "sell"}">${t.action}</td>
    <td style="font-family:var(--font-mono)">${t.quantity}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.price)}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.value)}</td>
    <td style="font-family:var(--font-mono)">${fmtUSD(t.commission)}</td>
    <td style="font-family:var(--font-mono)" class="${pnlClass(t.realized_pnl)}">${t.realized_pnl > 0 ? fmtUSD(t.realized_pnl) : "—"}</td>
  </tr>`,
    )
    .join("");
}

// ═══════════════════════════════════════════════════════
// FINANCIAL HEALTH SCORE
// Scoring rubric (all sub-scores 0–100, final = weighted avg):
//
//  1. RISK (20%)       — portfolio beta. Target ≤ 1.0
//  2. DIVERSIFICATION (25%) — Herfindahl index across sector + geo + asset
//  3. INCOME (15%)     — weighted dividend yield vs risk-free rate
//  4. VALUATION (15%)  — avg P/E vs S&P 500 baseline (~24x)
//  5. QUALITY (15%)    — weighted avg profit margin across equities
//  6. LIQUIDITY (10%)  — cash as % of net worth
// ═══════════════════════════════════════════════════════
function computeHealthScore(positions, account, DBS, SC) {
  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  if (totalValue === 0) return null;

  // ── 1. RISK ──────────────────────────────────────────
  const betas = positions.filter((p) => p.beta > 0);
  const wBeta = betas.length
    ? betas.reduce((s, p) => s + p.beta * p.market_value, 0) / totalValue
    : 1.0;
  // Score: 100 at beta=0, 70 at beta=1.0, 40 at beta=1.5, 0 at beta=2.5+
  const riskScore = Math.max(0, Math.min(100, 100 - wBeta * 40));

  // ── 2. DIVERSIFICATION — Herfindahl-Hirschman Index ──
  // HHI = sum of squared weight fractions. Lower = more diverse.
  // Pure HHI: 1.0 = total concentration. 0.1 = well spread across 10+.
  function hhi(map) {
    const vals = Object.values(map);
    const total = vals.reduce((a, b) => a + b, 0);
    if (!total) return 1;
    return vals.reduce((s, v) => s + Math.pow(v / total, 2), 0);
  }
  function groupBy(key) {
    const m = {};
    positions.forEach((p) => (m[p[key]] = (m[p[key]] || 0) + p.market_value));
    return m;
  }
  const sectorHHI = hhi(groupBy("sector"));
  const geoHHI = hhi(groupBy("geography"));
  const assetHHI = hhi(groupBy("asset_class"));
  const avgHHI = (sectorHHI + geoHHI + assetHHI) / 3;
  // Score: 100 at HHI=0.05 (very diverse), 0 at HHI=1.0 (single holding)
  const divScore = Math.max(0, Math.min(100, (1 - avgHHI) * 105));

  // ── 3. INCOME ─────────────────────────────────────────
  const divPos = positions.filter((p) => p.dividend_yield > 0);
  const wDiv = divPos.length
    ? divPos.reduce((s, p) => s + p.dividend_yield * p.market_value, 0) /
      totalValue
    : 0;
  // Compare weighted yield to risk-free rate (4.42% 10Y treasury)
  const riskFree = 4.42;
  // Score: 100 if yield >= 2× risk-free; 50 at parity; 20 at 0
  const incomeScore = Math.max(0, Math.min(100, (wDiv / (riskFree * 2)) * 100));

  // ── 4. VALUATION ──────────────────────────────────────
  const equities = positions.filter((p) => p.pe_ratio > 0 && p.pe_ratio < 200);
  const avgPE = equities.length
    ? equities.reduce((s, p) => s + p.pe_ratio, 0) / equities.length
    : 24;
  // Score: 100 at PE=10, 75 at PE=20, 50 at PE=30, 0 at PE=60+
  const valScore = Math.max(0, Math.min(100, 100 - ((avgPE - 10) / 50) * 100));

  // ── 5. QUALITY — profit margin ────────────────────────
  const withMargin = positions.filter((p) => p.profit_margin !== 0);
  const wMargin = withMargin.length
    ? withMargin.reduce((s, p) => s + p.profit_margin * p.market_value, 0) /
      withMargin.reduce((s, p) => s + p.market_value, 0)
    : 0;
  // Score: 100 at margin=40%+, 50 at 15%, 0 at 0%
  const qualityScore = Math.max(0, Math.min(100, (wMargin / 40) * 100));

  // ── 6. LIQUIDITY ──────────────────────────────────────
  const cash = parseFloat(account.TotalCashValue || 0);
  const DBSbal = parseFloat(
    DBS.account.balance || DBS.account.current_balance || 0,
  );
  const SCbal = parseFloat(
    SC.account.balance || SC.account.current_balance || 0,
  );
  const totalCash = cash + DBSbal + SCbal;
  const netWorth = totalValue + totalCash;
  const cashPct = netWorth > 0 ? (totalCash / netWorth) * 100 : 0;
  // Score: 100 at 20%+ cash, 75 at 10%, 50 at 5%, 0 at 0%
  const liquidityScore = Math.max(0, Math.min(100, (cashPct / 20) * 100));

  // ── WEIGHTED FINAL ────────────────────────────────────
  const weights = {
    risk: 0.2,
    div: 0.25,
    income: 0.15,
    val: 0.15,
    quality: 0.15,
    liquidity: 0.1,
  };
  const total = Math.round(
    riskScore * weights.risk +
      divScore * weights.div +
      incomeScore * weights.income +
      valScore * weights.val +
      qualityScore * weights.quality +
      liquidityScore * weights.liquidity,
  );

  return {
    total,
    breakdown: [
      {
        label: "DIVERSIFICATION",
        score: Math.round(divScore),
        weight: "25%",
        detail: `Avg HHI ${avgHHI.toFixed(2)}`,
      },
      {
        label: "RISK",
        score: Math.round(riskScore),
        weight: "20%",
        detail: `Wtd beta ${wBeta.toFixed(2)}`,
      },
      {
        label: "INCOME",
        score: Math.round(incomeScore),
        weight: "15%",
        detail: `Div yield ${wDiv.toFixed(2)}%`,
      },
      {
        label: "VALUATION",
        score: Math.round(valScore),
        weight: "15%",
        detail: `Avg P/E ${avgPE.toFixed(1)}x`,
      },
      {
        label: "QUALITY",
        score: Math.round(qualityScore),
        weight: "15%",
        detail: `Avg margin ${wMargin.toFixed(1)}%`,
      },
      {
        label: "LIQUIDITY",
        score: Math.round(liquidityScore),
        weight: "10%",
        detail: `Cash ${cashPct.toFixed(1)}% of NW`,
      },
    ],
  };
}

function renderHealthScore(positions, account, DBS, SC) {
  const result = computeHealthScore(positions, account, DBS, SC);
  if (!result) return null;

  _lastHealthScore = result.total; // cache for AI insights

  const el = document.getElementById("health-score-panel");
  if (!el) return;

  const score = result.total;
  const color =
    score >= 70 ? "var(--green)" : score >= 45 ? "var(--amber)" : "var(--red2)";
  const grade =
    score >= 80
      ? "A"
      : score >= 65
        ? "B"
        : score >= 50
          ? "C"
          : score >= 35
            ? "D"
            : "F";
  const label =
    score >= 70 ? "HEALTHY" : score >= 45 ? "MODERATE RISK" : "NEEDS ATTENTION";

  const breakdownHTML = result.breakdown
    .map((b) => {
      const bColor =
        b.score >= 70
          ? "var(--green)"
          : b.score >= 45
            ? "var(--amber)"
            : "var(--red2)";
      return `<div class="progress-row">
      <div class="progress-label" style="width:155px">${b.label} <span style="color:var(--muted);font-size:0.6rem">${b.weight}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${b.score}%;background:${bColor}"></div></div>
      <div class="progress-val">${b.score}<span style="font-size:0.55rem;color:var(--muted)">/100</span></div>
    </div>
    <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin:-0.25rem 0 0.45rem 160px">${b.detail}</div>`;
    })
    .join("");

  el.innerHTML = `
    <div style="display:flex;gap:1.5rem;align-items:center;margin-bottom:1.25rem">
      <div class="health-score-ring" style="--score-color:${color}">
        <div class="health-score-num" style="color:${color}">${score}</div>
        <div class="health-score-grade" style="color:${color}">${grade}</div>
      </div>
      <div>
        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);letter-spacing:0.15em;margin-bottom:4px">PORTFOLIO HEALTH</div>
        <div style="font-family:var(--font-disp);font-size:1.6rem;letter-spacing:0.12em;color:${color}">${label}</div>
        <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--muted);margin-top:4px">WEIGHTED ACROSS 6 DIMENSIONS · HIGHER = BETTER</div>
      </div>
    </div>
    ${breakdownHTML}`;

  return result;
}

async function syncHealthHistory(result) {
  if (!result || typeof result.total !== "number") {
    renderHealthTrend(_healthHistory);
    return;
  }

  const latest = _healthHistory.length
    ? _healthHistory[_healthHistory.length - 1]
    : null;
  const latestTs = latest?.timestamp ? Date.parse(latest.timestamp) : NaN;
  const nowMs = Date.now();
  if (
    latest &&
    Number.isFinite(latestTs) &&
    nowMs - latestTs < 120000 &&
    latest.score === result.total
  ) {
    renderHealthTrend(_healthHistory);
    return;
  }

  try {
    const res = await fetch("/api/health/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: result.total,
        breakdown: result.breakdown.map((b) => ({
          label: b.label,
          score: b.score,
        })),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      _healthHistory = data.history || _healthHistory;
    }
  } catch (err) {
    console.warn("Failed to sync health history", err);
  }

  renderHealthTrend(_healthHistory);
}

function renderHealthTrend(history) {
  const meta = document.getElementById("health-trend-meta");

  function toMs(h) {
    const raw = h.timestamp || h.date;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toLabel(h) {
    if (h.label) return h.label;
    const raw = h.timestamp || h.date;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw || "");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd} ${hh}:${mi}`;
  }

  const clean = (history || [])
    .filter((h) => typeof h.score === "number" && !!(h.timestamp || h.date))
    .sort((a, b) => toMs(a) - toMs(b));

  if (!clean.length) {
    if (meta)
      meta.textContent =
        "HISTORY SNAPSHOTS WILL APPEAR ONCE A HEALTH SCORE IS RECORDED.";
    if (CHARTS["chart-health-trend"]) {
      CHARTS["chart-health-trend"].destroy();
      delete CHARTS["chart-health-trend"];
    }
    return;
  }

  const labels = clean.map((h) => toLabel(h));
  const scores = clean.map((h) => h.score);
  const latest = scores[scores.length - 1];
  const previous = scores.length > 1 ? scores[scores.length - 2] : null;

  if (meta) {
    if (previous === null) {
      meta.textContent = `LATEST ${latest}/100 · BASELINE CREATED · ${clean.length} SNAPSHOT`;
    } else {
      const delta = latest - previous;
      const cls = delta >= 0 ? "pos" : "neg";
      const sign = delta > 0 ? "+" : "";
      meta.innerHTML = `LATEST ${latest}/100 · CHANGE VS PREV <span class="${cls}">${sign}${delta}</span> · ${clean.length} SNAPSHOTS`;
    }
  }

  makeChart(
    "chart-health-trend",
    "line",
    {
      labels,
      datasets: [
        {
          label: "Health Score",
          data: scores,
          borderColor: "#39ff6e",
          backgroundColor: "rgba(57,255,110,0.12)",
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 4,
        },
      ],
    },
    {
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
        },
      },
    },
  );
}

// ═══════════════════════════════════════════════════════
// DIVERSIFICATION WARNINGS
// ═══════════════════════════════════════════════════════
function checkConcentration(map, totalValue, label) {
  const warnings = [];
  Object.entries(map).forEach(([key, val]) => {
    const pct = val / totalValue;
    if (pct > ALERT_THRESHOLD) {
      warnings.push({
        level: "alert",
        text: `${key} represents ${(pct * 100).toFixed(1)}% of ${label}`,
      });
    } else if (pct > WARN_THRESHOLD) {
      warnings.push({
        level: "warn",
        text: `${key} represents ${(pct * 100).toFixed(1)}% of ${label}`,
      });
    }
  });
  return warnings;
}

function renderDiversificationWarnings(positions) {
  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  if (!totalValue) return;

  function groupBy(key) {
    const m = {};
    positions.forEach((p) => (m[p[key]] = (m[p[key]] || 0) + p.market_value));
    return m;
  }

  const allWarnings = [
    ...checkConcentration(groupBy("sector"), totalValue, "SECTOR ALLOCATION"),
    ...checkConcentration(
      groupBy("geography"),
      totalValue,
      "GEOGRAPHIC EXPOSURE",
    ),
    ...checkConcentration(
      groupBy("asset_class"),
      totalValue,
      "ASSET CLASS BREAKDOWN",
    ),
  ];

  const container = document.getElementById("diversification-warnings");
  if (!container) return;

  if (!allWarnings.length) {
    container.innerHTML = `<div class="div-warn ok">◉ NO CONCENTRATION WARNINGS — PORTFOLIO APPEARS WELL DISTRIBUTED</div>`;
    return;
  }

  container.innerHTML = allWarnings
    .map(
      (w) =>
        `<div class="div-warn ${w.level}">
      ${w.level === "alert" ? "⚠ ALERT:" : "△ WARNING:"} ${w.text}
    </div>`,
    )
    .join("");
}

// ═══════════════════════════════
// ANALYSIS
// ═══════════════════════════════
function renderAnalysis(positions) {
  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  function groupBy(key) {
    const m = {};
    positions.forEach((p) => (m[p[key]] = (m[p[key]] || 0) + p.market_value));
    return m;
  }
  const sectorMap = groupBy("sector"),
    assetMap = groupBy("asset_class"),
    geoMap = groupBy("geography");

  function doughnut(id, map) {
    const keys = Object.keys(map);
    makeChart(
      id,
      "doughnut",
      {
        labels: keys,
        datasets: [
          {
            data: keys.map((k) => map[k].toFixed(2)),
            backgroundColor: COLORS,
            borderWidth: 0,
          },
        ],
      },
      {
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 10 } } },
        },
      },
    );
  }
  doughnut("chart-sector", sectorMap);
  doughnut("chart-asset", assetMap);
  doughnut("chart-geo", geoMap);

  // Render diversification warnings below the charts
  renderDiversificationWarnings(positions);

  const spy = positions.find((p) => p.symbol === "SPY");
  const qqq = positions.find((p) => p.symbol === "QQQ");
  const cost = positions.reduce((s, p) => s + p.avg_cost * p.position, 0);
  const val = positions.reduce((s, p) => s + p.market_value, 0);
  const portRet = (((val - cost) / cost) * 100).toFixed(2);
  const spyRet = spy
    ? (((spy.market_price - spy.avg_cost) / spy.avg_cost) * 100).toFixed(2)
    : "N/A";
  const qqqRet = qqq
    ? (((qqq.market_price - qqq.avg_cost) / qqq.avg_cost) * 100).toFixed(2)
    : "N/A";

  document.getElementById("benchmark-grid").innerHTML = [
    { label: "YOUR PORTFOLIO", value: portRet + "%", cls: pnlClass(portRet) },
    {
      label: "SPY (S&P 500)",
      value: spyRet + (spyRet !== "N/A" ? "%" : ""),
      cls: spyRet !== "N/A" ? pnlClass(spyRet) : "",
    },
    {
      label: "QQQ (NASDAQ 100)",
      value: qqqRet + (qqqRet !== "N/A" ? "%" : ""),
      cls: qqqRet !== "N/A" ? pnlClass(qqqRet) : "",
    },
    { label: "FED FUNDS RATE", value: "5.25%", cls: "" },
    { label: "SC SAVINGS APY", value: "5.10%", cls: "" },
    { label: "10Y TREASURY", value: "4.42%", cls: "" },
  ]
    .map(
      (b) =>
        `<div class="metric-pill"><div class="metric-pill-label">${b.label}</div><div class="metric-pill-value ${b.cls}">${b.value}</div></div>`,
    )
    .join("");

  const sectorKeys = Object.keys(sectorMap).sort(
    (a, b) => sectorMap[b] - sectorMap[a],
  );
  document.getElementById("sector-bars").innerHTML = sectorKeys
    .map((k, i) => {
      const pct = ((sectorMap[k] / totalValue) * 100).toFixed(1);
      return `<div class="progress-row">
      <div class="progress-label">${k}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]}"></div></div>
      <div class="progress-val">${pct}%</div>
    </div>`;
    })
    .join("");

  const equities = positions.filter((p) => p.pe_ratio > 0);
  const avgPE = equities.length
    ? equities.reduce((s, p) => s + p.pe_ratio, 0) / equities.length
    : 0;
  const betas = positions.filter((p) => p.beta > 0);
  const avgBeta = betas.length
    ? betas.reduce((s, p) => s + p.beta, 0) / betas.length
    : 0;
  const divPos = positions.filter((p) => p.dividend_yield > 0);
  const wDiv = divPos.length
    ? divPos.reduce((s, p) => s + p.dividend_yield * p.market_value, 0) /
      totalValue
    : 0;
  const annDiv = positions.reduce(
    (s, p) => s + (p.market_value * p.dividend_yield) / 100,
    0,
  );
  const sortedByVal = [...positions].sort(
    (a, b) => b.market_value - a.market_value,
  );
  const sortedByBeta = [...positions]
    .filter((p) => p.beta > 0)
    .sort((a, b) => b.beta - a.beta);

  document.getElementById("fundamentals-grid").innerHTML = [
    {
      label: "AVG PORTFOLIO P/E",
      value: avgPE > 0 ? avgPE.toFixed(1) + "x" : "—",
      sub: "S&P 500 AVG: ~24x",
    },
    {
      label: "PORTFOLIO BETA",
      value: avgBeta > 0 ? avgBeta.toFixed(2) : "—",
      sub: avgBeta > 1 ? "ABOVE MARKET RISK" : "BELOW MARKET RISK",
    },
    {
      label: "WEIGHTED DIV YIELD",
      value: wDiv > 0 ? fmtPct(wDiv * 100) : "—",
      sub: `~${fmtUSD(annDiv)}/YR EST.`,
    },
    {
      label: "POSITIONS PAYING DIV",
      value: `${divPos.length} / ${positions.length}`,
      sub: "PAY DIVIDENDS",
    },
    {
      label: "LARGEST POSITION",
      value: sortedByVal[0]?.symbol || "—",
      sub: fmtUSD(sortedByVal[0]?.market_value),
    },
    {
      label: "MOST VOLATILE (BETA)",
      value: sortedByBeta[0]?.symbol || "—",
      sub: sortedByBeta[0] ? "β " + sortedByBeta[0].beta.toFixed(2) : "—",
    },
  ]
    .map(
      (s) =>
        `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value" style="font-size:1.05rem">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`,
    )
    .join("");

  document.getElementById("dividend-bars").innerHTML = divPos
    .sort((a, b) => b.dividend_yield - a.dividend_yield)
    .map(
      (p, i) => `<div class="progress-row">
      <div class="progress-label" style="color:var(--blue2)">${p.symbol}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${((p.dividend_yield / 4) * 100).toFixed(0)}%;background:${COLORS[i]}"></div></div>
      <div class="progress-val">${fmtPct(p.dividend_yield)}</div>
    </div>`,
    )
    .join("");

  const rates = [
    { label: "FED FUNDS RATE", rate: 5.25, note: "UPPER BOUND" },
    { label: "SC SAVINGS APY", rate: 5.1, note: "YOUR SAVINGS RATE" },
    { label: "10Y TREASURY", rate: 4.42, note: "RISK-FREE BENCHMARK" },
    { label: "2Y TREASURY", rate: 4.88, note: "SHORT-TERM BENCHMARK" },
    { label: "TLT DIV YIELD", rate: 3.85, note: "YOUR BOND ETF" },
    {
      label: "PORTFOLIO AVG DIV",
      rate: +(wDiv * 100).toFixed(2),
      note: "WEIGHTED YIELD",
    },
  ];
  document.getElementById("rate-context").innerHTML = rates
    .map(
      (r, i) => `
    <div class="progress-row">
      <div class="progress-label">${r.label}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${((r.rate / 6) * 100).toFixed(0)}%;background:${COLORS[i]}"></div></div>
      <div class="progress-val">${r.rate.toFixed(2)}%</div>
    </div>
    <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin:-0.3rem 0 0.5rem 145px;letter-spacing:0.08em">${r.note}</div>
  `,
    )
    .join("");
}

// ═══════════════════════════════════════════════════════
// RETIREMENT CALCULATOR
// Singapore context:
//   - CPF OA earns 2.5% p.a., SA earns 4.0% p.a.
//   - CPF withdrawal from age 55 (OA+SA above Full Retirement Sum)
//   - CPF LIFE payout from age 65 (estimated from SA balance)
//   - Singapore dividend income is NOT taxed for individuals
//   - Investment income generally not taxed in Singapore
//   - Inflation applied to retirement expense target
// ═══════════════════════════════════════════════════════
const CPF_OA_RATE = 0.025;
const CPF_SA_RATE = 0.04;
const CPF_LIFE_AGE = 65; // approximate LIFE payout start
const CPF_FRS = 205800; // Full Retirement Sum 2024 SGD
const CPF_BRS = 102900; // Basic Retirement Sum

// Estimate monthly CPF LIFE payout from SA balance at 65
// Rough approximation: ~SGD 1,650/mo per FRS held
function estimateCPFLifePayout(saAtSixtyFive) {
  const frsMultiple = Math.min(saAtSixtyFive / CPF_FRS, 2); // capped at 2× FRS
  return Math.round(frsMultiple * 1650);
}

function computeRetirement(p, positions, DBS, SC) {
  const now = new Date().getFullYear();
  const yearsToRetire = p.retirement_age - p.current_age;
  if (yearsToRetire <= 0) return null;

  const growthRate = p.expected_growth_rate / 100;
  const inflationRate = p.expected_inflation_rate / 100;
  const realRate = (1 + growthRate) / (1 + inflationRate) - 1; // Fisher equation

  // Current investable assets (brokerage + savings)
  const portfolioVal = positions.reduce((s, pos) => s + pos.market_value, 0);
  const DBSbal = parseFloat(
    DBS.account.balance || DBS.account.current_balance || 0,
  );
  const SCbal = parseFloat(
    SC.account.balance || SC.account.current_balance || 0,
  );
  const currentAssets = portfolioVal + DBSbal + SCbal;

  // Annual savings from bank data (net cashflow × 12, capped + voluntary)
  const annualSavings =
    DBS.monthly_income * 12 -
    DBS.monthly_expenses * 12 +
    p.monthly_voluntary_contribution * 12;

  // CPF growth projection
  let cpfOA = p.include_cpf ? p.cpf_oa_balance : 0;
  let cpfSA = p.include_cpf ? p.cpf_sa_balance : 0;
  for (let y = 0; y < yearsToRetire; y++) {
    cpfOA = cpfOA * (1 + CPF_OA_RATE);
    cpfSA = cpfSA * (1 + CPF_SA_RATE);
  }

  // CPF withdrawal at 55 — amount above FRS from OA+SA can be withdrawn
  let cpfWithdrawalAt55 = 0;
  if (p.retirement_age >= 55 && p.include_cpf) {
    const yearsTo55 = Math.max(0, 55 - p.current_age);
    let oa55 = p.cpf_oa_balance;
    let sa55 = p.cpf_sa_balance;
    for (let y = 0; y < yearsTo55; y++) {
      oa55 = oa55 * (1 + CPF_OA_RATE);
      sa55 = sa55 * (1 + CPF_SA_RATE);
    }
    const totalAt55 = oa55 + sa55;
    cpfWithdrawalAt55 = Math.max(0, totalAt55 - CPF_FRS);
  }

  // Investment portfolio grows with compound interest + annual savings
  // FV = PV*(1+r)^n + PMT * ((1+r)^n - 1)/r
  const fvPortfolio =
    currentAssets * Math.pow(1 + growthRate, yearsToRetire) +
    (annualSavings * (Math.pow(1 + growthRate, yearsToRetire) - 1)) /
      growthRate;

  // Total investable at retirement
  const totalAtRetirement = fvPortfolio + cpfWithdrawalAt55;

  // Monthly expenses in retirement (inflation-adjusted)
  const inflatedMonthlyExp =
    p.monthly_expenses_retirement * Math.pow(1 + inflationRate, yearsToRetire);
  const inflatedAnnualExp = inflatedMonthlyExp * 12;

  // CPF LIFE monthly payout (if applicable)
  let cpfLifeMonthly = 0;
  if (p.include_cpf && p.retirement_age >= CPF_LIFE_AGE) {
    cpfLifeMonthly = estimateCPFLifePayout(cpfSA);
  }
  const cpfLifeAnnual = cpfLifeMonthly * 12;

  // Net annual draw from portfolio (after CPF LIFE subsidy)
  const netAnnualDraw = Math.max(0, inflatedAnnualExp - cpfLifeAnnual);

  // Safe Withdrawal Rate corpus needed (4% SWR — Singapore: no income tax on investment gains)
  const swrCorpusNeeded = netAnnualDraw / 0.04;

  // Years corpus lasts at real return rate (annuity formula)
  let yearsCorporusLasts = Infinity;
  if (totalAtRetirement > 0 && netAnnualDraw > 0) {
    if (realRate > 0) {
      // n = -ln(1 - corpus*r/PMT) / ln(1+r)
      const ratio = (totalAtRetirement * realRate) / netAnnualDraw;
      if (ratio < 1)
        yearsCorporusLasts = -Math.log(1 - ratio) / Math.log(1 + realRate);
    } else {
      yearsCorporusLasts = totalAtRetirement / netAnnualDraw;
    }
  }

  // Goal check for dividend income goal type
  const annualDivIncome = positions.reduce(
    (s, pos) => s + (pos.market_value * pos.dividend_yield) / 100,
    0,
  );
  const projectedDivAtRetirement =
    annualDivIncome * Math.pow(1 + growthRate, yearsToRetire);

  // Year-by-year projection for chart (portfolio value only, not CPF)
  const chartYears = [],
    chartVals = [],
    chartNeeded = [];
  let runningVal = currentAssets;
  for (let y = 0; y <= Math.min(yearsToRetire + 5, 50); y++) {
    chartYears.push(now + y);
    chartVals.push(Math.round(runningVal));
    chartNeeded.push(Math.round(swrCorpusNeeded));
    if (y < yearsToRetire) {
      runningVal = runningVal * (1 + growthRate) + annualSavings;
    } else {
      runningVal = runningVal * (1 + growthRate) - netAnnualDraw;
      if (runningVal < 0) runningVal = 0;
    }
  }

  return {
    yearsToRetire,
    totalAtRetirement: Math.round(totalAtRetirement),
    swrCorpusNeeded: Math.round(swrCorpusNeeded),
    onTrack: totalAtRetirement >= swrCorpusNeeded,
    gap: Math.round(swrCorpusNeeded - totalAtRetirement),
    inflatedMonthlyExp: Math.round(inflatedMonthlyExp),
    cpfLifeMonthly,
    cpfOAatRetirement: Math.round(cpfOA),
    cpfSAatRetirement: Math.round(cpfSA),
    cpfWithdrawalAt55: Math.round(cpfWithdrawalAt55),
    yearsCorporusLasts: isFinite(yearsCorporusLasts)
      ? Math.round(yearsCorporusLasts)
      : 999,
    projectedDivAtRetirement: Math.round(projectedDivAtRetirement),
    targetAnnualDiv: p.target_annual_dividend || 0,
    annualSavings: Math.round(annualSavings),
    fvPortfolio: Math.round(fvPortfolio),
    chartYears,
    chartVals,
    chartNeeded,
  };
}

async function loadRetirementProfile() {
  try {
    const res = await fetch("/api/profile/retirement");
    if (!res.ok) return;
    _retirementProfile = await res.json();
    populateRetirementForm(_retirementProfile);
    if (_allPositions.length) renderRetirementResults();
  } catch (e) {
    console.error("Could not load retirement profile", e);
  }
}

function populateRetirementForm(p) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  set("r-current-age", p.current_age);
  set("r-retirement-age", p.retirement_age);
  set("r-monthly-exp", p.monthly_expenses_retirement);
  set("r-cpf-oa", p.cpf_oa_balance);
  set("r-cpf-sa", p.cpf_sa_balance);
  set("r-growth-rate", p.expected_growth_rate);
  set("r-inflation-rate", p.expected_inflation_rate);
  set("r-monthly-contrib", p.monthly_voluntary_contribution);
  set("r-goal-type", p.goal_type);
  set("r-target-div", p.target_annual_dividend || "");
  const cpfChk = document.getElementById("r-include-cpf");
  if (cpfChk) cpfChk.checked = p.include_cpf;
  toggleGoalFields();
}

function toggleGoalFields() {
  const sel = document.getElementById("r-goal-type")?.value;
  const divRow = document.getElementById("r-div-row");
  const retRow = document.getElementById("r-retire-row");
  if (divRow)
    divRow.style.display = sel === "dividend_income" ? "flex" : "none";
  if (retRow) retRow.style.display = sel === "retirement_age" ? "flex" : "none";
}

function getFormProfile() {
  const get = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };
  return {
    current_age: parseInt(get("r-current-age")),
    retirement_age: parseInt(get("r-retirement-age")),
    monthly_expenses_retirement: parseFloat(get("r-monthly-exp")),
    cpf_oa_balance: parseFloat(get("r-cpf-oa")),
    cpf_sa_balance: parseFloat(get("r-cpf-sa")),
    expected_growth_rate: parseFloat(get("r-growth-rate")),
    expected_inflation_rate: parseFloat(get("r-inflation-rate")),
    include_cpf: document.getElementById("r-include-cpf")?.checked ?? true,
    monthly_voluntary_contribution: parseFloat(get("r-monthly-contrib")),
    goal_type: get("r-goal-type") || "retirement_age",
    target_annual_dividend: parseFloat(get("r-target-div")) || null,
  };
}

async function saveAndRunRetirement() {
  const profile = getFormProfile();
  _retirementProfile = profile;
  try {
    await fetch("/api/profile/retirement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    document.getElementById("r-save-status").textContent = "✓ SAVED";
    setTimeout(() => {
      document.getElementById("r-save-status").textContent = "";
    }, 2000);
  } catch (e) {
    document.getElementById("r-save-status").textContent = "⚠ SAVE FAILED";
  }
  const retResult = renderRetirementResults();
  if (retResult) _lastRetirementResult = retResult;
  // Trigger AI insights — use last known health score, fall back to 0 if not yet computed
  if (retResult) {
    fetchAiInsights(_lastHealthScore ?? 0, retResult);
  }
}

function renderRetirementResults() {
  if (!_retirementProfile || !_allPositions.length || !_DBSData) return null;
  const r = computeRetirement(
    _retirementProfile,
    _allPositions,
    _DBSData,
    _SCData,
  );
  if (!r) return null;

  const panel = document.getElementById("retirement-results");
  if (!panel) return null;

  const statusColor = r.onTrack ? "var(--green)" : "var(--red2)";
  const statusText = r.onTrack ? "ON TRACK" : "SHORTFALL DETECTED";
  const statusIcon = r.onTrack ? "◉" : "⚠";

  const isDivGoal = _retirementProfile.goal_type === "dividend_income";

  // Build KPI cards — all SGD (retirement inputs are in SGD)
  const kpis = [
    {
      label: "PROJECTED CORPUS (SGD)",
      value: fmtSGD(r.totalAtRetirement),
      sub: `At age ${_retirementProfile.retirement_age}`,
      color: "",
    },
    {
      label: "CORPUS NEEDED (SGD · 4%)",
      value: fmtSGD(r.swrCorpusNeeded),
      sub: "Safe withdrawal rate target",
      color: "",
    },
    {
      label: "CORPUS GAP (SGD)",
      value: r.onTrack ? "SURPLUS " + fmtSGD(Math.abs(r.gap)) : fmtSGD(r.gap),
      sub: r.onTrack ? "You have a surplus" : "Additional capital needed",
      color: statusColor,
    },
    {
      label: "YEARS CORPUS LASTS",
      value: r.yearsCorporusLasts >= 999 ? "∞" : r.yearsCorporusLasts + " YRS",
      sub: `Drawing ${fmtSGD(r.inflatedMonthlyExp)}/mo`,
      color: r.yearsCorporusLasts >= 30 ? "var(--green)" : "var(--amber)",
    },
    {
      label: "ANNUAL SAVINGS (SGD)",
      value: fmtSGD(r.annualSavings),
      sub: "Current trajectory",
      color: "",
    },
    {
      label: "INFLATED MONTHLY EXP (SGD)",
      value: fmtSGD(r.inflatedMonthlyExp),
      sub: `In ${r.yearsToRetire}yr at ${_retirementProfile.expected_inflation_rate}% p.a.`,
      color: "",
    },
  ];

  const cpfHTML = _retirementProfile.include_cpf
    ? `
    <div class="sh" style="margin-top:1.25rem">CPF PROJECTION (SINGAPORE)</div>
    <div class="grid-4" style="margin-bottom:1.25rem">
      ${[
        {
          label: "OA AT RETIREMENT",
          value: fmtSGD(r.cpfOAatRetirement),
          sub: "2.5% p.a. growth",
        },
        {
          label: "SA AT RETIREMENT",
          value: fmtSGD(r.cpfSAatRetirement),
          sub: "4.0% p.a. growth",
        },
        {
          label: "WITHDRAWAL AT 55",
          value: fmtSGD(r.cpfWithdrawalAt55),
          sub: "Above FRS",
        },
        {
          label: "CPF LIFE PAYOUT",
          value:
            r.cpfLifeMonthly > 0 ? fmtSGD(r.cpfLifeMonthly) + "/mo" : "N/A",
          sub: "From age 65 est.",
        },
      ]
        .map(
          (c) => `<div class="stat-card">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value" style="font-size:1rem;color:var(--blue2)">${c.value}</div>
        <div class="stat-sub">${c.sub}</div>
      </div>`,
        )
        .join("")}
    </div>`
    : "";

  const divHTML = isDivGoal
    ? `
    <div class="sh" style="margin-top:1.25rem">DIVIDEND INCOME GOAL</div>
    <div class="grid-2" style="margin-bottom:1.25rem">
      <div class="stat-card">
        <div class="stat-label">PROJECTED DIV INCOME AT RETIREMENT (SGD)</div>
        <div class="stat-value" style="font-size:1.2rem;color:var(--green)">${fmtSGD(r.projectedDivAtRetirement)}/yr</div>
        <div class="stat-sub">Based on current portfolio grown at ${_retirementProfile.expected_growth_rate}% p.a.</div>
      </div>
      <div class="stat-card" style="border-left-color:${r.projectedDivAtRetirement >= r.targetAnnualDiv ? "var(--green)" : "var(--red2)"}">
        <div class="stat-label">TARGET ANNUAL DIVIDEND (SGD)</div>
        <div class="stat-value" style="font-size:1.2rem;color:${r.projectedDivAtRetirement >= r.targetAnnualDiv ? "var(--green)" : "var(--red2)"}">${fmtSGD(r.targetAnnualDiv)}/yr</div>
        <div class="stat-sub">${r.projectedDivAtRetirement >= r.targetAnnualDiv ? "◉ TARGET ACHIEVABLE" : "⚠ SHORTFALL: " + fmtSGD(r.targetAnnualDiv - r.projectedDivAtRetirement)}</div>
      </div>
    </div>`
    : "";

  panel.innerHTML = `
    <div class="retirement-status" style="border-color:${statusColor};background:${statusColor}18;margin-bottom:1.25rem">
      <span style="color:${statusColor};font-size:1.1rem">${statusIcon}</span>
      <span style="font-family:var(--font-disp);font-size:1.1rem;letter-spacing:0.15em;color:${statusColor}">${statusText}</span>
      <span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--muted)">${r.yearsToRetire} YEARS TO TARGET AGE ${_retirementProfile.retirement_age}</span>
    </div>
    <div class="grid-3" style="margin-bottom:1.25rem">
      ${kpis
        .map(
          (
            k,
          ) => `<div class="stat-card" ${k.color ? `style="border-left-color:${k.color}"` : ""}>
        <div class="stat-label">${k.label}</div>
        <div class="stat-value" style="font-size:1rem;${k.color ? `color:${k.color}` : ""}">${k.value}</div>
        <div class="stat-sub">${k.sub}</div>
      </div>`,
        )
        .join("")}
    </div>
    ${cpfHTML}
    ${divHTML}
    <div class="sh" style="margin-top:1.25rem">WEALTH TRAJECTORY</div>
    <div class="card" style="margin-top:0.75rem">
      <div class="chart-wrap tall"><canvas id="chart-retirement"></canvas></div>
    </div>`;

  // Draw trajectory chart after DOM update
  setTimeout(() => {
    const retireIdx = r.yearsToRetire;
    makeChart(
      "chart-retirement",
      "line",
      {
        labels: r.chartYears,
        datasets: [
          {
            label: "Portfolio Value",
            data: r.chartVals,
            borderColor: "#e8620a",
            backgroundColor: "rgba(232,98,10,0.08)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: r.chartYears.map((_, i) => (i === retireIdx ? 6 : 0)),
            pointBackgroundColor: "#f0a500",
          },
          {
            label: "Corpus Needed",
            data: r.chartNeeded,
            borderColor: "#3d5068",
            borderDash: [6, 3],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      {
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (ctx) => " " + fmt(ctx.raw) } },
          annotation: {},
        },
        scales: {
          y: {
            ticks: {
              callback: (v) =>
                "S$" +
                (v >= 1e6
                  ? (v / 1e6).toFixed(1) + "M"
                  : (v / 1e3).toFixed(0) + "K"),
            },
          },
        },
      },
    );
  }, 50);
  return r; // caller uses this to trigger AI insights
}

// ═══════════════════════════════════════════════════════
// GEMINI AI INSIGHTS
// One call per user action (Calculate button OR manual trigger).
// Sends only pre-computed scalars — no raw positions.
// Result cached in _lastInsights; cleared on next Calculate.
// ═══════════════════════════════════════════════════════
let _lastInsights = null;
let _insightsLoading = false;
let _lastRetirementResult = null; // cached so manual button can reuse it

// Manual trigger — called by the "Request AI Analysis" button in Analysis tab
async function requestAiAnalysis() {
  const btn = document.getElementById("btn-ai-request");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "QUERYING...";
  }

  // Re-run retirement calc if we have a profile, otherwise use cached result
  let retResult = _lastRetirementResult;
  if (_retirementProfile && _allPositions.length && _DBSData) {
    retResult = computeRetirement(
      _retirementProfile,
      _allPositions,
      _DBSData,
      _SCData,
    );
    _lastRetirementResult = retResult;
  }

  if (!retResult) {
    const panel = document.getElementById("ai-insights-panel");
    if (panel)
      panel.innerHTML = `<div class="ai-error">⚠ Run the Retirement Calculator first to provide projection context for the AI analysis.</div>`;
    const sh = document.getElementById("ai-insights-sh");
    if (sh) sh.style.display = "";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "▶ REQUEST AI ANALYSIS";
    }
    return;
  }

  await fetchAiInsights(_lastHealthScore ?? 0, retResult);
  if (btn) {
    btn.disabled = false;
    btn.textContent = "▶ REQUEST AI ANALYSIS";
  }
}

// Poll rate-limit status once on load and after each call
async function fetchAiStatus() {
  try {
    const res = await fetch("/api/ai/status");
    if (!res.ok) return;
    const data = await res.json();
    renderAiMeter(data);
  } catch {
    /* silently ignore */
  }
}

function renderAiMeter(status) {
  const el = document.getElementById("ai-rate-meter");
  if (!el) return;

  if (!status.configured) {
    el.innerHTML = `<span class="ai-meter-label">GEMINI</span>
      <span class="ai-meter-unconfigured">NOT CONFIGURED — SET GEMINI_API_KEY</span>`;
    return;
  }

  const used = status.rpm_used;
  const limit = status.rpm_limit;
  const pct = Math.min((used / limit) * 100, 100);
  const color =
    used >= limit
      ? "var(--red2)"
      : used >= limit * 0.67
        ? "var(--amber)"
        : "var(--green)";

  el.innerHTML = `
    <span class="ai-meter-label">GEMINI RPM</span>
    <div class="ai-meter-track">
      <div class="ai-meter-fill" style="width:${pct}%;background:${color}"></div>
    </div>
    <span class="ai-meter-val" style="color:${color}">${used}/${limit}</span>
    <span class="ai-meter-model">${status.model}</span>`;
}

// Build the minimal payload from already-computed globals
function buildInsightPayload(healthScore, retirementResult) {
  const positions = _allPositions;
  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);

  function groupFrac(key) {
    const m = {};
    positions.forEach((p) => (m[p[key]] = (m[p[key]] || 0) + p.market_value));
    Object.keys(m).forEach((k) => (m[k] = m[k] / totalValue));
    return m;
  }

  const betas = positions.filter((p) => p.beta > 0);
  const avgBeta = betas.length
    ? betas.reduce((s, p) => s + p.beta * p.market_value, 0) /
      betas.reduce((s, p) => s + p.market_value, 0)
    : 0;
  const divPos = positions.filter((p) => p.dividend_yield > 0);
  const wDiv = divPos.length
    ? divPos.reduce((s, p) => s + p.dividend_yield * p.market_value, 0) /
      totalValue
    : 0;
  const equities = positions.filter((p) => p.pe_ratio > 0 && p.pe_ratio < 200);
  const avgPE = equities.length
    ? equities.reduce((s, p) => s + p.pe_ratio, 0) / equities.length
    : 0;

  const p = _retirementProfile;
  return {
    portfolio_value: totalValue,
    sector_breakdown: groupFrac("sector"),
    asset_breakdown: groupFrac("asset_class"),
    geo_breakdown: groupFrac("geography"),
    avg_beta: parseFloat(avgBeta.toFixed(2)),
    weighted_div_yield: parseFloat(wDiv.toFixed(2)),
    avg_pe: parseFloat(avgPE.toFixed(1)),
    health_score: healthScore,
    years_to_retirement: retirementResult.yearsToRetire,
    on_track: retirementResult.onTrack,
    projected_corpus: retirementResult.totalAtRetirement,
    corpus_needed: retirementResult.swrCorpusNeeded,
    goal_type: p.goal_type,
    current_age: p.current_age,
    retirement_age: p.retirement_age,
    expected_growth_rate: p.expected_growth_rate,
    inflation_rate: p.expected_inflation_rate,
    target_annual_dividend: p.target_annual_dividend || null,
    projected_div_at_retirement:
      retirementResult.projectedDivAtRetirement || null,
  };
}

async function fetchAiInsights(healthScore, retirementResult) {
  const panel = document.getElementById("ai-insights-panel");
  if (!panel) return;
  if (!_retirementProfile) return;

  _insightsLoading = true;
  panel.innerHTML = `<div class="ai-loading">
    <div class="ai-loading-bar"></div>
    <span>QUERYING GEMINI...</span>
  </div>`;

  const payload = buildInsightPayload(healthScore, retirementResult);

  try {
    const res = await fetch("/api/ai/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    fetchAiStatus(); // refresh meter after call

    if (res.status === 429) {
      const err = await res.json();
      panel.innerHTML = `<div class="ai-error">⏱ ${err.detail}</div>`;
      return;
    }
    if (res.status === 503) {
      panel.innerHTML = `<div class="ai-error">⚠ Gemini not configured — add GEMINI_API_KEY to your .env</div>`;
      return;
    }
    if (!res.ok) {
      const err = await res.json();
      panel.innerHTML = `<div class="ai-error">⚠ ${err.detail}</div>`;
      return;
    }

    const { data, model } = await res.json();
    _lastInsights = data;
    renderAiInsights(data, model);
  } catch (e) {
    panel.innerHTML = `<div class="ai-error">⚠ Network error: ${e.message}</div>`;
  } finally {
    _insightsLoading = false;
  }
}

function renderAiInsights(data, model) {
  const panel = document.getElementById("ai-insights-panel");
  if (!panel) return;

  // Reveal the section header in Analysis tab
  const sh = document.getElementById("ai-insights-sh");
  if (sh) sh.style.display = "";

  // Show callout in Retirement tab pointing user to Analysis
  const callout = document.getElementById("r-ai-callout");
  if (callout) callout.style.display = "";

  // Inject live exchange rate into POC disclaimer
  const rateSpan = document.getElementById("poc-rate-val");
  if (rateSpan) rateSpan.textContent = USD_TO_SGD;

  const flagHTML = data.assumption_flag
    ? `<div class="ai-flag">
        <span class="ai-flag-label">⚡ ASSUMPTION CHECK</span>
        <span>${data.assumption_flag}</span>
       </div>`
    : "";

  const divHTML = data.dividend_feasibility
    ? `<div class="ai-flag" style="border-color:var(--blue2)">
        <span class="ai-flag-label" style="color:var(--blue2)">◈ DIVIDEND GOAL</span>
        <span>${data.dividend_feasibility}</span>
       </div>`
    : "";

  const obsHTML = data.observations
    .map((o) => `<li class="ai-obs">${o}</li>`)
    .join("");

  const sigHTML = data.rebalance_signals
    .map((s) => `<div class="ai-signal">→ ${s}</div>`)
    .join("");

  panel.innerHTML = `
    <div class="ai-header">
      <span class="ai-badge">✦ GEMINI</span>
      <span class="ai-model-tag">${model}</span>
      <span class="ai-disclaimer">INFORMATIONAL — NOT FINANCIAL ADVICE</span>
    </div>

    <div class="ai-narrative">${data.narrative}</div>

    ${flagHTML}
    ${divHTML}

    <div class="ai-section-label">OBSERVATIONS</div>
    <ul class="ai-obs-list">${obsHTML}</ul>

    <div class="ai-section-label">REBALANCING SIGNALS</div>
    <div class="ai-signals">${sigHTML}</div>`;
}

// Helper to avoid breaking if element doesn't exist
function _(id) {
  return document.getElementById(id);
}

// ═══════════════════════════════
// INIT
// ═══════════════════════════════
async function ensureAuth() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    window.location.href = "/static/login.html";
    return false;
  }
  return true;
}

(async () => {
  if (!(await ensureAuth())) return;
  setTimeline(12);
  await load();
  await loadRetirementProfile();
  fetchAiStatus();
  setInterval(load, 300000);
  setInterval(fetchAiStatus, 15000); // refresh meter every 15s
})();
