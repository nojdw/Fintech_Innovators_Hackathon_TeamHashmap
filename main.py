from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import threading
from ib_insync import IB, util
from ib_client import get_portfolio, get_account_summary
from typing import Optional

ib: Optional[IB] = None 

def run_ib_in_thread(port=4001):
    """Run IB connection in its own thread with its own event loop"""
    global ib
    util.patchAsyncio()
    ib = IB()
    try:
        ib.connect('127.0.0.1', port, clientId=1, readonly=True)
        print("✅ Connected to IB Gateway")
        ib.run()  # keeps the loop alive in this thread
    except Exception as e:
        print(f"❌ Could not connect to IB Gateway: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch IB in background thread
    thread = threading.Thread(target=run_ib_in_thread, daemon=True)
    thread.start()
    import time; time.sleep(2)  # give it a moment to connect
    yield
    # Shutdown
    if ib and ib.isConnected():
        ib.disconnect()

app = FastAPI(title="IB Portfolio Viewer", lifespan=lifespan)

@app.get("/api/portfolio")
def portfolio():
    if not ib or not ib.isConnected():
        raise HTTPException(503, "Not connected to IB Gateway")
    return {"positions": get_portfolio(ib)}

@app.get("/api/account")
def account():
    if not ib or not ib.isConnected():
        raise HTTPException(503, "Not connected to IB Gateway")
    return get_account_summary(ib)

@app.get("/api/status")
def status():
    connected = bool(ib and ib.isConnected())
    return {"connected": connected, "readonly": True}

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")