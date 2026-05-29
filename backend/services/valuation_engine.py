"""
TerraAI Intelligence Layer — services/valuation_engine.py
==========================================================
Applies the Condition Multiplier formula and enriches the result with
live GIS overlays when available.

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
    All factor values are labelled as indicative model inputs.
    When a GIS data field is unavailable its multiplier is 1.0 (neutral)
    and the relevant note explicitly states "Data Unavailable".

DISCLAIMER:
    This engine is NOT a Registered Valuation. Outputs are indicative only.
    See LAWYER_SHIELD.md for the full legal framework.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from services.gis_service import GISBundle


# ─── Type Aliases ─────────────────────────────────────────────────────────────

EraType       = Literal["pre-1940", "1940s-1960s", "1970s-1990s", "2000s-2010s", "2010s-present"]
ConditionType = Literal["excellent", "good", "fair", "poor"]
RiskLevel     = Literal["low", "medium", "high"]


# ─── Model Constants ──────────────────────────────────────────────────────────
#
# Source: Indicative median $/m² from public REINZ / Domain / CoreLogic data.
# ZERO HALLUCINATION: These are approximate model inputs, NOT certified valuations.

BASE_PRICE_PER_SQM: dict[str, float] = {
    # NZ
    "Auckland":     7_500,
    "Wellington":   7_000,
    "Christchurch": 5_500,
    "Hamilton":     5_000,
    "Tauranga":     6_000,
    "Dunedin":      4_500,
    # AU — Phase 3 placeholders
    "Sydney":       9_000,
    "Melbourne":    8_000,
    "Brisbane":     6_800,
    "Perth":        6_200,
    "Adelaide":     5_800,
}

# ── Condition Multipliers ─────────────────────────────────────────────────────
# Applied to the base $/m² after city lookup.
CONDITION_MULTIPLIERS: dict[str, float] = {
    "excellent": 1.15,
    "good":      1.05,
    "fair":      1.00,
    "poor":      0.80,
}

# ── Era Factors ───────────────────────────────────────────────────────────────
# The 1970s–1990s range carries a weathertightness / leaky-building discount
# reflecting NZ's building-act weathertightness failures.
ERA_FACTORS: dict[str, float] = {
    "pre-1940":       0.92,
    "1940s-1960s":    0.90,
    "1970s-1990s":    0.85,
    "2000s-2010s":    1.00,
    "2010s-present":  1.05,
}

ERA_CONFIDENCE_DELTA: dict[str, int] = {
    "pre-1940":       -5,
    "1940s-1960s":    -5,
    "1970s-1990s":   -10,
    "2000s-2010s":     0,
    "2010s-present":  +5,
}

# ── Flood Discount Multipliers ────────────────────────────────────────────────
# Applied to the raw estimated value when live GIS flood data is available.
# Sourced from indicative NZ/AU property market research — not certified data.
FLOOD_DISCOUNT_MULTIPLIERS: dict[str, float] = {
    "high":   0.82,   # ~18 % discount — active flood zone
    "medium": 0.93,   # ~7 %  discount — flood fringe
    "low":    1.00,   # no discount
}

FLOOD_CONFIDENCE_DELTA: dict[str, int] = {
    "high":   -10,
    "medium":  -5,
    "low":      0,
}

# ── Zoning Multipliers ────────────────────────────────────────────────────────
# Auckland Unitary Plan and NSW LEP zone codes mapped to indicative value effects.
# Higher-density zoning unlocks more development potential → premium on land value.
ZONING_MULTIPLIERS: dict[str, float] = {
    # Auckland (AUP 2016)
    "THAB": 1.12,   # Terraced Housing & Apartment Buildings — highest density
    "MHU":  1.07,   # Mixed Housing Urban
    "MHS":  1.03,   # Mixed Housing Suburban
    "SHZ":  1.00,   # Single House Zone (baseline)
    "RUR":  0.88,   # Rural — constrained development
    # NSW LEP standard zones
    "R1":   1.05,   # General Residential
    "R2":   1.00,   # Low Density Residential (baseline)
    "R3":   1.08,   # Medium Density Residential
    "R4":   1.12,   # High Density Residential
    "B1":   1.15,   # Neighbourhood Centre
    "B2":   1.10,   # Local Centre
    "RU1":  0.85,   # Primary Production (rural)
}


# ─── Input / Output Models ────────────────────────────────────────────────────

@dataclass
class ValuationInput:
    """Validated property inputs supplied by the user."""

    address:   str
    suburb:    str
    city:      str
    sqm:       float
    beds:      int
    baths:     int
    era:       EraType
    condition: ConditionType


@dataclass
class ValuationOutput:
    """Full enriched valuation result returned to the API layer."""

    # ── Core figures ────────────────────────────────────────────────────────
    estimated_value_nzd: int
    price_per_sqm_nzd:   int
    confidence_score:    int          # 0–100
    risk_level:          RiskLevel

    # ── Factor breakdown (full transparency) ─────────────────────────────────
    base_price_per_sqm:  float
    condition_multiplier: float
    era_factor:          float
    flood_discount:      float        # 1.0 if no live GIS data
    zoning_multiplier:   float        # 1.0 if no live GIS data

    # ── GIS context ──────────────────────────────────────────────────────────
    flood_risk_note: str
    zoning_note:     str
    parcel_id:       Optional[str]
    land_area_sqm:   Optional[float]

    # ── Compliance ───────────────────────────────────────────────────────────
    disclaimer:   str
    data_sources: list[str] = field(default_factory=list)


# ─── Pure Factor Functions ────────────────────────────────────────────────────

def apply_condition_multiplier(base_sqm_price: float, condition: ConditionType) -> float:
    """
    Multiply the base $/m² by the condition factor.

    Args:
        base_sqm_price: Indicative base price per m² for the city.
        condition:      User-reported property condition.

    Returns:
        Condition-adjusted price per m².
    """
    return base_sqm_price * CONDITION_MULTIPLIERS[condition]


def apply_era_factor(price: float, era: EraType) -> float:
    """
    Adjust the price per m² for build era.

    The 1970s–1990s era carries a weathertightness risk discount.
    Post-2010 stock receives a small new-build premium.
    """
    return price * ERA_FACTORS[era]


def apply_flood_discount(value: float, risk_level: Optional[str]) -> tuple[float, float]:
    """
    Discount an estimated value based on flood-zone risk.

    Args:
        value:      Raw estimated property value.
        risk_level: "low" | "medium" | "high", or None if GIS unavailable.

    Returns:
        Tuple of (discounted_value, multiplier_applied).
        Returns (value, 1.0) if risk_level is None (no live data).
    """
    if risk_level is None or risk_level not in FLOOD_DISCOUNT_MULTIPLIERS:
        return value, 1.0
    multiplier = FLOOD_DISCOUNT_MULTIPLIERS[risk_level]
    return value * multiplier, multiplier


def apply_zoning_multiplier(value: float, zone_code: Optional[str]) -> tuple[float, float]:
    """
    Apply a density-zoning premium or rural discount to an estimated value.

    Args:
        value:     Value after flood adjustment.
        zone_code: AUP or NSW LEP zone code, or None if GIS unavailable.

    Returns:
        Tuple of (adjusted_value, multiplier_applied).
        Returns (value, 1.0) if zone_code is None or not in the lookup table.
    """
    if zone_code is None or zone_code not in ZONING_MULTIPLIERS:
        return value, 1.0
    multiplier = ZONING_MULTIPLIERS[zone_code]
    return value * multiplier, multiplier


# ─── Private Helpers ──────────────────────────────────────────────────────────

def _bed_bath_premium(beds: int, baths: int) -> float:
    """
    Small multiplicative premium for above-baseline bedroom/bathroom counts.

    Baseline: 3 beds, 2 baths.
    Each extra bed adds 2 %, each extra bath adds 1.5 %.
    """
    bed_premium  = max(0.0, (beds  - 3) * 0.02)
    bath_premium = max(0.0, (baths - 2) * 0.015)
    return 1.0 + bed_premium + bath_premium


def _build_data_sources(gis: GISBundle) -> list[str]:
    """Construct the transparent, per-source attribution list."""
    sources: list[str] = [
        "TerraAI Valuation Engine v0.2.0",
        "Base $/m² model: indicative REINZ/CoreLogic/Domain median ranges (public data)",
    ]

    if gis.parcel.data_available:
        sources.append(
            f"Parcel data: {gis.parcel.source} (parcel_id={gis.parcel.parcel_id})"
        )
    else:
        sources.append(f"Parcel data: NOT CONNECTED — {gis.parcel.error}")

    if gis.flood.data_available:
        sources.append(f"Flood risk: {gis.flood.source_dataset}")
    else:
        sources.append(f"Flood risk: NOT CONNECTED — {gis.flood.error}")

    if gis.zoning.data_available:
        sources.append(f"Zoning: {gis.zoning.source}")
    else:
        sources.append(f"Zoning: NOT CONNECTED — {gis.zoning.error}")

    return sources


def _build_flood_note(gis: GISBundle, flood_mult: float) -> str:
    if gis.flood.data_available:
        discount_pct = round((1.0 - flood_mult) * 100, 1)
        return (
            f"Flood risk: {(gis.flood.risk_level or '').upper()} "
            f"(zone: {gis.flood.flood_zone_code}, "
            f"AEP: {gis.flood.aep_pct}%, "
            f"source: {gis.flood.source_dataset}). "
            f"Value discount applied: {discount_pct}%."
        )
    return (
        f"DATA UNAVAILABLE — {gis.flood.error} "
        "Flood discount not applied. "
        "Activate LINZ_API_KEY / AUCKLAND_COUNCIL_GIS_KEY to enable."
    )


def _build_zoning_note(gis: GISBundle, zoning_mult: float) -> str:
    if gis.zoning.data_available:
        return (
            f"Zone: {gis.zoning.zone_code} — {gis.zoning.zone_name}. "
            f"Max height: {gis.zoning.max_height_m} m, "
            f"Min lot: {gis.zoning.min_lot_size_sqm} m². "
            f"Zoning multiplier applied: {zoning_mult:.2f}. "
            f"Source: {gis.zoning.source}."
        )
    return (
        f"DATA UNAVAILABLE — {gis.zoning.error} "
        "Zoning multiplier not applied. "
        "Activate AUCKLAND_COUNCIL_GIS_KEY / NSW_SPATIAL_API_KEY to enable."
    )


# ─── Main Valuation Orchestrator ──────────────────────────────────────────────

def calculate_valuation(inp: ValuationInput, gis: GISBundle) -> ValuationOutput:
    """
    Apply the full TerraAI valuation formula to user inputs + a GIS bundle.

    Formula (all factors are indicative model inputs — NOT certified data):
    ┌─────────────────────────────────────────────────────────────────────┐
    │  price_per_sqm  = base_sqm                                          │
    │                   × condition_multiplier                            │
    │                   × era_factor                                      │
    │                   × bed_bath_premium                                │
    │                                                                     │
    │  raw_value      = price_per_sqm × sqm                               │
    │                                                                     │
    │  final_value    = raw_value                                         │
    │                   × flood_discount      (1.0 if GIS unavailable)    │
    │                   × zoning_multiplier   (1.0 if GIS unavailable)    │
    └─────────────────────────────────────────────────────────────────────┘

    Confidence is penalised for:
        - Old / risky era                (ERA_CONFIDENCE_DELTA)
        - High / medium flood risk       (FLOOD_CONFIDENCE_DELTA)
        - Poor condition                 (-10 pts)
        - No live parcel data            (-5 pts)
        - No live flood data             (-5 pts)
    Confidence is rewarded for live GIS data (+5 pts).

    ZERO HALLUCINATION: when GIS data is unavailable its multipliers are 1.0
    and the note explicitly states "Data Unavailable".
    """

    # ── 1. City base price ────────────────────────────────────────────────────
    base_sqm = BASE_PRICE_PER_SQM.get(inp.city, 7_500)

    # ── 2. Condition Multiplier ───────────────────────────────────────────────
    conditioned_price = apply_condition_multiplier(base_sqm, inp.condition)

    # ── 3. Era Factor ─────────────────────────────────────────────────────────
    era_price = apply_era_factor(conditioned_price, inp.era)

    # ── 4. Bed / bath premium ─────────────────────────────────────────────────
    price_per_sqm = era_price * _bed_bath_premium(inp.beds, inp.baths)

    # ── 5. Raw estimated value ────────────────────────────────────────────────
    raw_value = price_per_sqm * inp.sqm

    # ── 6. Flood discount (live GIS) ──────────────────────────────────────────
    flood_risk     = gis.flood.risk_level if gis.flood.data_available else None
    flood_value, flood_mult = apply_flood_discount(raw_value, flood_risk)

    # ── 7. Zoning multiplier (live GIS) ───────────────────────────────────────
    zone_code = gis.zoning.zone_code if gis.zoning.data_available else None
    final_value, zoning_mult = apply_zoning_multiplier(flood_value, zone_code)

    # ── 8. Confidence Score ───────────────────────────────────────────────────
    confidence = 65
    confidence += ERA_CONFIDENCE_DELTA.get(inp.era, 0)

    if inp.condition == "poor":
        confidence -= 10

    if gis.flood.data_available:
        confidence += FLOOD_CONFIDENCE_DELTA.get(gis.flood.risk_level or "low", 0)
        confidence += 5   # bonus: real data reduces uncertainty
    else:
        confidence -= 5   # penalty: flood risk unverified

    if not gis.parcel.data_available:
        confidence -= 5   # penalty: address unconfirmed against cadastre

    confidence = max(25, min(95, confidence))

    # ── 9. Risk Level ─────────────────────────────────────────────────────────
    high_flood  = gis.flood.data_available and gis.flood.risk_level == "high"
    med_flood   = gis.flood.data_available and gis.flood.risk_level == "medium"

    if inp.era == "1970s-1990s" or inp.condition == "poor" or high_flood:
        risk_level: RiskLevel = "high"
    elif inp.condition == "fair" or inp.era in ("pre-1940", "1940s-1960s") or med_flood:
        risk_level = "medium"
    else:
        risk_level = "low"

    # ── 10. Assemble output ───────────────────────────────────────────────────
    return ValuationOutput(
        estimated_value_nzd  = round(final_value / 1_000) * 1_000,
        price_per_sqm_nzd    = round(price_per_sqm),
        confidence_score     = confidence,
        risk_level           = risk_level,
        base_price_per_sqm   = base_sqm,
        condition_multiplier = CONDITION_MULTIPLIERS[inp.condition],
        era_factor           = ERA_FACTORS[inp.era],
        flood_discount       = flood_mult,
        zoning_multiplier    = zoning_mult,
        flood_risk_note      = _build_flood_note(gis, flood_mult),
        zoning_note          = _build_zoning_note(gis, zoning_mult),
        parcel_id            = gis.parcel.parcel_id,
        land_area_sqm        = gis.parcel.land_area_sqm,
        disclaimer=(
            "INDICATIVE ONLY. TerraAI is NOT a Registered Valuation, "
            "Geotechnical Assessment, or Legal Advice. "
            "Data is synthesised from public sources and must be verified "
            "by a licensed Registered Valuer prior to any financial transaction. "
            "Liability is capped at the purchase price of the report. "
            "See LAWYER_SHIELD.md for the full legal framework."
        ),
        data_sources=_build_data_sources(gis),
    )
