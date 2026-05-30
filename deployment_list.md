# TerraAI — Deployment & Integration List
> Full checklist to take the DNA scanner from its current local-dev state to a fully working, production-grade product.  
> Items are grouped by layer and marked with their current status.

---

## Status Key
- ✅ Done — working in code today
- 🟡 Partial — scaffolded but not production-ready
- ❌ Missing — not implemented yet
- 🔑 Requires a third-party credential / account

---

## 1. Local Development — Run Both Ends

### Frontend
```
cd TerraAI-Frontend/terraai-value-insight
npm run dev          # starts on :8080 (or :8081 if taken)
```

### Backend
```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

> **Note:** Running `vite` from the root `E:\TerraAI\` will fail — it must be run from the `TerraAI-Frontend/terraai-value-insight/` subdirectory.

---

## 2. Environment Variables

### Frontend — `TerraAI-Frontend/terraai-value-insight/.env.local`

| Variable | Current Value | Status | Action needed |
|---|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | ✅ Dev OK | Set to production URL before deploy |
| `VITE_SUPABASE_URL` | `https://xdfhxynofjminpdjkxpu.supabase.co` | ❌ Project deleted | Create a new Supabase project and paste new URL |
| `VITE_SUPABASE_ANON_KEY` | stale token | ❌ Invalid | Paste new anon key from Supabase dashboard |

### Backend — `backend/.env` (create this file — it is gitignored)

| Variable | Purpose | Status |
|---|---|---|
| `SUPABASE_URL` | Supabase REST calls (paywall check, paid_properties) | 🔑 Needs new project |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-to-server Supabase writes (mark paid, credit debit) | 🔑 Needs new project |
| `SUPABASE_JWT_SECRET` | Verify Supabase Bearer tokens on `/calculate` | 🔑 Found in Supabase → Settings → API → JWT Secret |
| `STRIPE_SECRET_KEY` | Create Checkout sessions | 🔑 Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhook signatures | 🔑 `stripe listen --forward-to localhost:8000/api/v1/stripe-webhook` |
| `STRIPE_SUCCESS_URL` | Redirect after payment (include `{PID}` placeholder) | ❌ Not set — defaults to localhost |
| `STRIPE_CANCEL_URL` | Redirect on cancel | ❌ Not set — defaults to localhost |
| `DATABASE_URL` | PostgreSQL connection string (async: `postgresql+asyncpg://...`) | 🔑 Supabase DB or self-hosted Postgres |
| `LINZ_API_KEY` | Live LINZ WFS parcel lookups (Phase 2) | 🔑 https://data.linz.govt.nz/my/api-keys/ |
| `AUCKLAND_COUNCIL_GIS_KEY` | Live AUP / constraint overlays (Phase 2) | 🔑 Auckland Council GeoServer (currently open WFS) |
| `REDIS_URL` | Rate-limit store for multi-worker deployments | Optional — defaults to in-memory |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins | ❌ Must be set to production frontend URL before deploy |

---

## 3. Supabase Setup — New Project Required

The project `xdfhxynofjminpdjkxpu.supabase.co` does not resolve in DNS (deleted or never created).

### 3a. Create a new Supabase project
1. Go to https://supabase.com/dashboard → New project
2. Copy: **Project URL**, **anon/public key**, **service_role key**, **JWT secret**
3. Paste into `frontend/.env.local` and `backend/.env`

### 3b. Create the `paid_properties` table
The paywall depends on this table. Run in the Supabase SQL editor:
```sql
create table if not exists paid_properties (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  property_id text not null,
  created_at  timestamptz default now(),
  unique(user_id, property_id)
);

-- RLS: users can only read their own rows
alter table paid_properties enable row level security;

create policy "users see own paid rows"
  on paid_properties for select
  using (auth.uid() = user_id);

-- Only service_role can insert (via Stripe webhook)
```

### 3c. Enable Auth providers
- Email/password: Supabase → Authentication → Providers → Email ✓
- Google OAuth: Supabase → Authentication → Providers → Google → add Client ID + Secret from Google Cloud Console
- Set the Site URL and Redirect URLs to match your production domain

---

## 4. Stripe Setup

### 4a. Create products
- Product: `TerraAI Property DNA Report`
- Price: NZD $49.00 (one-time)

