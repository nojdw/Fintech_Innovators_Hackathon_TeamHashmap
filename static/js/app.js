// ═══════════════════════════════
// GLOBALS
// ═══════════════════════════════
const CHARTS = {};
const COLORS = ['#e8620a','#f0a500','#39ff6e','#0d6fff','#e02020','#ff8c42','#4da6ff','#00c44f','#ffd166','#ff4444'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let _allPositions = [];
let _allTxs = [];
let _chaseData = null;
let _marcusData = null;
let _timelineMonths = 12;
let _sortCol = 'market_value';
let _sortDir = -1;

// ═══════════════════════════════
// HELPERS
// ═══════════════════════════════
function fmt(v, pre='$'){
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return pre + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtPct(v){ return parseFloat(v).toFixed(2)+'%'; }
function pnlClass(v){ return parseFloat(v) >= 0 ? 'pos' : 'neg'; }

function setLoading(on){
  document.getElementById('loading-bar').classList.toggle('active', on);
  const btn = document.getElementById('btn-refresh');
  btn.disabled = on;
  btn.textContent = on ? 'SYNCING...' : '↺ RESYNC';
}

function makeChart(id, type, data, options={}){
  if (CHARTS[id]) CHARTS[id].destroy();
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  CHARTS[id] = new Chart(ctx, { type, data, options: {
    responsive: true, maintainAspectRatio: true,
    plugins:{ legend:{ labels:{ color:'#3d5068', font:{ family:'Share Tech Mono', size:10 }, boxWidth:10 }}},
    scales: (type==='bar'||type==='line') ? {
      x:{ ticks:{ color:'#3d5068', font:{family:'Share Tech Mono',size:9}}, grid:{color:'#141b28'}},
      y:{ ticks:{ color:'#3d5068', font:{family:'Share Tech Mono',size:9}}, grid:{color:'#141b28'}}
    } : {},
    ...options
  }});
}

// ═══════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════
function switchTab(name){
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.nav-tab[onclick*="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  setTimeout(() => Object.values(CHARTS).forEach(c => c?.update()), 50);
}

// ═══════════════════════════════
// TIMELINE
// ═══════════════════════════════
function setTimeline(months){
  _timelineMonths = months;
  document.querySelectorAll('.tl-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.includes(
      months===1?'MONTHLY':months===6?'SEMI':'ANNUAL'
    ));
  });
  const labels = {1:'[ MONTHLY VIEW ]', 6:'[ SEMI-ANNUAL — 6 MONTHS ]', 12:'[ ANNUAL — 12 MONTHS ]'};
  document.getElementById('timeline-label-text').textContent = labels[months];
  if (_chaseData && _marcusData) {
    renderBankingCharts(_chaseData, _marcusData);
    renderBankCards(_chaseData, _marcusData);
  }
}

// ═══════════════════════════════
// FORCE REFRESH
// ═══════════════════════════════
async function forceRefresh(){
  await fetch('/api/refresh');
  await load();
}

// ═══════════════════════════════
// MAIN LOAD
// ═══════════════════════════════
async function load(){
  setLoading(true);
  try {
    const [sR,aR,pR,tR,cR,mR] = await Promise.all([
      fetch('/api/status'), fetch('/api/account'), fetch('/api/portfolio'),
      fetch('/api/transactions'), fetch('/api/bank/chase'), fetch('/api/bank/marcus')
    ]);
    const status    = await sR.json();
    const account   = await aR.json();
    const portfolio = await pR.json();
    const txData    = await tR.json();
    _chaseData      = await cR.json();
    _marcusData     = await mR.json();
    _allPositions   = portfolio.positions;
    _allTxs         = txData.transactions;

    const cacheAge = status.cached?.portfolio;
    const el = document.getElementById('data-source-note');
    if (el) el.innerHTML = cacheAge != null
      ? `<span style="color:var(--muted)">CACHE: ${cacheAge}s AGO</span>`
      : `<span style="color:var(--green)">◉ LIVE FEED</span>`;

    renderNetWorth(account, _chaseData, _marcusData);
    renderBankCards(_chaseData, _marcusData);
    renderBankingCharts(_chaseData, _marcusData);
    renderPortfolio(_allPositions, _allTxs, account);
    renderAnalysis(_allPositions);

    document.getElementById('last-updated').textContent = 'SYNC: ' + new Date().toLocaleTimeString();
  } catch(err) {
    console.error(err);
    document.getElementById('last-updated').textContent = 'FAULT: ' + err.message;
  } finally {
    setLoading(false);
  }
}

