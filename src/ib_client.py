import csv
import os

DATA_DIR = os.path.join(os.getcwd(), "data")

def get_portfolio() -> list[dict]:
    path = os.path.join(DATA_DIR, "portfolio.csv")
    positions = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            positions.append({
                "symbol":          row["symbol"],
                "sec_type":        row["sec_type"],
                "asset_class":     row["asset_class"],
                "currency":        row["currency"],
                "position":        float(row["position"]),
                "market_price":    float(row["market_price"]),
                "market_value":    float(row["market_value"]),
                "avg_cost":        float(row["avg_cost"]),
                "unrealized_pnl":  float(row["unrealized_pnl"]),
                "realized_pnl":    float(row["realized_pnl"]),
                "sector":          row["sector"],
                "geography":       row["geography"],
                "dividend_yield":  float(row["dividend_yield"]),
                "pe_ratio":        float(row["pe_ratio"]),
                "beta":            float(row["beta"]),
                "week_52_high":    float(row["week_52_high"]),
                "week_52_low":     float(row["week_52_low"]),
            })
    return positions

def get_account_summary() -> dict:
    path = os.path.join(DATA_DIR, "account.csv")
    summary = {}
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            summary[row["tag"]] = row["value"]
    return summary

def get_transactions() -> list[dict]:
    path = os.path.join(DATA_DIR, "transactions.csv")
    transactions = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            transactions.append({
                "date":          row["date"],
                "symbol":        row["symbol"],
                "action":        row["action"],
                "quantity":      float(row["quantity"]),
                "price":         float(row["price"]),
                "value":         float(row["value"]),
                "commission":    float(row["commission"]),
                "realized_pnl":  float(row["realized_pnl"]),
            })
    transactions.sort(key=lambda x: x["date"], reverse=True)
    return transactions

def get_bank_data(filename: str) -> dict:
    path = os.path.join(DATA_DIR, filename)
    account = {}
    income = []
    expenses = []

    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["type"] == "account":
                account[row["key"]] = row["value"]
            elif row["type"] == "income":
                income.append({
                    "description": row["key"],
                    "amount":      float(row["value"]),
                    "date":        row["type"] if len(row) > 3 else "",
                    "direction":   "credit"
                })
            elif row["type"] == "expense":
                expenses.append({
                    "description": row["key"],
                    "amount":      float(row["value"]),
                    "direction":   "debit"
                })

    # Re-read to get date field properly (4th column)
    income = []
    expenses = []
    with open(path, newline="") as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            if row[0] == "income":
                income.append({
                    "description": row[1],
                    "amount":      float(row[2]),
                    "date":        row[3] if len(row) > 3 else "",
                    "direction":   "credit"
                })
            elif row[0] == "expense":
                expenses.append({
                    "description": row[1],
                    "amount":      float(row[2]),
                    "date":        row[3] if len(row) > 3 else "",
                    "direction":   "debit"
                })

    total_income   = sum(t["amount"] for t in income)
    total_expenses = sum(t["amount"] for t in expenses)

    # Monthly averages (3 months of data)
    monthly_income   = round(total_income / 3, 2)
    monthly_expenses = round(total_expenses / 3, 2)

    return {
        "account":          account,
        "income":           sorted(income, key=lambda x: x["date"], reverse=True),
        "expenses":         sorted(expenses, key=lambda x: x["date"], reverse=True),
        "total_income":     round(total_income, 2),
        "total_expenses":   round(total_expenses, 2),
        "monthly_income":   monthly_income,
        "monthly_expenses": monthly_expenses,
        "net_cashflow":     round(total_income - total_expenses, 2),
    }