### 4b. Webhook endpoint
Register `https://your-domain.com/api/v1/stripe-webhook` in the Stripe Dashboard.  
Event to listen for: `checkout.session.completed`

### 4c. Local development webhook
```
stripe listen --forward-to localhost:8000/api/v1/stripe-webhook
```
Paste the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

### 4d. Update redirect URLs
In `backend/.env`:
```
STRIPE_SUCCESS_URL=https://your-domain.com/app?checkout=success&property_id={PID}
STRIPE_CANCEL_URL=https://your-domain.com/app?checkout=cancel
```

---

## 5. Database — PostgreSQL + Alembic Migrations

The ORM schema (`backend/models/database.py`) defines 9 tables. They are **not** automatically created.

```bash
cd backend
# 1. Install alembic (already in requirements.txt)
# 2. Initialise Alembic (only once per project)
alembic init alembic

# 3. Point alembic to your DATABASE_URL
# Edit alembic/env.py — replace `target_metadata = None` with:
#   from models.database import Base
#   target_metadata = Base.metadata

# 4. Generate and apply migrations
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

> **PostGIS required**: The schema uses `geoalchemy2` geometry columns. Your Postgres instance must have the PostGIS extension:  
> ```sql
> create extension if not exists postgis;
> ```  
> Supabase Pro and Render Postgres both support this. Render free tier does not.

---

## 6. DNA Engine — What Is Real vs Mock

| Component | Status | Notes |
|---|---|---|
| `async_engine.calculate_dna_value()` | ✅ Real logic | Reads `data_v1.json` + `rules.py`; applies era, cladding, flood, asset multipliers |
| `get_lidar_data(address)` | 🟡 Mock | Returns deterministic random topography grade; **Phase 2: replace with LINZ LiDAR API or AWS Terrain Tiles** |
| `get_solar_exposure(address)` | 🟡 Mock | Returns deterministic random sun hours; **Phase 2: replace with Google Solar API or NIWA SolarView** |
| `gis_service.resolve_address()` | ❌ Not wired into `/calculate` | Returns `GISBundle` but `dna_routes.py` does not call it; **Phase 2: call it and forward parcel data to engine** |
| `linz-connector.ts` | ✅ Implemented (TypeScript) | `fetchParcelByCoordinate()` hits live LINZ WFS Layer 50772 — requires `LINZ_API_KEY` |
| `infrastructure-ghost.ts` | ✅ Implemented (TypeScript) | Pure geometry analysis — no external API needed |
| `valuation-engine.ts` | ✅ Implemented (TypeScript) | RLV formula fully implemented |
| `account-guard.ts` | ✅ Implemented (TypeScript) | Credit enforcement wrapper — requires `SUPABASE_SERVICE_ROLE_KEY` |

### To make LiDAR + solar real (Phase 2)
Replace the two mock functions in `backend/app/engine/async_engine.py`:

```python
# get_lidar_data — replace with:
async def get_lidar_data(address: str) -> TopoGrade:
    lat, lng = await geocode(address)          # Google Maps Geocoding API
    slope = await fetch_slope_from_aws_terrain(lat, lng)  # AWS Terrain Tiles
    if slope < 5:   return "flat"
    if slope < 15:  return "moderate"
    return "steep"

# get_solar_exposure — replace with:
async def get_solar_exposure(address: str) -> float:
    lat, lng = await geocode(address)
    return await google_solar_api_peak_hours(lat, lng)  # Google Solar API