// ═══════════════════════════════
// NET WORTH
// ═══════════════════════════════
function renderNetWorth(account, chase, marcus){
  const brokerage  = parseFloat(account.NetLiquidation||0);
  const chasebal   = parseFloat(chase.account.balance||0);
  const marcusbal  = parseFloat(marcus.account.balance||0);
  const totalNet   = brokerage + chasebal + marcusbal;
  const unrealized = parseFloat(account.UnrealizedPnL||0);
  const realized   = parseFloat(account.RealizedPnL||0);
  document.getElementById('networth-bar').innerHTML = `
    <div class="nw-item"><div class="nw-label">TOTAL NET WORTH</div><div class="nw-value a1">${fmt(totalNet)}</div></div>
    <div class="nw-divider"></div>
    <div class="nw-item"><div class="nw-label">BROKERAGE</div><div class="nw-value a2">${fmt(brokerage)}</div></div>
    <div class="nw-item"><div class="nw-label">CHASE CHECKING</div><div class="nw-value">${fmt(chasebal)}</div></div>
    <div class="nw-item"><div class="nw-label">MARCUS SAVINGS</div><div class="nw-value">${fmt(marcusbal)}</div></div>
    <div class="nw-divider"></div>
    <div class="nw-item"><div class="nw-label">UNREALIZED P&amp;L</div><div class="nw-value ${pnlClass(unrealized)}">${fmt(unrealized)}</div></div>
    <div class="nw-item"><div class="nw-label">REALIZED P&amp;L</div><div class="nw-value ${pnlClass(realized)}">${fmt(realized)}</div></div>
    <div class="nw-divider"></div>
    <div class="nw-item"><div class="nw-label">AVG MONTHLY INCOME</div><div class="nw-value pos">${fmt(chase.monthly_income)}</div></div>
    <div class="nw-item"><div class="nw-label">AVG MONTHLY EXPENSES</div><div class="nw-value neg">${fmt(chase.monthly_expenses)}</div></div>`;
}

