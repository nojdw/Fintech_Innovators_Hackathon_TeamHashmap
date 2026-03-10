import sys
import os
import json
import time
import hashlib
import hmac
import httpx
from collections import deque
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from ib_client import get_portfolio, get_account_summary, get_transactions, get_bank_data

app = FastAPI(title="Mango Fi")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "dev-secret-change-me"),
    same_site="lax",
    https_only=False,
)

# ═══════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════
AUTH_USER      = os.getenv("AUTH_USER", "admin")
AUTH_PASS_HASH = os.getenv("AUTH_PASS_HASH", "")

def verify_password(password: str) -> bool:
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(digest, AUTH_PASS_HASH)

def require_user(request: Request) -> str:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

class LoginBody(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    if body.username != AUTH_USER or not verify_password(body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    request.session["user"] = body.username
    return {"ok": True, "user": body.username}

@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}

@app.get("/api/auth/me")
def me(user: str = Depends(require_user)):
    return {"user": user}

# ═══════════════════════════════════════════════════════════════
# RETIREMENT PROFILE
# ═══════════════════════════════════════════════════════════════
PROFILES_DIR = os.path.join(os.getcwd(), "data", "profiles")

def _profile_path(username: str) -> str:
    os.makedirs(PROFILES_DIR, exist_ok=True)
    safe = "".join(c for c in username if c.isalnum() or c in "-_")
    return os.path.join(PROFILES_DIR, f"{safe}.json")

class RetirementProfile(BaseModel):
    current_age: int
    retirement_age: int
    monthly_expenses_retirement: float
    cpf_oa_balance: float
    cpf_sa_balance: float
    expected_growth_rate: float
    expected_inflation_rate: float
    include_cpf: bool
    monthly_voluntary_contribution: float
    goal_type: str
    target_annual_dividend: Optional[float] = None

@app.get("/api/profile/retirement")
def get_retirement_profile(user: str = Depends(require_user)):
    path = _profile_path(user)
    if not os.path.exists(path):
        return {
            "current_age": 30, "retirement_age": 62,
            "monthly_expenses_retirement": 4000.0,
            "cpf_oa_balance": 50000.0, "cpf_sa_balance": 30000.0,
            "expected_growth_rate": 7.0, "expected_inflation_rate": 2.5,
            "include_cpf": True, "monthly_voluntary_contribution": 500.0,
            "goal_type": "retirement_age", "target_annual_dividend": None,
        }
    with open(path) as f:
        return json.load(f)

@app.post("/api/profile/retirement")
def save_retirement_profile(profile: RetirementProfile, user: str = Depends(require_user)):
    path = _profile_path(user)
    with open(path, "w") as f:
        json.dump(profile.dict(), f, indent=2)
    return {"ok": True}

# ═══════════════════════════════════════════════════════════════
# GEMINI AI INSIGHTS
# ─────────────────────────────────────────────────────────────
#  • Rate limit: sliding 60-second window, default GEMINI_RPM=3
#  • Change limit: set env var GEMINI_RPM=<n> before starting server
#  • Model: gemini-2.0-flash — structured JSON output, max 500 tokens
#  • Prompt sends only pre-computed scalars (no raw positions)
#  • Three insight types in one call: narrative, observations, rebalance signals
# ═══════════════════════════════════════════════════════════════
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_RPM     = int(os.getenv("GEMINI_RPM", "3"))  # ← default 3 req/min
GEMINI_MODEL   = "gemini-3.1-flash-lite-preview"

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    f"/{GEMINI_MODEL}:generateContent"
)

# Sliding window — stores UNIX timestamps of recent Gemini requests
_gemini_request_times: deque = deque()

def _check_rate_limit() -> tuple[bool, float]:
    """
    Returns (allowed, retry_after_seconds).
    Pops stale entries older than 60s, then checks against GEMINI_RPM.
    """
    now    = time.time()
    window = 60.0
    while _gemini_request_times and now - _gemini_request_times[0] > window:
        _gemini_request_times.popleft()
    if len(_gemini_request_times) >= GEMINI_RPM:
        retry_after = window - (now - _gemini_request_times[0])
        return False, round(retry_after, 1)
    _gemini_request_times.append(now)
    return True, 0.0

