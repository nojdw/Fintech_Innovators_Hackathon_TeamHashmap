To run, enter:
uvicorn src.main:app --reload --port 8000
into the console, then open:
http://localhost:8000/
in browser

To generate password hash: 
python -c "import hashlib; print(hashlib.sha256('yourpassword'.encode()).hexdigest())"

Set env var :
$env:SESSION_SECRET = "use-a-long-random-string-here-min-32-chars"
$env:AUTH_USER = "admin"
$env:AUTH_PASS_HASH = "paste hash generated above"
$env:GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"

Start server with these env vars:
uvicorn src.main:app --reload --port 8000

What the session secret is for:

- creates cryptographic signature of session data
- Encrypt session data so user cannot read
- On each request, will check if signature is valid, if someone edited the cookie, signature breaks and session rejected
- if session secret changes, old cookies become invalid