// ═══════════════════════════════
// BANK CARDS
// ═══════════════════════════════
function filterByTimeline(items){
  if (_timelineMonths >= 12) return items;
  // Use the latest date in the data as the reference point, not today —
  // otherwise historical CSVs get wiped out entirely by a today-relative cutoff.
  const allDates = items.map(t => t.date).filter(Boolean).sort();
  if (!allDates.length) return items;
  const latest = new Date(allDates[allDates.length - 1]);
  const cutoff = new Date(latest.getFullYear(), latest.getMonth() - _timelineMonths + 1, 1);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}`;
  return items.filter(t => t.date >= cutoffStr);
}

function renderBankCards(chase, marcus){
  function card(b, tag, tagClass){
    const a = b.account;
    const rate = parseFloat(a.interest_rate||0);
    const rateLabel = rate > 1 ? `APY ${rate}%` : `APR ${rate}%`;
    const inc = filterByTimeline(b.income);
    const exp = filterByTimeline(b.expenses);
    const totalInc = inc.reduce((s,t)=>s+t.amount,0);
    const totalExp = exp.reduce((s,t)=>s+t.amount,0);
    const netCF    = totalInc - totalExp;
    const months   = Math.min(_timelineMonths, 12);
    const maxV = Math.max(totalInc, totalExp, 1);
    const iPct = (totalInc/maxV*100).toFixed(1);
    const ePct = (totalExp/maxV*100).toFixed(1);
    const recent = [...inc,...exp].sort((x,y)=>y.date.localeCompare(x.date)).slice(0,6);
    return `<div class="card">
      <div class="bank-header">
        <div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div class="bank-name">${a.bank_name.toUpperCase()}</div>
            <span class="card-tag ${tagClass}">${tag.toUpperCase()}</span>
          </div>
          <div class="bank-meta">${a.account_type.toUpperCase()} · ${a.account_number}</div>
        </div>
        <div style="text-align:right">
          <div class="bank-bal">${fmt(a.balance)}</div>
          <div class="bank-rate">${rateLabel.toUpperCase()}</div>
        </div>
      </div>
      <div style="display:flex;gap:0.75rem;margin-bottom:0.9rem">
        <div class="stat-card" style="flex:1">
          <div class="stat-label">INCOME</div>
          <div class="stat-value pos" style="font-size:1rem">${fmt(totalInc)}</div>
          <div class="stat-sub">${months}MO · ~${fmt(totalInc/months)}/MO</div>
        </div>
        <div class="stat-card" style="flex:1;border-left-color:var(--red2)">
          <div class="stat-label">EXPENSES</div>
          <div class="stat-value neg" style="font-size:1rem">${fmt(totalExp)}</div>
          <div class="stat-sub">${months}MO · ~${fmt(totalExp/months)}/MO</div>
        </div>
        <div class="stat-card" style="flex:1;border-left-color:var(--amber)">
          <div class="stat-label">NET FLOW</div>
          <div class="stat-value ${pnlClass(netCF)}" style="font-size:1rem">${fmt(netCF)}</div>
          <div class="stat-sub">${months}-MONTH TOTAL</div>
        </div>
      </div>
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin-bottom:2px;letter-spacing:0.1em"><span>INCOME</span><span>${fmt(totalInc)}</span></div>
        <div class="cf-bar"><div class="cf-fill" style="width:${iPct}%;background:var(--green)"></div></div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin-bottom:2px;margin-top:0.4rem;letter-spacing:0.1em"><span>EXPENSES</span><span>${fmt(totalExp)}</span></div>
        <div class="cf-bar"><div class="cf-fill" style="width:${ePct}%;background:var(--red2)"></div></div>
      </div>
      <div class="card-title" style="margin-bottom:0.6rem">RECENT TRANSACTIONS</div>
      <div class="tx-list">${recent.map(t=>`
        <div class="tx-row">
          <div><div class="tx-desc">${t.description}</div><div class="tx-date">${t.date}</div></div>
          <div class="tx-amount ${t.direction==='credit'?'pos':'neg'}">${t.direction==='credit'?'+':'-'}${fmt(t.amount)}</div>
        </div>`).join('')}</div>
    </div>`;
  }
  document.getElementById('bank-grid').innerHTML =
    card(chase, 'Chase', 'chase') + card(marcus, 'Marcus', 'marcus');
}

// ═══════════════════════════════
// BANKING CHARTS
// ═══════════════════════════════
function getMonthlyData(bankData, months){
  // Anchor to the latest date present in the data, not today
  const allItems = [...bankData.income, ...bankData.expenses];
  const allDates = allItems.map(t => t.date).filter(Boolean).sort();
  const anchor = allDates.length ? new Date(allDates[allDates.length - 1]) : new Date();
  const result = [];
  for (let i = months-1; i >= 0; i--){
    const d = new Date(anchor.getFullYear(), anchor.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = MONTH_NAMES[d.getMonth()] + (months>6?` '${String(d.getFullYear()).slice(2)}`:'');
    const inc = bankData.income.filter(t=>t.date.startsWith(key)).reduce((s,t)=>s+t.amount,0);
    const exp = bankData.expenses.filter(t=>t.date.startsWith(key)).reduce((s,t)=>s+t.amount,0);
    result.push({ label, inc, exp });
  }
  return result;
}