```

---

## 7. Backend `_detect_city` — Suburb Bypass ✅ DONE IN CODE

`_resolve_city()` and `_SUBURB_TO_CITY` (50+ NZ suburbs) are now live in `backend/dna_routes.py`.

**How it works:**
- User enters suburb "Ponsonby" → `_resolve_city` maps it to `"auckland"` → correct city premium applied
- Falls back to `_detect_city(address)` if suburb is not in the map
- Already-recognised city names pass through unchanged

**Nothing to do** — this is wired and working. The `_SUBURB_TO_CITY` dict covers Auckland, Wellington, and Christchurch suburbs. To extend coverage, add entries to the dict in `dna_routes.py`.

---

## 8. CORS ✅ DONE IN CODE

`backend/main.py` default origins now include `localhost:3000`, `127.0.0.1:3000`, `localhost:5173`, `127.0.0.1:5173`, `localhost:8080`, `127.0.0.1:8080`, `localhost:8081`, `127.0.0.1:8081`.

**Nothing to do for local dev** — all common Vite ports are already in the hardcoded default.

**For production** — you must still set this in `backend/.env`:
```
CORS_ALLOWED_ORIGINS=https://your-production-domain.com
```
Without this env var set in production, the backend will fall back to the localhost-only default and the deployed frontend will be blocked.

---

## 9. Frontend `.env.local` — Vite Port Mismatch

`STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` in `backend/.env` default to port `5173`.  
The Vite dev server is actually on `8080`/`8081`.

Update in `backend/.env`:
```
STRIPE_SUCCESS_URL=http://localhost:8081/app?checkout=success&property_id={PID}
STRIPE_CANCEL_URL=http://localhost:8081/app?checkout=cancel
```

---

## 10. The Paywall Flow — End-to-End Check

```
User submits form
   → InputEngine.onSubmit(PropertyData)
   → ValuationFlow calls POST /api/v1/calculate  (anonymous)
   → Backend returns { base_value, is_paid: false, dna_breakdown: null }
   → TeaserGate renders base value + 2 teaser movers + locked preview

User clicks Unlock $49
   → If not signed in: redirected to /sign-in?address=...
   → After sign-in: POST /api/v1/create-checkout-session  ← requires STRIPE_SECRET_KEY + valid JWT
   → Stripe Checkout opens
   → User pays
   → Stripe sends checkout.session.completed to /api/v1/stripe-webhook
   → Webhook writes to paid_properties table  ← requires SUPABASE_SERVICE_ROLE_KEY
   → Stripe redirects to STRIPE_SUCCESS_URL
   → ValuationFlow detects ?checkout=success, re-fetches /calculate with Bearer token
   → Backend: identity.user_id present + is_property_paid = true → returns dna_breakdown
   → ObsidianDashboard renders full DNA report
