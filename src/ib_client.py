import csv
import os

DATA_DIR = os.path.join(os.getcwd(), "data")

def get_portfolio() -> list[dict]:
    """Read portfolio positions from CSV"""
    path = os.path.join(DATA_DIR, "portfolio.csv")
    positions = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            positions.append({
                "symbol":          row["symbol"],
                "sec_type":        row["sec_type"],
                "currency":        row["currency"],
                "position":        float(row["position"]),
                "market_price":    float(row["market_price"]),
                "market_value":    float(row["market_value"]),
                "avg_cost":        float(row["avg_cost"]),
                "unrealized_pnl":  float(row["unrealized_pnl"]),
                "realized_pnl":    float(row["realized_pnl"]),
            })
    return positions

def get_account_summary() -> dict:
    """Read account summary from CSV"""
    path = os.path.join(DATA_DIR, "account.csv")
    summary = {}
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            summary[row["tag"]] = row["value"]
    return summary

def get_transactions() -> list[dict]:
    """Read transaction history from CSV"""
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
    # Most recent first
    transactions.sort(key=lambda x: x["date"], reverse=True)
    return transactions