function renderBankingCharts(chase, marcus){
  const months = _timelineMonths;
  const chaseMonthly = getMonthlyData(chase, months);
  makeChart('chart-cashflow-chase','bar',{
    labels: chaseMonthly.map(m=>m.label),
    datasets:[
      {label:'Income',  data:chaseMonthly.map(m=>m.inc), backgroundColor:'rgba(57,255,110,0.15)', borderColor:'#39ff6e', borderWidth:2},
      {label:'Expenses',data:chaseMonthly.map(m=>m.exp), backgroundColor:'rgba(224,32,32,0.15)',   borderColor:'#e02020', borderWidth:2}
    ]
  },{plugins:{legend:{position:'bottom'}}});

  const marcusMonthly = getMonthlyData(marcus, months);
  makeChart('chart-cashflow-marcus','bar',{
    labels: marcusMonthly.map(m=>m.label),
    datasets:[
      {label:'Income',  data:marcusMonthly.map(m=>m.inc), backgroundColor:'rgba(77,166,255,0.15)', borderColor:'#4da6ff', borderWidth:2},
      {label:'Expenses',data:marcusMonthly.map(m=>m.exp), backgroundColor:'rgba(224,32,32,0.15)',   borderColor:'#e02020', borderWidth:2}
    ]
  },{plugins:{legend:{position:'bottom'}}});

  const chaseFiltered = filterByTimeline(chase.expenses);
  const chaseCats = {};
  chaseFiltered.forEach(e=>{
    const cat = e.description.split(' - ')[0].split(' ')[0];
    chaseCats[cat] = (chaseCats[cat]||0) + e.amount;
  });
  const ck = Object.keys(chaseCats);
  makeChart('chart-expenses-chase','doughnut',{
    labels: ck,
    datasets:[{data:ck.map(k=>chaseCats[k].toFixed(2)), backgroundColor:COLORS, borderWidth:0}]
  },{plugins:{legend:{position:'right',labels:{font:{size:10}}}}});

  const marcusFiltered = filterByTimeline(marcus.expenses);
  const marcusCats = {};
  marcusFiltered.forEach(e=>{
    const cat = e.description.split(' - ')[0].split(' ')[0];
    marcusCats[cat] = (marcusCats[cat]||0) + e.amount;
  });
  const mk = Object.keys(marcusCats);
  makeChart('chart-expenses-marcus','doughnut',{
    labels: mk.length > 0 ? mk : ['Transfers to Brokerage','Emergency Fund'],
    datasets:[{data: mk.length > 0 ? mk.map(k=>marcusCats[k].toFixed(2)) : [9000,1500], backgroundColor:COLORS, borderWidth:0}]
  },{plugins:{legend:{position:'right',labels:{font:{size:10}}}}});
}