class InsightRequest(BaseModel):
    # All pre-computed by JS — Gemini never sees raw positions
    portfolio_value: float
    sector_breakdown: dict          # {"Technology": 0.68, ...}  (fractions 0–1)
    asset_breakdown: dict           # {"Equity": 0.80, ...}
    geo_breakdown: dict             # {"North America": 0.85, ...}
    avg_beta: float
    weighted_div_yield: float       # percent, e.g. 1.8
    avg_pe: float
    health_score: int
    years_to_retirement: int
    on_track: bool
    projected_corpus: float
    corpus_needed: float
    goal_type: str                  # "retirement_age" | "dividend_income"
    current_age: int
    retirement_age: int
    expected_growth_rate: float
    inflation_rate: float
    target_annual_dividend: Optional[float] = None
    projected_div_at_retirement: Optional[float] = None

def _build_prompt(d: InsightRequest) -> str:
    def pct_list(mapping: dict) -> str:
        return ", ".join(
            f"{k} {v * 100:.1f}%"
            for k, v in sorted(mapping.items(), key=lambda x: -x[1])
        )

    track_str = (
        "on track"
        if d.on_track
        else f"SHORT by ${d.corpus_needed - d.projected_corpus:,.0f}"
    )
    div_line = ""
    if d.goal_type == "dividend_income" and d.target_annual_dividend:
        div_line = (
            f"\nDividend goal: ${d.target_annual_dividend:,.0f}/yr target, "
            f"${d.projected_div_at_retirement or 0:,.0f}/yr projected."
        )

    return f"""You are a portfolio composition analyst. Respond ONLY with a valid JSON object — no markdown, no extra text.

Portfolio snapshot (Singapore investor, USD portfolio):
- Value: ${d.portfolio_value:,.0f} | Health score: {d.health_score}/100
- Sector: {pct_list(d.sector_breakdown)}
- Asset class: {pct_list(d.asset_breakdown)}
- Geography: {pct_list(d.geo_breakdown)}
- Beta: {d.avg_beta:.2f} | Div yield: {d.weighted_div_yield:.2f}% | Avg P/E: {d.avg_pe:.1f}x
- Age: {d.current_age}, retiring at {d.retirement_age} ({d.years_to_retirement} yrs away)
- Growth assumption: {d.expected_growth_rate:.1f}% p.a. | Inflation: {d.inflation_rate:.1f}%
- Corpus status: {track_str}{div_line}

Return exactly this JSON shape:
{{
  "narrative": "<2-3 sentences: plain-English retirement outlook summary>",
  "assumption_flag": "<1 sentence: assess whether {d.expected_growth_rate:.1f}% growth is consistent with this portfolio's risk profile, or null if reasonable>",
  "observations": [
    "<observation on a specific composition pattern or concentration risk — no tickers>",
    "<observation 2>",
    "<observation 3>"
  ],
  "rebalance_signals": [
    "<category-level suggestion e.g. 'Adding international developed-market exposure could reduce geographic concentration' — no tickers, no dollar amounts>",
    "<signal 2>"
  ],
  "dividend_feasibility": "<1 sentence on dividend goal feasibility, or null if goal_type is not dividend_income>"
}}

Hard rules: no ticker symbols, no specific securities, no dollar amounts in rebalance_signals, no personalised financial advice. Max 3 observations, max 2 rebalance signals. Be specific to the numbers provided."""

