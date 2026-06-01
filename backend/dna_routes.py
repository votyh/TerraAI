"""
TerraAI DNA Calculation Routes — Phase Integration
==================================================
Wires the React Obsidian frontend to the async DNA engine and the Stripe
+ Supabase paywall.

Endpoints:
    POST /api/v1/calculate              — DNA valuation (paywall-gated)
    POST /api/v1/create-checkout-session — Stripe Checkout for $49 unlock
    POST /api/v1/stripe-webhook         — Marks property as paid

The detailed `dna_breakdown` and `reasoning_strings` are ONLY returned
when the caller is (a) authenticated via Supabase JWT and (b) has an
`is_paid` row in `paid_properties` for the requested `property_id`.

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
  Outputs are indicative model estimates, NOT a Registered Valuation.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

# ── Make the engine modules importable ───────────────────────────────────────
_ENGINE_DIR = Path(__file__).parent / "app" / "engine"
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

from async_engine import calculate_dna_value  # noqa: E402

from auth import (  # noqa: E402
    Identity,
    get_identity,
    hash_property_id,
    is_property_paid,
    mark_property_paid,
)
from services.gis_service import LINZClient  # noqa: E402

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["DNA"])


# ─── Frontend → Backend mapping tables ────────────────────────────────────────

EraCode      = Literal["VIC", "PWR", "MCM", "LMD", "TRN", "CTM", "NEW"]
CladdingCode = Literal["WBD", "BRK", "PLS", "FBC", "MTL", "STN"]
FloodLabel   = Literal["None", "Low", "Medium", "High"]

_ERA_MAP: dict[str, str] = {
    "VIC": "villa_heritage_1900_1920",
    "PWR": "post_war_solid_1950_1960",
    "MCM": "post_war_solid_1950_1960",
    "LMD": "leaky_era_1990_2004",
    "TRN": "leaky_era_1990_2004",
    "CTM": "modern_high_performance_2020_2026",
    "NEW": "modern_high_performance_2020_2026",
}

_CLADDING_MAP: dict[str, str] = {
    "WBD": "fibre_cement_weatherboard",
    "BRK": "brick_and_tile",
    "PLS": "monolithic_plaster",
    "FBC": "fibre_cement_weatherboard",
    "MTL": "fibre_cement_weatherboard",
    "STN": "brick_and_tile",
}

_FLOOD_MAP: dict[str, Optional[str]] = {
    "None":   None,
    "Low":    "overland_flow",
    "Medium": "overland_flow",
    "High":   "floodplain",
}

_ASSET_MAP: dict[str, str] = {
    "Swimming Pool":  "pool",
    "Solar Panels":   "solar_array",
    "Granny Flat":    "minor_dwelling",
}


# Suburb → canonical city mapping so the DNA engine can find the right
# base_cost_per_sqm entry even when the frontend sends a suburb name.
_SUBURB_TO_CITY: dict[str, str] = {
    # Auckland
    "ponsonby": "auckland", "herne bay": "auckland", "remuera": "auckland",
    "parnell": "auckland", "newmarket": "auckland", "westmere": "auckland",
    "freemans bay": "auckland", "grey lynn": "auckland", "kingsland": "auckland",
    "mt eden": "auckland", "mount eden": "auckland", "epsom": "auckland",
    "sandringham": "auckland", "grafton": "auckland", "meadowbank": "auckland",
    "mission bay": "auckland", "st heliers": "auckland", "kohimarama": "auckland",
    "devonport": "auckland", "takapuna": "auckland", "milford": "auckland",
    "bayswater": "auckland", "avondale": "auckland", "new lynn": "auckland",
    "henderson": "auckland", "waitakere": "auckland", "otahuhu": "auckland",
    "papatoetoe": "auckland", "manukau": "auckland", "flat bush": "auckland",
    "botany": "auckland", "pukekohe": "auckland", "pokeno": "auckland",
    "albany": "auckland", "orewa": "auckland", "whangaparaoa": "auckland",
    "howick": "auckland", "pakuranga": "auckland", "papakura": "auckland",
    # Wellington
    "thorndon": "wellington", "kelburn": "wellington", "brooklyn": "wellington",
    "mount victoria": "wellington", "mt victoria": "wellington", "te aro": "wellington",
    "newtown": "wellington", "karori": "wellington", "hataitai": "wellington",
    "island bay": "wellington", "aro valley": "wellington", "wadestown": "wellington",
    "petone": "wellington", "lower hutt": "wellington", "upper hutt": "wellington",
    "porirua": "wellington", "paraparaumu": "wellington",
    # Christchurch
    "fendalton": "christchurch", "merivale": "christchurch", "riccarton": "christchurch",
    "cashmere": "christchurch", "st albans": "christchurch", "linwood": "christchurch",
    "sydenham": "christchurch", "spreydon": "christchurch", "papanui": "christchurch",
}


def _resolve_city(suburb_or_city: Optional[str], address: str) -> str:
    """
    Resolve a suburb or city name to a canonical city key understood by
    the DNA engine (auckland, wellington, christchurch, sydney, ...).
    """
    _known_cities = {"auckland", "wellington", "christchurch",
                     "sydney", "melbourne", "brisbane"}
    if suburb_or_city:
        s = suburb_or_city.strip().lower()
        if s in _known_cities:
            return s
        if s in _SUBURB_TO_CITY:
            return _SUBURB_TO_CITY[s]
    return _detect_city(address)


def _detect_city(address: str) -> str:
    """Lightweight city heuristic until LINZ/GIS resolution is wired."""
    a = (address or "").lower()
    for city in ("auckland", "wellington", "christchurch",
                 "sydney", "melbourne", "brisbane"):
        if city in a:
            return city
    return "auckland"


# ─── Request / Response Models ────────────────────────────────────────────────

class CalculateRequest(BaseModel):
    """Payload from the React Obsidian intake form."""
    address:    str   = Field(..., min_length=3, max_length=300)
    floorArea:  float = Field(..., gt=0,  lt=10_000)
    landArea:   float = Field(..., ge=0,  lt=200_000)
    bedrooms:   int   = Field(..., ge=1,  le=20)
    bathrooms:  int   = Field(..., ge=1,  le=20)
    era:        EraCode
    cladding:   CladdingCode
    floodRisk:  FloodLabel
    assets:     list[str] = Field(default_factory=list)
    city:       Optional[str] = None
    tier:       Literal["standard", "premium", "ultra_luxury"] = "standard"
    # Extended fields from 5-step form
    property_type: Optional[str] = None
    title_type:    Optional[str] = None
    roof_type:     Optional[str] = None
    condition:     Optional[str] = None
    renovation:    Optional[str] = None
    insulation:    Optional[list[str]] = None
    heating:       Optional[list[str]] = None
    carparks:      Optional[int] = Field(default=None, ge=0, le=20)
    facing:        Optional[float] = Field(default=None, ge=0, lt=360)
    slope:         Optional[str] = None
    views:         Optional[list[str]] = None
    school_zone:   Optional[str] = None
    noise_level:   Optional[str] = None
    access:        Optional[str] = None


class DnaFactor(BaseModel):
    factor:           str
    impact_pct:       float
    reasoning_string: str


class CalculateResponse(BaseModel):
    """
    Always returned: base_value, confidence_score, property_id, is_paid.
    Returned ONLY when paid: dna_breakdown, reasoning_strings, metadata.
    """
    property_id:       str
    base_value:        float
    final_value:       Optional[float] = None
    confidence_score:  int
    is_paid:           bool
    dna_breakdown:     Optional[list[DnaFactor]] = None
    reasoning_strings: Optional[list[str]]       = None
    metadata:          Optional[dict[str, Any]]  = None
    disclaimer:        str


class CheckoutRequest(BaseModel):
    property_id: str = Field(..., min_length=8, max_length=64)
    address:     str = Field(..., min_length=3, max_length=300)


class CheckoutResponse(BaseModel):
    url: str


# ─── /calculate ───────────────────────────────────────────────────────────────

@router.post("/calculate", response_model=CalculateResponse)
async def calculate(
    body:     CalculateRequest,
    identity: Identity = Depends(get_identity),
) -> CalculateResponse:
    """
    Run the async DNA engine. Anonymous callers get the Base Valuation;
    authenticated + paid callers also get `dna_breakdown` & reasoning.
    """
    city        = _resolve_city(body.city, body.address)
    property_id = hash_property_id(address=body.address, city=city)

    is_paid = False
    if identity.user_id:
        is_paid = await is_property_paid(
            user_id=identity.user_id,
            property_id=property_id,
        )

    # ── LINZ parcel lookup (enriches land area from authoritative source) ──
    linz = LINZClient()
    linz_parcel = None
    if linz.is_configured():
        linz_parcel = await linz.resolve_address_to_parcel(body.address)

    # Use LINZ land area if caller didn't supply one (or supplied 0)
    land_area = float(body.landArea) if body.landArea > 0 else None
    if land_area is None and linz_parcel and linz_parcel.data_available and linz_parcel.land_area_sqm:
        land_area = float(linz_parcel.land_area_sqm)

    try:
        result = await calculate_dna_value(
            address       = body.address,
            city          = city,
            tier          = body.tier,
            area_sqm      = float(body.floorArea),
            era           = _ERA_MAP[body.era],
            cladding      = _CLADDING_MAP[body.cladding],
            flood_risk    = _FLOOD_MAP.get(body.floodRisk),
            land_area_sqm = land_area,
            bedrooms      = body.bedrooms,
            bathrooms     = body.bathrooms,
            assets        = [_ASSET_MAP[a] for a in body.assets if a in _ASSET_MAP],
        )
    except Exception as exc:                       # noqa: BLE001
        logger.exception("DNA engine failure")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Valuation engine error: {exc}",
        ) from exc

    breakdown = result.get("dna_breakdown", []) or []
    base_value = float(result.get("metadata", {}).get("structure_value")
                       or result.get("final_valuation", 0.0))

    response = CalculateResponse(
        property_id      = property_id,
        base_value       = round(base_value, 2),
        confidence_score = int(result.get("confidence_score", 0)),
        is_paid          = is_paid,
        disclaimer       = result.get("metadata", {}).get(
            "disclaimer",
            "INDICATIVE ONLY — Not a Registered Valuation.",
        ),
    )

    if is_paid:
        response.final_value       = float(result.get("final_valuation", base_value))
        response.dna_breakdown     = [DnaFactor(**f) for f in breakdown]
        response.reasoning_strings = [f["reasoning_string"] for f in breakdown]
        meta = result.get("metadata") or {}
        if linz_parcel and linz_parcel.data_available:
            meta["linz_parcel_id"]    = linz_parcel.parcel_id
            meta["linz_title_ref"]    = linz_parcel.title_ref
            meta["linz_land_area_m2"] = linz_parcel.land_area_sqm
            meta["linz_source"]       = linz_parcel.source
        response.metadata = meta

    return response


# ─── /create-checkout-session ─────────────────────────────────────────────────

@router.post("/create-checkout-session", response_model=CheckoutResponse)
async def create_checkout_session(
    body:     CheckoutRequest,
    identity: Identity = Depends(get_identity),
) -> CheckoutResponse:
    """
    Create a Stripe Checkout session for the $49 DNA unlock. Requires a
    valid Supabase JWT so we can attribute the purchase to a user_id.
    """
    if not identity.user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in required to purchase the DNA report",
        )

    secret = os.environ.get("STRIPE_SECRET_KEY")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe not configured",
        )

    # Imported lazily so the dev server boots without Stripe installed.
    import stripe                                   # noqa: PLC0415
    stripe.api_key = secret

    success = os.environ.get(
        "STRIPE_SUCCESS_URL",
        "http://localhost:5173/app?checkout=success&property_id={PID}",
    ).replace("{PID}", body.property_id)
    cancel  = os.environ.get(
        "STRIPE_CANCEL_URL",
        "http://localhost:5173/app?checkout=cancel",
    )

    try:
        session = stripe.checkout.Session.create(
            mode                = "payment",
            payment_method_types= ["card"],
            customer_email      = identity.email,
            success_url         = success,
            cancel_url          = cancel,
            metadata            = {
                "user_id":     identity.user_id,
                "property_id": body.property_id,
                "address":     body.address[:250],
            },
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency":     "nzd",
                    "unit_amount":  4900,           # $49.00
                    "product_data": {
                        "name":        "TerraAI Property DNA Report",
                        "description": (
                            f"Full DNA Intelligence Report for {body.address}"
                        ),
                    },
                },
            }],
        )
    except Exception as exc:                       # noqa: BLE001
        logger.exception("Stripe checkout creation failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {exc}",
        ) from exc

    if not session.url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe did not return a checkout URL",
        )
    return CheckoutResponse(url=session.url)


# ─── /stripe-webhook ──────────────────────────────────────────────────────────

@router.post("/stripe-webhook", include_in_schema=False)
async def stripe_webhook(request: Request) -> dict[str, Any]:
    """
    Receives `checkout.session.completed` and upserts is_paid=true into
    the Supabase `paid_properties` table.
    """
    secret  = os.environ.get("STRIPE_SECRET_KEY")
    wh_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    if not secret or not wh_secret:
        raise HTTPException(503, "Stripe webhook not configured")

    import stripe                                   # noqa: PLC0415
    stripe.api_key = secret

    payload   = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, signature, wh_secret,
        )
    except Exception as exc:                       # noqa: BLE001
        raise HTTPException(400, f"Invalid Stripe signature: {exc}") from exc

    if event["type"] == "checkout.session.completed":
        session     = event["data"]["object"]
        meta        = session.get("metadata") or {}
        user_id     = meta.get("user_id")
        property_id = meta.get("property_id")
        if user_id and property_id:
            ok = await mark_property_paid(
                user_id           = user_id,
                property_id       = property_id,
                stripe_session_id = session.get("id", ""),
            )
            if not ok:
                logger.error("Failed to mark paid for %s/%s",
                             user_id, property_id)
        else:
            logger.warning("Stripe webhook missing user_id/property_id metadata")

    return {"received": True}
