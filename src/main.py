import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from ib_client import get_portfolio, get_account_summary, get_transactions, get_bank_data
import time
import hashlib
import hmac

app = FastAPI(title="Financial Dashboard")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "dev-secret-change-me"),
    same_site="lax",
    https_only=False, #for local dev only
)

#Password Storage and Verification
AUTH_USER = os.getenv("AUTH_USER", "admin")
AUTH_PASS_HASH = os.getenv("AUTH_PASS_HASH", "")
def verify_password(password: str) -> bool:
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(digest, AUTH_PASS_HASH)
#Generate hash
#Store hash in AUTH_PASS_HASH env var
#When user logs in, hash input and compare
#we use hmac.compare_digest() compares in constant time, whereas regular "==" is vulnerable to timing attacks

#Dependency Injection for Auth
def require_user(request: Request) -> str:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@app.get("/api/portfolio")
def portfolio(user: str = Depends(require_user)): #Depends is fastAPIs dependency injection system
    # If execution reaches here, user is logged in
    return {"positions": cached("portfolio", get_portfolio)}

#FLOW:
#user visits /api/portfolio
#fastAPI sees depends(require_user)
#Calls require_user(request)
#checks if request.session["user"] exists
#yes -> returns username, calls portfolio(user='admin')
#no -> raises httpexception, request fails, browser gets 401 error

#LOGIN ENDPOINT
class LoginBody(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    if body.username != AUTH_USER or not verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    request.session["user"] = body.username
    return {"ok": True, "user": body.username}
#FLOW:
#brower POSTs {"username": "admin", "password": "secret"} to /api/auth/login
#FastAPI validates json matches LoginBody schema -> ensures username and password fields exist
#Check if username matches AUTH_USER and password hash matches
#If success -> write request.session["user"] = "admin"
#else raise 401

#LOGOUT ENDPOINT
@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}
#FLOW:
#user clicks logout
#frontend calls /api/auth/logout
#request.session.clear() deletes all session data
#Middleware sends cookie with empty/expired value
#browser deletes cookies

#CHECK AUTH STATUS
@app.get("/api/auth/me")
def me(user: str = Depends(require_user)):
    return {"user": user}
#let frontend check if user is logged in
#if session expired or invalid return 401
#if valid, return username

#PROTECT ROOT ROUTE
@app.get("/")
def root(request: Request):
    if not request.session.get("user"):
        return RedirectResponse(url="/static/login.html", status_code=302)
    return FileResponse("static/index.html")




#PROTECT DASHBOARD STARTUP


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
