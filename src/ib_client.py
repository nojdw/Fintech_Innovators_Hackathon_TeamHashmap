import csv
import os
import yfinance as yf

DATA_DIR = os.path.join(os.getcwd(), "data")

# Geography mapping — yfinance returns country, we map to region
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

# Asset class overrides for ETFs yfinance misclassifies
ASSET_CLASS_MAP = {
    "SPY": "ETF",
    "QQQ": "ETF",
    "TLT": "Bond",
    "GLD": "Commodity",
}

def _read_holdings() -> list[dict]:
    """Read positions and avg cost from CSV — the only thing yfinance can't know."""
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


def get_portfolio() -> list[dict]:
    """
    Merge CSV holdings with live yfinance market data.
    Falls back gracefully to CSV avg_cost if yfinance is unavailable.
    """
    holdings = _read_holdings()
    symbols  = [h["symbol"] for h in holdings]

    # Batch fetch all tickers at once — much faster than one by one
    tickers = yf.Tickers(" ".join(symbols))

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

        except Exception as e:
            print(f"[yfinance] Warning: could not fetch {sym}: {e}")
            price        = cost
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

        positions.append({
            "symbol":         sym,
            "company_name":   company_name,
            "sec_type":       "ETF" if asset_class in ("ETF", "Bond", "Commodity") else "STK",
            "asset_class":    asset_class,
            "currency":       "USD",
            "position":       pos,
            "market_price":   round(price, 2),
            "market_value":   market_value,
            "avg_cost":       cost,
            "unrealized_pnl": unrealized_pnl,
            "realized_pnl":   real,
            "sector":         sector,
            "geography":      geography,
            "dividend_yield": div_yield,
            "pe_ratio":       pe_ratio,
            "beta":           beta,
            "week_52_high":   round(week52_high, 2),
            "week_52_low":    round(week52_low,  2),
        })

    return positions


def get_account_summary() -> dict:
    """
    Derive account summary live from portfolio positions.
    Cash balance still read from account.csv if present.
    """
    positions = get_portfolio()

    net_liq    = sum(p["market_value"]   for p in positions)
    unrealized = sum(p["unrealized_pnl"] for p in positions)
    realized   = sum(p["realized_pnl"]   for p in positions)

    # Try to read cash from account.csv, fall back to default
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
    """Transaction history stays in CSV — yfinance has no personal trade data."""
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


def get_bank_data(filename: str) -> dict:
    """Bank data stays in CSV — no public API equivalent."""
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
                    "date":        row[3] if len(row) > 3 else "",
                    "direction":   "credit",
                })
            elif row[0] == "expense":
                expenses.append({
                    "description": row[1],
                    "amount":      float(row[2]),
                    "date":        row[3] if len(row) > 3 else "",
                    "direction":   "debit",
                })

    total_income   = sum(t["amount"] for t in income)
    total_expenses = sum(t["amount"] for t in expenses)

    return {
        "account":          account,
        "income":           sorted(income,   key=lambda x: x["date"], reverse=True),
        "expenses":         sorted(expenses, key=lambda x: x["date"], reverse=True),
        "total_income":     round(total_income, 2),
        "total_expenses":   round(total_expenses, 2),
        "monthly_income":   round(total_income   / 3, 2),
        "monthly_expenses": round(total_expenses / 3, 2),
        "net_cashflow":     round(total_income - total_expenses, 2),
    }
