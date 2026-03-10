import csv
import os
import yfinance as yf

DATA_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
)
PRIVATE_ASSETS_FILE = "private_assets.csv"
DIGITAL_WALLET_FILE = "digital_wallet.csv"

GEOGRAPHY_MAP = {
    "United States": "North America",
    "Canada":        "North America",
    "United Kingdom":"Europe",
    "Germany":       "Europe",
    "France":        "Europe",
    "Japan":         "Asia Pacific",
    "China":         "Asia Pacific",
    "Hong Kong":     "Asia Pacific",
    "Australia":     "Asia Pacific",
    "India":         "Asia Pacific",
}

ASSET_CLASS_MAP = {
    "SPY": "ETF",
    "QQQ": "ETF",
    "TLT": "Bond",
    "GLD": "Commodity",
}


def _to_float(raw: str, default: float = 0.0) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default

def _read_holdings() -> list[dict]:
    path = os.path.join(DATA_DIR, "portfolio.csv")
    holdings = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            holdings.append({
                "symbol":       row["symbol"],
                "position":     float(row["position"]),
                "avg_cost":     float(row["avg_cost"]),
                "realized_pnl": float(row["realized_pnl"]),
            })
    return holdings


def _read_private_assets() -> list[dict]:
    path = os.path.join(DATA_DIR, PRIVATE_ASSETS_FILE)
    if not os.path.exists(path):
        return []

    assets = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            position = _to_float(row.get("position"), 1.0)
            avg_cost = _to_float(row.get("avg_cost"))
            market_price = _to_float(row.get("market_price"), avg_cost)
            market_value = round(position * market_price, 2)
            unrealized = round(market_value - (position * avg_cost), 2)

            assets.append({
                "symbol": row.get("symbol", "PRIVATE").strip() or "PRIVATE",
                "company_name": row.get("asset_name", "Private Holding").strip() or "Private Holding",
                "sec_type": "PVT",
                "asset_class": row.get("asset_class", "Private Asset").strip() or "Private Asset",
                "currency": row.get("currency", "USD").strip() or "USD",
                "position": position,
                "market_price": round(market_price, 2),
                "market_value": market_value,
                "avg_cost": round(avg_cost, 2),
                "unrealized_pnl": unrealized,
                "realized_pnl": 0.0,
                "sector": row.get("sector", "Alternative").strip() or "Alternative",
                "geography": row.get("geography", "Global").strip() or "Global",
                "dividend_yield": round(_to_float(row.get("dividend_yield")), 2),
                "pe_ratio": 0.0,
                "beta": 0.0,
                "week_52_high": round(market_price, 2),
                "week_52_low": round(market_price, 2),
                "debt_to_equity": 0.0,
                "current_ratio": 0.0,
                "profit_margin": 0.0,
                "revenue_growth": 0.0,
                "short_ratio": 0.0,
                "pb_ratio": 0.0,
            })
    return assets


def _read_digital_assets() -> list[dict]:
    path = os.path.join(DATA_DIR, DIGITAL_WALLET_FILE)
    if not os.path.exists(path):
        return []

    assets = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            position = _to_float(row.get("position"))
            avg_cost = _to_float(row.get("avg_cost"))
            market_price = _to_float(row.get("market_price"), avg_cost)
            market_value = round(position * market_price, 2)
            unrealized = round(market_value - (position * avg_cost), 2)
            symbol = (row.get("symbol", "CRYPTO") or "CRYPTO").strip().upper()

            assets.append({
                "symbol": symbol,
                "company_name": row.get("asset_name", symbol).strip() or symbol,
                "sec_type": "CRYPTO",
                "asset_class": "Digital Asset",
                "currency": row.get("currency", "USD").strip() or "USD",
                "position": position,
                "market_price": round(market_price, 2),
                "market_value": market_value,
                "avg_cost": round(avg_cost, 2),
                "unrealized_pnl": unrealized,
                "realized_pnl": 0.0,
                "sector": row.get("chain", "Blockchain").strip() or "Blockchain",
                "geography": row.get("geography", "Global").strip() or "Global",
                "dividend_yield": 0.0,
                "pe_ratio": 0.0,
                "beta": 0.0,
                "week_52_high": round(market_price, 2),
                "week_52_low": round(market_price, 2),
                "debt_to_equity": 0.0,
                "current_ratio": 0.0,
                "profit_margin": 0.0,
                "revenue_growth": 0.0,
                "short_ratio": 0.0,
                "pb_ratio": 0.0,
            })
    return assets


