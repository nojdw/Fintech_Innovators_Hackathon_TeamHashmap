import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from ib_client import get_portfolio, get_account_summary, get_transactions, get_bank_data

app = FastAPI(title="Financial Dashboard")

@app.get("/api/status")
def status():
    return {"connected": True, "source": "csv", "readonly": True}

@app.get("/api/account")
def account():
    try:
        return get_account_summary()
    except Exception as e:
        raise HTTPException(500, f"Error reading account data: {e}")

@app.get("/api/portfolio")
def portfolio():
    try:
        return {"positions": get_portfolio()}
    except Exception as e:
        raise HTTPException(500, f"Error reading portfolio data: {e}")

@app.get("/api/transactions")
def transactions():
    try:
        return {"transactions": get_transactions()}
    except Exception as e:
        raise HTTPException(500, f"Error reading transaction data: {e}")

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

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")