@app.post("/api/ai/insights")
async def ai_insights(body: InsightRequest, user: str = Depends(require_user)):
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI insights unavailable — set GEMINI_API_KEY environment variable",
        )

    allowed, retry_after = _check_rate_limit()
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit: {GEMINI_RPM} req/min. Retry in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )

    prompt = _build_prompt(body)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GEMINI_API_URL,
                params={"key": GEMINI_API_KEY},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "maxOutputTokens": 500,
                        "temperature": 0.3,  # low temp → consistent structured output
                    },
                },
            )

        if resp.status_code != 200:
            raise HTTPException(
                502,
                detail=f"Gemini API error {resp.status_code}: {resp.text[:300]}",
            )

        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

        # Strip accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]

        parsed = json.loads(raw.strip())

        required_keys = {
            "narrative", "assumption_flag", "observations",
            "rebalance_signals", "dividend_feasibility",
        }
        missing = required_keys - parsed.keys()
        if missing:
            raise ValueError(f"Model response missing fields: {missing}")

        return {
            "ok": True,
            "model": GEMINI_MODEL,
            "rpm_limit": GEMINI_RPM,
            "rpm_used": len(_gemini_request_times),
            "data": parsed,
        }

    except json.JSONDecodeError as e:
        raise HTTPException(502, detail=f"Model returned non-JSON: {e}")
    except ValueError as e:
        raise HTTPException(502, detail=str(e))
    except httpx.TimeoutException:
        raise HTTPException(504, detail="Gemini API request timed out (20s)")
    except Exception as e:
        raise HTTPException(500, detail=f"Unexpected error calling Gemini: {e}")


@app.get("/api/ai/status")
def ai_status(user: str = Depends(require_user)):
    """Polled by frontend to display the rate-limit meter."""
    now = time.time()
    while _gemini_request_times and now - _gemini_request_times[0] > 60.0:
        _gemini_request_times.popleft()
    return {
        "configured": bool(GEMINI_API_KEY),
        "rpm_limit":  GEMINI_RPM,
        "rpm_used":   len(_gemini_request_times),
        "rpm_available": max(0, GEMINI_RPM - len(_gemini_request_times)),
        "model":      GEMINI_MODEL,
    }

# ═══════════════════════════════════════════════════════════════
# DATA CACHE
# ═══════════════════════════════════════════════════════════════
_cache: dict = {}
CACHE_TTL    = 300

def cached(key: str, fn):
    now = time.time()
    if key in _cache:
        data, ts = _cache[key]
        if now - ts < CACHE_TTL:
            return data
    data = fn()
    _cache[key] = (data, now)
    return data

# ═══════════════════════════════════════════════════════════════
# DATA ENDPOINTS
# ═══════════════════════════════════════════════════════════════
@app.get("/api/status")
def status():
    now  = time.time()
    ages = {k: round(now - _cache[k][1]) for k in _cache}
    return {"connected": True, "source": "yfinance + csv",
            "readonly": True, "cache_ttl": CACHE_TTL, "cached": ages}

@app.get("/api/portfolio")
def portfolio():
    try:
        return {"positions": cached("portfolio", get_portfolio)}
    except Exception as e:
        raise HTTPException(500, f"Error fetching portfolio: {e}")

@app.get("/api/account")
def account():
    try:
        return cached("account", get_account_summary)
    except Exception as e:
        raise HTTPException(500, f"Error fetching account: {e}")

@app.get("/api/transactions")
def transactions():
    try:
        return {"transactions": get_transactions()}
    except Exception as e:
        raise HTTPException(500, f"Error reading transactions: {e}")

@app.get("/api/bank/DBS")
def bank_DBS():
    try:
        return get_bank_data("bank_DBS.csv")
    except Exception as e:
        raise HTTPException(500, f"Error reading DBS data: {e}")

@app.get("/api/bank/SC")
def bank_SC():
    try:
        return get_bank_data("bank_SC.csv")
    except Exception as e:
        raise HTTPException(500, f"Error reading SC data: {e}")

@app.get("/api/refresh")
def refresh():
    _cache.clear()
    return {"message": "Cache cleared"}

# ═══════════════════════════════════════════════════════════════
# STATIC + ROOT
# ═══════════════════════════════════════════════════════════════
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")
