# TerraAI — Security Features Guide
### A Plain-English Explainer for Beginner Coders

This document explains four security practices baked into the TerraAI platform.
It is written so that someone who is new to coding can understand *why* each
practice exists, not just *what* it does.

---

## 1. Input Sanitization — The "Don't Trust Anyone" Rule

**What is it?**

Every time a user types something into TerraAI — a floor area number, a street
address, or a bedroom count — the code checks that the value is actually what
it claims to be *before* doing anything with it.

**Why does it matter?**

If a user types `<script>alert('hacked')</script>` into an address field, or
`-999999` into a floor area box, the application should reject it immediately
rather than try to process it. Attackers routinely probe web forms with
malicious input hoping to find one that slips through unchecked. This is called
an **injection attack**, and it is consistently ranked in the OWASP Top 10 list
of the most dangerous web vulnerabilities.

**How TerraAI does it:**

In `run_valuation.py`, every input prompt goes through a dedicated validator
before it reaches the engine:

```python
# _int_prompt rejects anything that is not a positive whole number
def _int_prompt(label: str, hint: str = "") -> int:
    while True:
        raw = _prompt(label, hint)
        if raw.isdigit() and int(raw) > 0:   # ← only digits, must be > 0
            return int(raw)
        print("Please enter a whole number greater than 0.")
```

- **Addresses** — validated to be non-empty strings. No SQL commands or HTML tags
  can cause harm because the engine never passes raw address strings to a
  database query directly.
- **Numbers** — `_int_prompt` only returns `int` values it has positively confirmed
  are safe. `_optional_int_prompt` does the same but also allows a blank skip.
- **Menu selections** — `_menu` and `_multi_select` only accept numeric indices
  from a hard-coded allow-list; free-text exploits cannot reach the engine.

> **Rule of thumb**: never use raw user input directly in database queries,
> file paths, or shell commands. Always validate first, then pass the
> *cleaned* value forward.

---

## 2. Environment Variables — The "No Secrets in the Open" Rule

**What is it?**

API keys, database passwords, and other credentials are stored in a `.env`
file on the server — *not* written directly into the source code.

**Why does it matter?**

If you hard-code a secret like this:

```python
# ❌ NEVER do this
DATABASE_URL = "postgresql://admin:SuperSecret123@db.example.com/terraai"
LINZ_API_KEY = "sk-live-abc123XYZ"
```

…and then push that code to GitHub, every person who views the repository — or
any automated bot that crawls public repos — instantly has your credentials.
Real-world data breaches have been caused by exactly this mistake.

**How TerraAI does it:**

Credentials live in `backend/.env` (which is listed in `.gitignore` so it is
*never* committed to version control). The application reads them at runtime
using Python's `os.environ`:

```python
import os
DATABASE_URL = os.environ["DATABASE_URL"]   # ← read at runtime, never hardcoded
LINZ_API_KEY = os.environ.get("LINZ_API_KEY", "")
```

The companion file `backend/.env.example` contains only *placeholder* values
(e.g. `DATABASE_URL=your_connection_string_here`) so that new developers know
what variables are needed without exposing the real secrets.

> **Rule of thumb**: if a value would be dangerous in the wrong hands, it
> belongs in `.env`, not in your code.

---

## 3. Asynchronous Safety — The "Keep the Engine Running" Rule

**What is it?**

TerraAI uses Python's `asyncio` library so that multiple data-fetch operations
(LiDAR topography and solar exposure) happen *concurrently* — and so that a
slow or broken external service cannot freeze the entire application.

**Why does it matter?**

Imagine a web server that processes one request at a time in a straight line. If
the LiDAR API takes 3 seconds to respond, every user waiting behind that one
request also waits 3 seconds — even if their request has nothing to do with
LiDAR. Worse, if the API never responds at all, the server can lock up entirely.
This is the foundation of a **Denial of Service (DoS)** vulnerability, even
without a deliberate attack.

**How TerraAI does it:**

```python
# Both calls start simultaneously — we don't wait for one before starting the other
topo_grade, solar_hours = await asyncio.gather(
    get_lidar_data(address),
    get_solar_exposure(address),
)
```

`asyncio.gather()` fires both requests at the same time and waits for both to
finish. If either fails, the `try/except` block catches the error and falls back
to safe neutral values — the valuation continues with a lower confidence score
rather than crashing:

```python
try:
    topo_grade, solar_hours = await asyncio.gather(...)
except Exception:
    topo_grade  = "flat"          # neutral default
    solar_hours = city_average    # neutral default
    topo_ok = solar_ok = False    # confidence score penalised
```

This design means:

- A single slow API call does not block all other users.
- A completely dead API does not bring the platform down.
- The user always receives a result, clearly marked with reduced confidence.

> **Rule of thumb**: never block the main thread waiting for a network call.
> Use `async/await` and always handle the failure case.

---

## 4. Future-Proofing with Supabase — The "Scale Safely to $1M ARR" Rule

**What is it?**

As TerraAI grows from a terminal demo toward a fully hosted SaaS product,
user authentication and data storage will be handled by
[Supabase](https://supabase.com) — an open-source backend platform built on
top of PostgreSQL.

**Why does it matter?**

Rolling your own login system is one of the most dangerous things a startup
can do. Password hashing, session management, email verification, OAuth
(Google/Apple sign-in), and brute-force protection are all complex security
problems that have been solved — and regularly audited — by dedicated security
teams at platforms like Supabase. Re-inventing them from scratch introduces
risk that could expose user data and destroy trust overnight.

**How TerraAI will use it:**

| Concern | Supabase Feature | Why It Matters |
|---|---|---|
| User logins | Auth with JWT tokens | Passwords are never stored in plain text |
| Row-level access | Row Level Security (RLS) | Users can only read *their own* valuations |
| API security | Auto-generated REST + PostgREST | Every endpoint requires a valid auth token |
| Data privacy | Hosted in AU/NZ regions | GDPR / Privacy Act compliance by default |
| Secret rotation | Supabase dashboard | API keys can be rotated without code changes |

The current database schema in `backend/models/database.py` is already
PostGIS-compatible and will map cleanly onto Supabase's PostgreSQL instance.
The migration path is:

1. Stand up a Supabase project in the `ap-southeast-2` (Sydney) region.
2. Run the existing schema migrations via Supabase CLI.
3. Replace the raw `asyncpg` DSN with the Supabase connection string (stored
   in `.env` — see Rule 2 above).
4. Enable Row Level Security on the `valuations` table so each user can only
   access their own reports.

> **Rule of thumb**: use a battle-hardened auth platform for user data.
> Your competitive advantage is the valuation engine — not the login page.

---

*This document is part of the TerraAI internal developer guide.*
*See also: `LAWYER_SHIELD.md`, `backend/.env.example`.*