def get_portfolio() -> list[dict]:
    holdings = _read_holdings()
    symbols  = [h["symbol"] for h in holdings]
    tickers  = yf.Tickers(" ".join(symbols))

    positions = []
    for holding in holdings:
        sym  = holding["symbol"]
        pos  = holding["position"]
        cost = holding["avg_cost"]
        real = holding["realized_pnl"]

        try:
            info = tickers.tickers[sym].info

            price          = (info.get("currentPrice")
                              or info.get("regularMarketPrice")
                              or info.get("previousClose")
                              or cost)
            market_value   = round(price * pos, 2)
            unrealized_pnl = round(market_value - (cost * pos), 2)

            sector    = info.get("sector") or info.get("category") or "Other"
            country   = info.get("country", "United States")
            geography = GEOGRAPHY_MAP.get(country, "Global")

            quote_type = info.get("quoteType", "EQUITY")
            if sym in ASSET_CLASS_MAP:
                asset_class = ASSET_CLASS_MAP[sym]
            elif quote_type == "ETF":
                asset_class = "ETF"
            else:
                asset_class = "Equity"

            div_yield    = round((info.get("dividendYield") or 0) * 100, 2)
            pe_ratio     = round(info.get("trailingPE") or 0, 1)
            beta         = round(info.get("beta") or 0, 2)
            week52_high  = info.get("fiftyTwoWeekHigh") or price
            week52_low   = info.get("fiftyTwoWeekLow")  or price
            company_name = info.get("longName") or info.get("shortName") or sym

            # ── Extra metrics for health score ──────────────────
            debt_to_equity   = round(info.get("debtToEquity")   or 0, 2)
            current_ratio    = round(info.get("currentRatio")   or 0, 2)
            profit_margin    = round((info.get("profitMargins") or 0) * 100, 2)
            revenue_growth   = round((info.get("revenueGrowth") or 0) * 100, 2)
            short_ratio      = round(info.get("shortRatio")     or 0, 2)
            # Price-to-Book — used for valuation quality
            pb_ratio         = round(info.get("priceToBook")    or 0, 2)

        except Exception as e:
            print(f"[yfinance] Warning: could not fetch {sym}: {e}")
            price          = cost
            market_value   = round(cost * pos, 2)
            unrealized_pnl = 0.0
            sector         = "Unknown"
            geography      = "Unknown"
            asset_class    = "Equity"
            div_yield      = 0.0
            pe_ratio       = 0.0
            beta           = 0.0
            week52_high    = cost
            week52_low     = cost
            company_name   = sym
            debt_to_equity = 0.0
            current_ratio  = 0.0
            profit_margin  = 0.0
            revenue_growth = 0.0
            short_ratio    = 0.0
            pb_ratio       = 0.0

        positions.append({
            "symbol":          sym,
            "company_name":    company_name,
            "sec_type":        "ETF" if asset_class in ("ETF", "Bond", "Commodity") else "STK",
            "asset_class":     asset_class,
            "currency":        "USD",
            "position":        pos,
            "market_price":    round(price, 2),
            "market_value":    market_value,
            "avg_cost":        cost,
            "unrealized_pnl":  unrealized_pnl,
            "realized_pnl":    real,
            "sector":          sector,
            "geography":       geography,
            "dividend_yield":  div_yield,
            "pe_ratio":        pe_ratio,
            "beta":            beta,
            "week_52_high":    round(week52_high, 2),
            "week_52_low":     round(week52_low,  2),
            # Health score extras
            "debt_to_equity":  debt_to_equity,
            "current_ratio":   current_ratio,
            "profit_margin":   profit_margin,
            "revenue_growth":  revenue_growth,
            "short_ratio":     short_ratio,
            "pb_ratio":        pb_ratio,
        })

    try:
        positions.extend(_read_private_assets())
    except Exception as e:
        print(f"[private-assets] Warning: could not read {PRIVATE_ASSETS_FILE}: {e}")

    try:
        positions.extend(_read_digital_assets())
    except Exception as e:
        print(f"[digital-wallet] Warning: could not read {DIGITAL_WALLET_FILE}: {e}")

    return positions


