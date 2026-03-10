# Mango Fi - Wealth Wellness Hub

Mango Fi is a full-stack financial wellness dashboard that consolidates portfolio, banking, private holdings, and digital assets into one interface, then evaluates portfolio health, retirement readiness, and AI-assisted composition insights.

The project is designed as a hackathon proof-of-concept for a "Wealth Wellness Hub" use case.

The project can be accessed here: https://fintech-innovators-hackathon-teamhashmap.onrender.com/
Demo video: https://www.youtube.com/watch?v=sYcBwVtKlWY

## What The App Does

Mango Fi provides:

- Unified wealth view across:
- Brokerage positions (CSV + live market enrichment from Yahoo Finance)
- Banking cashflow (DBS and Standard Chartered CSV feeds)
- Private assets (CSV)
- Digital wallet assets (CSV)
- Portfolio analytics including:
- Allocation breakdowns (sector, asset class, geography)
- Health score with weighted risk/diversification/income/valuation/quality/liquidity metrics
- Concentration warnings
- Benchmark/rate context
- Retirement planning with Singapore-specific assumptions:
- CPF OA/SA growth
- CPF withdrawal at age 55 over FRS
- CPF LIFE payout approximation from age 65
- Inflation-adjusted retirement expenses and corpus analysis
- AI composition analysis:
- Gemini-generated narrative/observations/rebalance signals based on pre-computed metrics
- Sliding-window request throttling and status meter
- Health trend history:
- Snapshot persistence over time and line-chart rendering in Analysis tab

## Tech Stack

- Backend: FastAPI
- Frontend: HTML/CSS/Vanilla JavaScript
- Data Enrichment: yfinance
- AI: Gemini REST API via `httpx`
- Session/Auth: Starlette `SessionMiddleware` + SHA-256 password hash comparison
- Charts: Chart.js

## High-Level Architecture

```text
Browser (index.html + app.js + styles.css)
    -> REST API (FastAPI in src/main.py)
        -> Data adapter (src/ib_client.py)
            -> Local CSV files in /data
            -> Yahoo Finance enrichment for listed symbols
        -> Local profile/history JSON in /data/profiles
        -> Gemini API (optional, if key configured)
```

## Data Sources

- `data/portfolio.csv`: base listed holdings
- `data/account.csv`: account summary tags
- `data/transactions.csv`: transaction log
- `data/bank_DBS.csv`: DBS account + income/expense feed
- `data/bank_SC.csv`: SC account + income/expense feed
- `data/private_assets.csv`: private holdings (optional)
- `data/digital_wallet.csv`: crypto/digital assets (optional)
- `data/profiles/<user>.json`: retirement profile persistence
- `data/profiles/<user>_health_history.json`: health snapshots over time

## Core Algorithms And Methods

## 1) Portfolio Enrichment And Normalization

Implemented in `src/ib_client.py`.

- Reads listed holdings from CSV.
- Enriches each symbol via Yahoo Finance (`currentPrice`, `trailingPE`, `beta`, `dividendYield`, etc.).
- Applies fallback chain for price:
- `currentPrice -> regularMarketPrice -> previousClose -> avg_cost`
- Maps geography and broad asset classes.
- Normalizes all assets to a single position schema used by the frontend.
- Merges additional sources:
- Private assets (`sec_type = PVT`)
- Digital wallet assets (`sec_type = CRYPTO`)

## 2) Backend Read Cache (TTL)

Implemented in `src/main.py` (`cached`).

- In-memory key-value cache for expensive data fetches.
- TTL = 300 seconds.
- Used by `/api/portfolio` and `/api/account`.
- Cleared manually by `/api/refresh`.

## 3) Gemini Sliding-Window Rate Limiter

Implemented in `src/main.py` (`_check_rate_limit`).

- Maintains a deque of request timestamps.
- On each request:
- Removes timestamps older than 60 seconds.
- If count is already at limit (`GEMINI_RPM`), rejects with HTTP 429 and retry-after value.
- Default limit is 3 requests/minute.

## 4) Financial Health Score

Implemented in `static/js/app.js` (`computeHealthScore`).

The score is weighted from 6 sub-scores:

- Diversification: 25%
- Risk: 20%
- Income: 15%
- Valuation: 15%
- Quality: 15%
- Liquidity: 10%

Key formulas:

```text
Risk score       ~ max(0, min(100, 100 - weighted_beta * 40))
Diversification  ~ based on average HHI across sector/geo/asset buckets
Income score     ~ weighted_dividend_yield compared to 2x risk-free proxy
Valuation score  ~ score curve from average P/E
Quality score    ~ weighted profit margin score
Liquidity score  ~ cash percentage of total net worth
Final score      = weighted sum of sub-scores
```

## 5) Concentration Warning Heuristic

Implemented in `static/js/app.js`.

- Computes bucket concentration by sector/geography/asset class.
- Warn threshold: > 50%
- Alert threshold: > 70%

## 6) Retirement Projection Model

Implemented in `static/js/app.js` (`computeRetirement`).

Uses:

- Compound growth projection of investable assets
- Annual net savings from bank cashflow + voluntary contribution
- Inflation-adjusted retirement expenses
- CPF growth assumptions:
- OA: 2.5% p.a.
- SA: 4.0% p.a.
- CPF withdrawal at 55 above Full Retirement Sum
- CPF LIFE payout approximation from 65
- SWR corpus target (4% rule)
- Corpus longevity estimate using annuity-style depletion logic

Key formulas:

