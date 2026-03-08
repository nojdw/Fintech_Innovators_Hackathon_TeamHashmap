import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from ib_client import get_portfolio, get_account_summary, get_transactions, get_bank_data
import time

app = FastAPI(title="Financial Dashboard")

# ── Simple in-memory cache ──
# yfinance is rate-limited and slow — cache for 5 minutes
_cache: dict = {}
CACHE_TTL = 300  # seconds

def cached(key: str, fn):
    now = time.time()
    if key in _cache:
        data, ts = _cache[key]
        if now - ts < CACHE_TTL:
            return data
    data = fn()
    _cache[key] = (data, now)
    return data


@app.get("/api/status")
def status():
    cached_keys = list(_cache.keys())
    ages = {}
    now = time.time()
    for k in cached_keys:
        _, ts = _cache[k]
        ages[k] = round(now - ts)
    return {
        "connected": True,
        "source":    "yfinance + csv",
        "readonly":  True,
        "cache_ttl": CACHE_TTL,
        "cached":    ages,
    }

@app.get("/api/portfolio")
def portfolio():
    try:
        return {"positions": cached("portfolio", get_portfolio)}
    except Exception as e:
        raise HTTPException(500, f"Error fetching portfolio: {e}")

@app.get("/api/account")
def account():
    try:
        # Account summary reuses the cached portfolio internally
        return cached("account", get_account_summary)
    except Exception as e:
        raise HTTPException(500, f"Error fetching account: {e}")

@app.get("/api/transactions")
def transactions():
    try:
        return {"transactions": get_transactions()}
    except Exception as e:
        raise HTTPException(500, f"Error reading transactions: {e}")

@app.get("/api/bank/chase")
def bank_chase():
    try:
        return get_bank_data("bank_chase.csv")
    except Exception as e:
        raise HTTPException(500, f"Error reading Chase data: {e}")

@app.get("/api/bank/marcus")
def bank_marcus():
    try:
        return get_bank_data("bank_marcus.csv")
    except Exception as e:
        raise HTTPException(500, f"Error reading Marcus data: {e}")

@app.get("/api/refresh")
def refresh():
    """Force-clear the cache so next request fetches fresh data from yfinance."""
    _cache.clear()
    return {"message": "Cache cleared — next request will fetch live data"}

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")