```

**All steps currently blocked by missing Supabase project.** Once a new Supabase project is created and secrets are wired, the full flow is code-complete.

---

## 11. Recent Changes — Verify They Show Correctly

Run the dev server (`npm run dev` from `TerraAI-Frontend/terraai-value-insight/`) and check:

### Role & Auth (previous session)
| Change | Where to verify |
|---|---|
| Sign-up step 1 is now **Role Selection** (Homeowner / Agent / Developer) | `/sign-in` → Sign Up tab → first screen |
| Roles have icons (🏠🏢🏗️), descriptions, and a green check on selection | Same screen |
| Steps progress bar shows **4 segments** instead of 3 | Same screen |
| `TeaserGate` hero label changes by role | Submit form → teaser screen |
| `ObsidianDashboard` report header changes by role | Requires paid unlock |
| Location premium mover `12 · LOC` appears in full DNA board for qualifying suburbs | Requires paid unlock |

### New 5-Step InputEngine (this session) ✅ Code done — verify UI
| Change | Where to verify |
|---|---|
| Form is now **5 steps** (Location / Rooms / Construction / Orientation / Features) | `/app` — count the progress dots |
| Step 0 has **Property Type cards** (House / Townhouse / Apartment / Unit / Section) | `/app` → step 0 |
| Step 0 has **Title Type chips** with leasehold / cross-lease warning banners | Select Leasehold — orange banner should appear |
| Step 0 validates: address + property type + title type required before Continue | Leave fields blank — Continue should be dimmed |
| Step 1 has **per-bedroom area** expansion (edit each bedroom's m²) | `/app` → step 1, adjust bedroom count |
| Step 1 has **per-bathroom type + area** (ensuite / family / powder + m²) | `/app` → step 1, adjust bathroom count |
| Step 1 has **carparks stepper** with Car icon and "~$18k" note | `/app` → step 1 |
| Step 2 shows **leaky building warning** when era = 1975–90 or 1990–05 is selected | Select TRN or LMD era |
| Step 2 has **condition cards** with % badges (Excellent +8% … Major Work −20%) | `/app` → step 2 |
| Step 2 has **insulation + heating multi-select** chips | `/app` → step 2 |
| Step 3 has the **interactive SVG compass** — drag to set direction | `/app` → step 3 — drag ring, degree readout updates |
| Compass N is emerald-coloured; South shows orange warning note | Drag to south — note changes |
| Step 3 has **views multi-select** with % badges (Sea +20%, Harbour +15%, etc.) | `/app` → step 3 |
| Step 3 has **school zone cards** with % badges | `/app` → step 3 |
| Step 4 has **photo drag-and-drop** — thumbnails appear on drop | `/app` → step 4, drag an image file |
| Step 4 has **33 asset chips** | `/app` → step 4 |
| Step 4 shows a **submission summary panel** before final submit | `/app` → step 4, scroll to bottom |
| **Live estimate bar** updates as you fill in condition, views, N-facing direction | Fill in step 2–3 and watch the bar animate |

### computeValuation.ts (this session) ✅ Done
| Change | Where to verify |
|---|---|
| Live estimate reacts to **condition** (excellent adds ~$38k, major work removes ~$75k) | Step 2 → select Excellent vs Major Work, watch bar |
| Live estimate reacts to **sea/harbour views** (Sea adds ~$95k) | Step 3 → select Sea view |
| Live estimate reacts to **school zone** (decile 8–10 adds ~$59k) | Step 3 → select school zone |
| Live estimate reacts to **N-facing** (adds ~$29k) | Step 3 → drag compass to North |
| Live estimate reacts to **leasehold** title (removes ~$85k) | Step 0 → select Leasehold |

---

## 12. New Form Fields — Backend API Wiring ❌ TODO

`InputEngine` now collects 15 new fields that are **not yet sent to the backend**.
`ValuationFlow.tsx` `toApiPayload` currently sends only:
`address, floorArea, landArea, bedrooms, bathrooms, era, cladding, floodRisk, assets, city`

### Fields to add to `toApiPayload` in `ValuationFlow.tsx`

```typescript
// In ValuationFlow.tsx, extend toApiPayload:
const toApiPayload = (d: PropertyData): CalculateRequest => ({
  // existing fields
  address:   d.address,
  floorArea: d.floorArea,
  landArea:  d.landArea,
  bedrooms:  d.bedrooms,
  bathrooms: d.bathrooms,
  era:       (d.era || "CTM") as CalculateRequest["era"],
  cladding:  (d.cladding || "WBD") as CalculateRequest["cladding"],
  floodRisk: (d.floodRisk as CalculateRequest["floodRisk"]) ?? "None",
  assets:    d.assets,
  city:      d.suburb || undefined,
  // NEW — add these:
  propertyType: d.propertyType || undefined,
  titleType:    d.titleType    || undefined,
  roofType:     d.roofType     || undefined,
  condition:    d.condition    || undefined,
  renovation:   d.renovation   || undefined,
  insulation:   d.insulation.length ? d.insulation : undefined,
  heating:      d.heating.length   ? d.heating    : undefined,
  carparks:     d.carparks,
  facing:       d.facing,
  slope:        d.slope        || undefined,
  views:        d.views.length  ? d.views      : undefined,
  schoolZone:   d.schoolZone   || undefined,
  noiseLevel:   d.noiseLevel   || undefined,
  access:       d.access       || undefined,
});
```

### Backend: extend `CalculateRequest` in `dna_routes.py`

The Pydantic model needs matching optional fields. Add after the existing fields:
```python
class CalculateRequest(BaseModel):
    # ... existing fields ...
    property_type: Optional[str] = None
    title_type:    Optional[str] = None
    roof_type:     Optional[str] = None
    condition:     Optional[str] = None
    renovation:    Optional[str] = None
    insulation:    Optional[list[str]] = None
    heating:       Optional[list[str]] = None
    carparks:      Optional[int] = None
    facing:        Optional[float] = None
    slope:         Optional[str] = None
    views:         Optional[list[str]] = None
    school_zone:   Optional[str] = None
    noise_level:   Optional[str] = None
    access:        Optional[str] = None
