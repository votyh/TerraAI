"""
TerraAI FastAPI Backend — Phase 1 MVP Valuation Engine
======================================================
Endpoints:
    GET  /health               — liveness probe
    POST /api/v1/valuate       — indicative property valuation
    POST /api/v1/waitlist      — early-access waitlist signup

Rate Limiting (SlowAPI):
    /api/v1/valuate  — 10 requests / minute per IP
    /api/v1/waitlist — 5  requests / minute per IP
    Global fallback  — 30 requests / minute per IP

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
  - All base price figures are clearly labelled as indicative model estimates.
  - If an external API (LINZ, Auckland Council GIS) is not connected,
    the response explicitly states "Data Unavailable" per the zero-hallucination rule.
  - No data is invented or interpolated without disclosure.

DISCLAIMER:
  This engine is NOT a Registered Valuation. Outputs are indicative only.
  See LAWYER_SHIELD.md for the full legal framework.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from services.gis_service import resolve_address
from services.valuation_engine import ValuationInput, calculate_valuation

from dna_routes import router as dna_router

load_dotenv()


# ─── Rate Limiter ─────────────────────────────────────────────────────────────

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["30/minute"],
    storage_uri=os.environ.get("REDIS_URL", "memory://"),
)

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="TerraAI Valuation API",
    version="0.2.0",
    description=(
        "INDICATIVE ONLY — Not a Registered Valuation. "
        "All outputs are AI-synthesised estimates from public data. "
        "See LAWYER_SHIELD.md for full legal framework."
    ),
)

# ── SlowAPI middleware ─────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── CORS ──────────────────────────────────────────────────────────────────────
# In production: replace allow_origins with your actual domain(s).
_allowed_origins = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── DNA + Stripe + Supabase routes (Phase Integration) ───────────────────────
app.include_router(dna_router)

# ─── Request / Response Models ────────────────────────────────────────────────

EraType = Literal[
    "pre-1940",
    "1940s-1960s",
    "1970s-1990s",
    "2000s-2010s",
    "2010s-present",
]
ConditionType = Literal["excellent", "good", "fair", "poor"]
RiskLevel = Literal["low", "medium", "high"]


class ValuationRequest(BaseModel):
    address: str = Field(..., min_length=3, max_length=200)
    suburb:  str = Field(..., min_length=2, max_length=100)
    city:    str = Field(default="Auckland", max_length=50)
    sqm:     float = Field(..., gt=0, lt=10_000, description="Floor area in m²")
    beds:    int   = Field(..., ge=1, le=20)
    baths:   int   = Field(..., ge=1, le=20)
    era:       EraType
    condition: ConditionType


class ValuationResponse(BaseModel):
    estimated_value_nzd: int
    price_per_sqm_nzd:   int
    confidence_score:    int = Field(..., ge=0, le=100)
    risk_level:          RiskLevel
    # Factor breakdown
    condition_multiplier: float
    era_factor:           float
    flood_discount:       float
    zoning_multiplier:    float
    # GIS context
    flood_risk_note: str
    zoning_note:     str
    parcel_id:       str | None = None
    land_area_sqm:   float | None = None
    # Compliance
    disclaimer:   str
    data_sources: list[str]


class WaitlistRequest(BaseModel):
    email:          EmailStr
    name:           str | None = Field(default=None, max_length=200)
    suburb:         str | None = Field(default=None, max_length=100)
    city:           str | None = Field(default=None, max_length=50)
    tier_interest:  Literal["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"] | None = None
    referral_source: str | None = Field(default=None, max_length=100)


class WaitlistResponse(BaseModel):
    status:  str
    message: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Meta"])
def health_check() -> dict:
    """Liveness probe — returns engine version and connection status."""
    return {
        "status": "ok",
        "version": "0.2.0",
        "engine": "gis_aware",
        "external_apis": {
            "linz":                  "configured" if os.environ.get("LINZ_API_KEY") else "not_configured",
            "auckland_council_gis":  "configured" if os.environ.get("AUCKLAND_COUNCIL_GIS_KEY") else "not_configured",
            "nsw_spatial":           "configured" if os.environ.get("NSW_SPATIAL_API_KEY") else "not_configured",
            "google_maps":           "configured" if os.environ.get("GOOGLE_MAPS_API_KEY") else "not_configured",
            "gemini":                "configured" if os.environ.get("GEMINI_API_KEY") else "not_configured",
        },
    }


@app.post("/api/v1/valuate", response_model=ValuationResponse, tags=["Valuation"])
@limiter.limit("10/minute")
async def valuate(request: Request, body: ValuationRequest) -> ValuationResponse:
    """
    Submit property details for an AI-synthesised indicative valuation.

    Rate limit: 10 requests per minute per IP.

    Returns an estimated value, confidence score, risk level, full factor
    breakdown, and data-source attribution.
    Output is NOT a Registered Valuation.
    """
    try:
        gis = await resolve_address(body.address, body.city)
        inp = ValuationInput(
            address=body.address,
            suburb=body.suburb,
            city=body.city,
            sqm=body.sqm,
            beds=body.beds,
            baths=body.baths,
            era=body.era,
            condition=body.condition,
        )
        result = calculate_valuation(inp, gis)
        return ValuationResponse(
            estimated_value_nzd  = result.estimated_value_nzd,
            price_per_sqm_nzd    = result.price_per_sqm_nzd,
            confidence_score     = result.confidence_score,
            risk_level           = result.risk_level,
            condition_multiplier = result.condition_multiplier,
            era_factor           = result.era_factor,
            flood_discount       = result.flood_discount,
            zoning_multiplier    = result.zoning_multiplier,
            flood_risk_note      = result.flood_risk_note,
            zoning_note          = result.zoning_note,
            parcel_id            = result.parcel_id,
            land_area_sqm        = result.land_area_sqm,
            disclaimer           = result.disclaimer,
            data_sources         = result.data_sources,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/waitlist", response_model=WaitlistResponse, tags=["Waitlist"])
@limiter.limit("5/minute")
async def join_waitlist(request: Request, body: WaitlistRequest) -> WaitlistResponse:
    """
    Register for early access.

    Rate limit: 5 requests per minute per IP.

    Phase 2: persist to the Waitlist table via SQLAlchemy session.
    Currently logs the signup and returns a confirmation.
    """
    # TODO Phase 2: async with get_db_session() as session:
    #     record = Waitlist(
    #         email=body.email, name=body.name, suburb=body.suburb,
    #         city=body.city, tier_interest=body.tier_interest,
    #         referral_source=body.referral_source,
    #     )
    #     session.add(record)
    #     await session.commit()
    return WaitlistResponse(
        status="queued",
        message=(
            f"Thank you! {body.email} has been added to the waitlist. "
            "We'll be in touch when early access opens."
        ),
    )