def get_account_summary() -> dict:
    positions = get_portfolio()
    net_liq    = sum(p["market_value"]   for p in positions)
    unrealized = sum(p["unrealized_pnl"] for p in positions)
    realized   = sum(p["realized_pnl"]   for p in positions)

    cash = 38456.25
    try:
        path = os.path.join(DATA_DIR, "account.csv")
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                if row["tag"] == "TotalCashValue":
                    cash = float(row["value"])
    except Exception:
        pass

    return {
        "NetLiquidation":     round(net_liq + cash, 2),
        "TotalCashValue":     round(cash, 2),
        "GrossPositionValue": round(net_liq, 2),
        "UnrealizedPnL":      round(unrealized, 2),
        "RealizedPnL":        round(realized, 2),
    }


def get_transactions() -> list[dict]:
    path = os.path.join(DATA_DIR, "transactions.csv")
    transactions = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            transactions.append({
                "date":         row["date"],
                "symbol":       row["symbol"],
                "action":       row["action"],
                "quantity":     float(row["quantity"]),
                "price":        float(row["price"]),
                "value":        float(row["value"]),
                "commission":   float(row["commission"]),
                "realized_pnl": float(row["realized_pnl"]),
            })
    transactions.sort(key=lambda x: x["date"], reverse=True)
    return transactions


def _normalise_date(raw: str) -> str:
    """
    Convert any common date format to YYYY-MM-DD so JS date logic works.
    Handles: M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD, D-M-YYYY, etc.
    Returns the original string unchanged if parsing fails.
    """
    from datetime import datetime
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m-%d-%Y",
                "%Y/%m/%d", "%d %b %Y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw.strip()


def get_bank_data(filename: str) -> dict:
    path = os.path.join(DATA_DIR, filename)
    account  = {}
    income   = []
    expenses = []

    with open(path, newline="") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if row[0] == "account":
                account[row[1]] = row[2]
            elif row[0] == "income":
                income.append({
                    "description": row[1],
                    "amount":      float(row[2]),
                    "date":        _normalise_date(row[3]) if len(row) > 3 else "",
                    "direction":   "credit",
                })
            elif row[0] == "expense":
                expenses.append({
                    "description": row[1],
                    "amount":      float(row[2]),
                    "date":        _normalise_date(row[3]) if len(row) > 3 else "",
                    "direction":   "debit",
                })

    total_income   = sum(t["amount"] for t in income)
    total_expenses = sum(t["amount"] for t in expenses)
    months = 12  # CSVs now carry 12 months

    return {
        "account":          account,
        "income":           sorted(income,   key=lambda x: x["date"], reverse=True),
        "expenses":         sorted(expenses, key=lambda x: x["date"], reverse=True),
        "total_income":     round(total_income, 2),
        "total_expenses":   round(total_expenses, 2),
        "monthly_income":   round(total_income   / months, 2),
        "monthly_expenses": round(total_expenses / months, 2),
        "net_cashflow":     round(total_income - total_expenses, 2),
    }