```

### Backend: use new fields in `async_engine.py`
Once the fields reach the engine, pass them into the DNA scoring functions. The `computeValuation.ts` local engine already implements all 22 factors — use it as the source of truth for the multiplier logic when porting to Python.

> **Impact of not doing this:** The DNA report will still work for MVP — the backend uses era, cladding, flood risk, and assets which are already sent. The new fields (condition, views, compass direction, etc.) will only affect the **local live estimate bar** until this wire-up is done. The paid DNA report will be less accurate than the preview.

---

## 13. Deployment — Production Checklist

### Option A: Vercel (Frontend) + Render (Backend)
1. Push repo to GitHub (already done — `votyh/TerraAI`)
2. Connect Vercel to `TerraAI-Frontend/terraai-value-insight` as the root directory
3. Add all `VITE_*` vars to Vercel → Settings → Environment Variables
4. Deploy FastAPI to Render as a Python web service:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Root directory: `backend/`
5. Add all backend env vars to Render → Environment
6. Register the Render URL as the Stripe webhook endpoint
7. Update `CORS_ALLOWED_ORIGINS` to the Vercel domain
8. Update `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` to the Vercel domain

### Option B: Railway (Full-stack)
- Deploy backend as Python service, frontend as Static site
- Works the same as Render but all in one dashboard

### Database (both options)
- Use Supabase hosted Postgres — it already has PostGIS enabled
- Connection string format: `postgresql+asyncpg://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

---

## 14. Phase 2 Integrations (Not Yet Needed for MVP)

| Integration | Purpose | API / Docs |
|---|---|---|
| **LINZ WFS Layer 50772** | Live parcel area + title from address | https://data.linz.govt.nz — `LINZ_API_KEY` required |
| **Auckland Council Open Data** | AUP zone, stormwater, overland flow overlays | https://data.aucklandcouncil.govt.nz (open WFS, no key needed) |
| **Google Solar API** | Real peak sun hours per address | https://developers.google.com/maps/documentation/solar |
| **Google Maps Geocoding** | Address → lat/lng for LiDAR + solar lookups | `GOOGLE_MAPS_API_KEY` |
| **NIWA SolarView** | NZ-specific solar radiation data (alternative to Google Solar) | https://niwa.co.nz/climate/solarview |
| **AWS Terrain Tiles** | Slope grade from DEM rasters | No key needed (public S3 bucket) |
| **Gemini 1.5 Pro** | LLM reasoning strings for DNA factors | `GEMINI_API_KEY` — line already in requirements.txt (commented) |

---

## Summary — Minimum to Make DNA Scanner Work End-to-End

### ✅ Already done — nothing to do
- CORS fixed (ports 8080/8081 in code default)
- Suburb→city resolution wired (`_resolve_city` + 50+ suburb map in `dna_routes.py`)
- `computeValuation.ts` local engine — 22 DNA factors, all new fields scored
- `InputEngine.tsx` — full 5-step form: compass, photo upload, per-room specs, condition, views, school zone, title type

### ❌ Still required to go live

1. **Create a new Supabase project** → paste URL + anon key + service role key + JWT secret into `frontend/.env.local` and `backend/.env` (Section 3)
2. **Run the `paid_properties` SQL** in Supabase SQL editor (Section 3b)
3. **Set Stripe keys** + register webhook endpoint (Section 4)
4. **Run Alembic migrations** against your Postgres instance (Section 5)
5. **Wire new form fields to the backend API** — extend `toApiPayload` in `ValuationFlow.tsx` + extend `CalculateRequest` in `dna_routes.py` (Section 12)
6. **Set `CORS_ALLOWED_ORIGINS`** to your production domain in `backend/.env` before deploying (Section 8)
7. **Set production `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL`** to your deployed frontend URL (Section 9)

### 🔑 Credentials needed before anything works
- Supabase Project URL + anon key + service role key + JWT secret
- Stripe publishable key + secret key + webhook signing secret
- PostgreSQL `DATABASE_URL` (use Supabase hosted Postgres)
4. **Create Stripe account** → add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
5. **Run database migrations** with Alembic (Section 5 above)
6. **Fix `_resolve_city`** in `dna_routes.py` so Auckland suburbs resolve correctly (Section 7 above)
7. Start both servers and walk through the full paywall flow

Everything else — LINZ live data, real solar/LiDAR, Google OAuth — is Phase 2.