// ═══════════════════════════════
// PORTFOLIO — sort + filter
// ═══════════════════════════════
function sortPositions(col){
  if (_sortCol === col) _sortDir *= -1;
  else { _sortCol = col; _sortDir = -1; }
  document.querySelectorAll('#positions-table th').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.getAttribute('onclick')?.includes(col)){
      th.classList.add(_sortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
  renderPositionsTable();
}

function filterPositions(){ renderPositionsTable(); }

function renderPositionsTable(){
  const q = document.getElementById('pos-search')?.value.toLowerCase() || '';
  let rows = [..._allPositions];
  if (q) rows = rows.filter(p =>
    p.symbol.toLowerCase().includes(q) ||
    (p.company_name||'').toLowerCase().includes(q) ||
    (p.sector||'').toLowerCase().includes(q)
  );
  rows.sort((a,b) => {
    const av = typeof a[_sortCol]==='string' ? a[_sortCol] : (a[_sortCol]||0);
    const bv = typeof b[_sortCol]==='string' ? b[_sortCol] : (b[_sortCol]||0);
    return typeof av==='string' ? av.localeCompare(bv)*_sortDir : (av-bv)*_sortDir;
  });
  document.getElementById('positions-body').innerHTML = rows.map(p => {
    const pct52 = p.week_52_high > p.week_52_low
      ? ((p.market_price-p.week_52_low)/(p.week_52_high-p.week_52_low)*100).toFixed(0)
      : 50;
    return `<tr>
      <td>
        <div class="sym">${p.symbol}</div>
        <div class="co-name">${p.company_name||''}</div>
      </td>
      <td><span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--muted)">${p.asset_class}</span></td>
      <td style="font-family:var(--font-mono)">${p.position}</td>
      <td style="font-family:var(--font-mono)">${fmt(p.market_price)}</td>
      <td style="font-family:var(--font-mono)">${fmt(p.market_value)}</td>
      <td style="font-family:var(--font-mono)">${fmt(p.avg_cost)}</td>
      <td style="font-family:var(--font-mono)" class="${pnlClass(p.unrealized_pnl)}">${fmt(p.unrealized_pnl)}</td>
      <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--muted)">${p.sector||'—'}</td>
      <td style="font-family:var(--font-mono)">${p.dividend_yield>0?fmtPct(p.dividend_yield):'—'}</td>
      <td style="font-family:var(--font-mono)">${p.pe_ratio>0?p.pe_ratio.toFixed(1)+'x':'—'}</td>
      <td style="font-family:var(--font-mono)" class="${p.beta>1.2?'neg':p.beta<0.8&&p.beta>0?'pos':''}">${p.beta>0?p.beta.toFixed(2):'—'}</td>
      <td style="min-width:110px">
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--muted);display:flex;justify-content:space-between">
          <span>${fmt(p.week_52_low)}</span><span>${fmt(p.week_52_high)}</span>
        </div>
        <div class="range-bar"><div class="range-dot" style="left:${pct52}%"></div></div>
      </td>
    </tr>`;
  }).join('');
}

function filterTx(){
  const q = document.getElementById('tx-search')?.value.toLowerCase() || '';
  let rows = [..._allTxs];
  if (q) rows = rows.filter(t =>
    t.symbol.toLowerCase().includes(q) ||
    t.action.toLowerCase().includes(q)
  );
  document.getElementById('tx-body').innerHTML = rows.map(t => `<tr>
    <td style="font-family:var(--font-mono);font-size:0.75rem">${t.date}</td>
    <td class="sym">${t.symbol}</td>
    <td class="${t.action==='BUY'?'buy':'sell'}">${t.action}</td>
    <td style="font-family:var(--font-mono)">${t.quantity}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.price)}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.value)}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.commission)}</td>
    <td style="font-family:var(--font-mono)" class="${pnlClass(t.realized_pnl)}">${t.realized_pnl>0?fmt(t.realized_pnl):'—'}</td>
  </tr>`).join('');
}

// ═══════════════════════════════
// PORTFOLIO RENDER
// ═══════════════════════════════
function renderPortfolio(positions, txs, account){
  const totalValue  = positions.reduce((s,p)=>s+p.market_value,0);
  const totalUnreal = positions.reduce((s,p)=>s+p.unrealized_pnl,0);
  const totalReal   = positions.reduce((s,p)=>s+p.realized_pnl,0);
  const totalCost   = positions.reduce((s,p)=>s+(p.avg_cost*p.position),0);
  const totalReturn = totalCost>0?((totalValue-totalCost)/totalCost*100):0;
  document.getElementById('portfolio-stats').innerHTML = [
    {label:'PORTFOLIO VALUE', value:fmt(totalValue),      sub:`${positions.length} POSITIONS — LIVE`, cls:''},
    {label:'TOTAL RETURN',    value:fmtPct(totalReturn),  sub:`COST BASIS: ${fmt(totalCost)}`, cls:pnlClass(totalReturn)},
    {label:'UNREALIZED P&L',  value:fmt(totalUnreal),     sub:'OPEN POSITIONS', cls:pnlClass(totalUnreal)},
    {label:'REALIZED P&L',    value:fmt(totalReal),       sub:'CLOSED TRADES',  cls:pnlClass(totalReal)},
  ].map(s=>`<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value ${s.cls}">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`).join('');

  renderPositionsTable();

  document.getElementById('tx-body').innerHTML = txs.map(t => `<tr>
    <td style="font-family:var(--font-mono);font-size:0.75rem">${t.date}</td>
    <td class="sym">${t.symbol}</td>
    <td class="${t.action==='BUY'?'buy':'sell'}">${t.action}</td>
    <td style="font-family:var(--font-mono)">${t.quantity}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.price)}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.value)}</td>
    <td style="font-family:var(--font-mono)">${fmt(t.commission)}</td>
    <td style="font-family:var(--font-mono)" class="${pnlClass(t.realized_pnl)}">${t.realized_pnl>0?fmt(t.realized_pnl):'—'}</td>
  </tr>`).join('');
}

// ═══════════════════════════════
// ANALYSIS
// ═══════════════════════════════
function renderAnalysis(positions){
  const totalValue = positions.reduce((s,p)=>s+p.market_value,0);
  function groupBy(key){const m={};positions.forEach(p=>m[p[key]]=(m[p[key]]||0)+p.market_value);return m;}
  const sectorMap=groupBy('sector'), assetMap=groupBy('asset_class'), geoMap=groupBy('geography');

  function doughnut(id, map){
    const keys = Object.keys(map);
    makeChart(id,'doughnut',{
      labels: keys,
      datasets:[{data:keys.map(k=>map[k].toFixed(2)), backgroundColor:COLORS, borderWidth:0}]
    },{plugins:{legend:{position:'bottom',labels:{font:{size:10}}}}});
  }
  doughnut('chart-sector',sectorMap);
  doughnut('chart-asset',assetMap);
  doughnut('chart-geo',geoMap);

  const spy = positions.find(p=>p.symbol==='SPY');
  const qqq = positions.find(p=>p.symbol==='QQQ');
  const cost = positions.reduce((s,p)=>s+(p.avg_cost*p.position),0);
  const val  = positions.reduce((s,p)=>s+p.market_value,0);
  const portRet = ((val-cost)/cost*100).toFixed(2);
  const spyRet  = spy?(((spy.market_price-spy.avg_cost)/spy.avg_cost)*100).toFixed(2):'N/A';
  const qqqRet  = qqq?(((qqq.market_price-qqq.avg_cost)/qqq.avg_cost)*100).toFixed(2):'N/A';

  document.getElementById('benchmark-grid').innerHTML = [
    {label:'YOUR PORTFOLIO',   value:portRet+'%',                             cls:pnlClass(portRet)},
    {label:'SPY (S&P 500)',    value:spyRet+(spyRet!=='N/A'?'%':''),         cls:spyRet!=='N/A'?pnlClass(spyRet):''},
    {label:'QQQ (NASDAQ 100)', value:qqqRet+(qqqRet!=='N/A'?'%':''),         cls:qqqRet!=='N/A'?pnlClass(qqqRet):''},
    {label:'FED FUNDS RATE',   value:'5.25%', cls:''},
    {label:'MARCUS HYSA APY',  value:'5.10%', cls:''},
    {label:'10Y TREASURY',     value:'4.42%', cls:''},
  ].map(b=>`<div class="metric-pill"><div class="metric-pill-label">${b.label}</div><div class="metric-pill-value ${b.cls}">${b.value}</div></div>`).join('');

  const sectorKeys = Object.keys(sectorMap).sort((a,b)=>sectorMap[b]-sectorMap[a]);
  document.getElementById('sector-bars').innerHTML = sectorKeys.map((k,i)=>{
    const pct = (sectorMap[k]/totalValue*100).toFixed(1);
    return `<div class="progress-row">
      <div class="progress-label">${k}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${COLORS[i%COLORS.length]}"></div></div>
      <div class="progress-val">${pct}%</div>
    </div>`;
  }).join('');

  const equities = positions.filter(p=>p.pe_ratio>0);
  const avgPE    = equities.length ? equities.reduce((s,p)=>s+p.pe_ratio,0)/equities.length : 0;
  const betas    = positions.filter(p=>p.beta>0);
  const avgBeta  = betas.length ? betas.reduce((s,p)=>s+p.beta,0)/betas.length : 0;
  const divPos   = positions.filter(p=>p.dividend_yield>0);
  const wDiv     = divPos.length ? divPos.reduce((s,p)=>s+p.dividend_yield*p.market_value,0)/totalValue : 0;
  const annDiv   = positions.reduce((s,p)=>s+(p.market_value*p.dividend_yield/100),0);
  const sortedByVal  = [...positions].sort((a,b)=>b.market_value-a.market_value);
  const sortedByBeta = [...positions].filter(p=>p.beta>0).sort((a,b)=>b.beta-a.beta);

  document.getElementById('fundamentals-grid').innerHTML = [
    {label:'AVG PORTFOLIO P/E',    value:avgPE>0?avgPE.toFixed(1)+'x':'—',  sub:'S&P 500 AVG: ~24x'},
    {label:'PORTFOLIO BETA',       value:avgBeta>0?avgBeta.toFixed(2):'—',  sub:avgBeta>1?'ABOVE MARKET RISK':'BELOW MARKET RISK'},
    {label:'WEIGHTED DIV YIELD',   value:wDiv>0?fmtPct(wDiv*100):'—',       sub:`~${fmt(annDiv)}/YR ESTIMATED`},
    {label:'POSITIONS PAYING DIV', value:`${divPos.length} / ${positions.length}`, sub:'PAY DIVIDENDS'},
    {label:'LARGEST POSITION',     value:sortedByVal[0]?.symbol||'—',       sub:fmt(sortedByVal[0]?.market_value)},
    {label:'MOST VOLATILE (BETA)', value:sortedByBeta[0]?.symbol||'—',      sub:sortedByBeta[0]?'β '+sortedByBeta[0].beta.toFixed(2):'—'},
  ].map(s=>`<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value" style="font-size:1.05rem">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`).join('');

  document.getElementById('dividend-bars').innerHTML = divPos
    .sort((a,b)=>b.dividend_yield-a.dividend_yield)
    .map((p,i)=>`<div class="progress-row">
      <div class="progress-label" style="color:var(--blue2)">${p.symbol}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${(p.dividend_yield/4*100).toFixed(0)}%;background:${COLORS[i]}"></div></div>
      <div class="progress-val">${fmtPct(p.dividend_yield)}</div>
    </div>`).join('');

  const rates = [
    {label:'FED FUNDS RATE',    rate:5.25, note:'UPPER BOUND'},
    {label:'MARCUS HYSA APY',   rate:5.10, note:'YOUR SAVINGS RATE'},
    {label:'10Y TREASURY',      rate:4.42, note:'RISK-FREE BENCHMARK'},
    {label:'2Y TREASURY',       rate:4.88, note:'SHORT-TERM BENCHMARK'},
    {label:'TLT DIV YIELD',     rate:3.85, note:'YOUR BOND ETF'},
    {label:'PORTFOLIO AVG DIV', rate:+(wDiv*100).toFixed(2), note:'WEIGHTED YIELD'},
  ];
  document.getElementById('rate-context').innerHTML = rates.map((r,i)=>`
    <div class="progress-row">
      <div class="progress-label">${r.label}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${(r.rate/6*100).toFixed(0)}%;background:${COLORS[i]}"></div></div>
      <div class="progress-val">${r.rate.toFixed(2)}%</div>
    </div>
    <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--muted);margin:-0.3rem 0 0.5rem 145px;letter-spacing:0.08em">${r.note}</div>
  `).join('');
}

// ═══════════════════════════════
// INIT
// ═══════════════════════════════
setTimeline(12);
load();
setInterval(load, 300000);