```text
real_rate = (1 + growth_rate) / (1 + inflation_rate) - 1

FV_portfolio = PV * (1+r)^n + PMT * ((1+r)^n - 1) / r

swr_corpus_needed = net_annual_draw / 0.04
```

## 7) Health Trend Snapshot Persistence

Implemented in `src/main.py` + `static/js/app.js`.

- Frontend posts latest health score snapshots to backend.
- Backend stores snapshots with timestamp and label.
- Duplicate guard: if same score is posted within 120 seconds, write is skipped.
- History sorted by timestamp and capped to 500 entries.
- Frontend renders line chart from chronological snapshots.

## 8) Portfolio Subtab Classification

Implemented in `static/js/app.js`.

- `crypto`: `sec_type == CRYPTO` or asset class containing `digital`
- `equity`: `sec_type == STK` or asset class `equity/etf`
- `others`: everything else (bond, commodity, private, etc.)

## API Reference

Base URL (local): `http://localhost:8000`

Auth note:

- Most profile/AI endpoints require authenticated session cookie.
- Core market/bank data endpoints are currently public at backend level.

### Authentication

| Method | Path               | Auth Required | Description                                       |
| ------ | ------------------ | ------------- | ------------------------------------------------- |
| POST   | `/api/auth/login`  | No            | Login with username/password; sets session cookie |
| POST   | `/api/auth/logout` | No            | Clears session                                    |
| GET    | `/api/auth/me`     | Yes           | Returns current authenticated user                |

### Profile And History

| Method | Path                      | Auth Required | Description                                      |
| ------ | ------------------------- | ------------- | ------------------------------------------------ |
| GET    | `/api/profile/retirement` | Yes           | Get retirement profile defaults or saved profile |
| POST   | `/api/profile/retirement` | Yes           | Save retirement profile                          |
| GET    | `/api/health/history`     | Yes           | Get health score snapshot history (up to 500)    |
| POST   | `/api/health/history`     | Yes           | Append health snapshot (with duplicate guard)    |

### AI

| Method | Path               | Auth Required | Description                                           |
| ------ | ------------------ | ------------- | ----------------------------------------------------- |
| POST   | `/api/ai/insights` | Yes           | Run Gemini analysis on aggregate portfolio metrics    |
| GET    | `/api/ai/status`   | Yes           | Returns Gemini configured status and rate-limit usage |

### Data And System

| Method | Path                | Auth Required | Description                        |
| ------ | ------------------- | ------------- | ---------------------------------- |
| GET    | `/api/status`       | No            | Connection state, cache metadata   |
| GET    | `/api/portfolio`    | No            | Returns normalized positions array |
| GET    | `/api/account`      | No            | Account summary values             |
| GET    | `/api/transactions` | No            | Transaction log                    |
| GET    | `/api/bank/DBS`     | No            | DBS account/cashflow data          |
| GET    | `/api/bank/SC`      | No            | SC account/cashflow data           |
| GET    | `/api/refresh`      | No            | Clears server cache                |

### Static Content

| Method | Path        | Description            |
| ------ | ----------- | ---------------------- |
| GET    | `/`         | Serves main dashboard  |
| GET    | `/static/*` | Serves frontend assets |

## Setup And Run

## 1) Create/activate virtual environment

Windows PowerShell example:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

## 2) Install dependencies

```powershell
pip install fastapi uvicorn yfinance itsdangerous httpx pydantic starlette
```

Optional:

```powershell
pip install google-genai
```

## 3) Configure environment variables

```powershell
$env:SESSION_SECRET = "use-a-long-random-string-here-min-32-chars"
$env:AUTH_USER = "admin"
$env:AUTH_PASS_HASH = "<sha256-hash-of-password>"
$env:GEMINI_API_KEY = "<your-gemini-api-key>"
```

Generate hash:

```powershell
python -c "import hashlib; print(hashlib.sha256('yourpassword'.encode()).hexdigest())"
```

## 4) Start server

```powershell
uvicorn src.main:app --reload --port 8000
```

Open:

- `http://localhost:8000/`

## Frontend Functional Areas

- Banking tab:
- Timeline-adjusted bank cashflow and expenditure composition
- Portfolio tab:
- Summary cards, searchable/sortable positions, subtabs (equity/crypto/others), transaction table
- Analysis tab:
- Health score, health trend, diversification warnings, allocation charts, benchmark/rate context, AI analysis panel
- Retirement tab:
- Profile inputs, CPF-aware retirement projection, trajectory chart, dividend goal check

## Security Notes

Current implementation highlights:

- Session cookies are signed using `SessionMiddleware` secret key.
- Password verification uses SHA-256 hash comparison.
- AI endpoint sends only aggregated metrics (no raw transaction rows).

Important production hardening tasks:

- Set `https_only=True` in session middleware for HTTPS deployments.
- Add proper role-based authorization and endpoint-level protection for market/bank data endpoints.
- Add audit logging and secrets management.
- Rotate API keys if exposed.

## Known Limitations

- Data is mostly CSV-backed with selective live market enrichment.
- Some benchmark/rate values are static constants in frontend logic.
- Currency treatment is simplified and not a full FX engine.
- Health score model is heuristic, not regulated investment advice.

## Suggested Next Steps

- Move all secrets to `.env` + secure secret store for deployment.
- Add automated tests for scoring/projection formulas.
- Add historical storage to a database instead of local JSON files.
- Add connectors for real brokerage/bank APIs and wallet APIs.
- Add role model (client/advisor/admin) and audit trail.
