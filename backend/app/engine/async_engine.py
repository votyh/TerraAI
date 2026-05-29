"""
TerraAI Async DNA Engine — engine/async_engine.py
==================================================
Fully async orchestrator for property DNA valuation.

Concurrently fetches:
    • LiDAR topography data   → get_lidar_data(address)
    • Solar exposure data     → get_solar_exposure(address)

Then applies the full multiplier chain from data_v1.json and rules.py,
returning a structured breakdown dict ready for the frontend dashboard.

Usage:
    import asyncio
    from async_engine import calculate_dna_value

    result = asyncio.run(calculate_dna_value(
        address="12 Queen Street, Auckland",
        city="auckland",
        tier="standard",
        area_sqm=140,
        era="modern_high_performance_2020_2026",
        cladding="brick_and_tile",
    ))

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
    Outputs are indicative model estimates, NOT a Registered Valuation.
    If any external service fails, its factor defaults to neutral (1.0)
    and confidence_score is penalised accordingly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from pathlib import Path
from typing import Any, Literal, Optional

from rules import load_rules, sunlight_bonus, ValuationRules

logger = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).parent / "data_v1.json"

# ─── Types ────────────────────────────────────────────────────────────────────

TopoGrade = Literal["flat", "moderate", "steep"]

# ─── Valuation Constants ─────────────────────────────────────────────────────

# Default land rates ($/m2) by city — applied when land_area_sqm is provided
_LAND_RATE_DEFAULT: dict[str, float] = {
    "auckland":     1_200.0,
    "wellington":     900.0,
    "christchurch":   650.0,
    "sydney":       1_850.0,
    "melbourne":    1_500.0,
    "brisbane":       950.0,
}

# 2026 insurance-market flood/hazard multipliers (dedicated flood_risk param)
_FLOOD_MULTIPLIERS: dict[str, float] = {
    "floodplain":    -0.125,   # -12.5%
    "overland_flow": -0.040,   # -4.0%
}

# Flat-rate asset add-ons — comparable-sales anchored, 2026 NZD/AUD
_ASSET_FLAT_VALUES: dict[str, float] = {
    "pool":           65_000.0,
    "minor_dwelling": 150_000.0,
    "solar_array":     15_000.0,
}

_ENSUITE_BONUS    = 35_000.0   # +$35k for 2nd bathroom
_FRICTION_PENALTY = 0.03       # -3.0% utility friction (4+ bed / 1 bath)

# ─── Mock External Services ───────────────────────────────────────────────────

async def get_lidar_data(address: str) -> TopoGrade:
    """
    Mock async LiDAR service — returns topographic slope grade.

    Phase 2: replace with a live call to the LINZ LiDAR API or
    AWS Terrain Tiles, both of which return slope-angle rasters
    that can be classified into flat / moderate / steep.

    Returns:
        "flat"     — slope < 5°
        "moderate" — slope 5°–15°
        "steep"    — slope > 15°
    """
    await asyncio.sleep(0.05)  # simulate network latency

    # Deterministic seed from address string so tests are repeatable
    seed = sum(ord(c) for c in address)
    rng = random.Random(seed)
    return rng.choice(["flat", "flat", "moderate", "steep"])  # weighted toward flat


async def get_solar_exposure(address: str) -> float:
    """
    Mock async solar-exposure service — returns estimated average daily
    direct sunlight hours (float, 1.0–10.0).

    Phase 2: replace with Google Solar API or NIWA SolarView,
    both of which return hourly irradiance → peak sun hours.

    Returns:
        Float between 1.0 and 10.0 representing avg daily sun hours.
    """
    await asyncio.sleep(0.05)  # simulate network latency

    seed = sum(ord(c) for c in address) + 1
    rng = random.Random(seed)
    return round(rng.uniform(3.0, 9.5), 1)


# ─── JSON Loader ──────────────────────────────────────────────────────────────

def _load_json() -> dict[str, Any]:
    try:
        with _DATA_PATH.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.error("Failed to load data_v1.json: %s", exc)
        return {}


# ─── Factor Resolvers ─────────────────────────────────────────────────────────

def _resolve_base_cost(data: dict, city: str, tier: str) -> tuple[float, str]:
    """
    Read the region-specific standard base_cost_per_sqm from data_v1.json.

    Returns (cost, source_string).
    Falls back to rules.py value if JSON key is missing.
    """
    city_lower = city.lower()
    tier_lower = tier.lower()

    # Map city → data_v1.json path
    _city_path: dict[str, tuple[str, str]] = {
        "auckland":     ("new_zealand", "auckland"),
        "wellington":   ("new_zealand", "wellington"),
        "sydney":       ("australia",   "sydney"),
        "melbourne":    ("australia",   "melbourne"),
        "brisbane":     ("australia",   "brisbane"),
    }

    region_key, city_key = _city_path.get(city_lower, ("new_zealand", "auckland"))

    try:
        tier_block = (
            data["macro_baseline_cost_per_sqm_2026"]
            [region_key]
            [city_key]
            [tier_lower]
        )
        low  = float(tier_block["low"])
        high = float(tier_block["high"])
        cost = (low + high) / 2.0
        source = tier_block.get("source", "data_v1.json")
        return cost, source
    except (KeyError, TypeError, ValueError):
        # Fall back to rules.py
        rules = load_rules()
        cost = float(rules.base_costs.get(city_lower, {}).get(tier_lower, 4000))
        return cost, "rules.py (data_v1.json key missing)"


def _resolve_era(data: dict, era: str) -> tuple[float, str]:
    """
    Return (multiplier, reasoning_string) for the given era key.

    Reads from data_v1.json decade_era_value_multiplier_matrix where possible,
    then falls back to rules.py era_multipliers.
    """
    rules = load_rules()

    _era_display: dict[str, str] = {
        "villa_heritage_1900_1920":         "NZ Villa Heritage Premium",
        "post_war_solid_1950_1960":         "Post-War Solid Build Premium",
        "leaky_era_1990_2004":              "Leaky-Building Stigma Discount",
        "modern_high_performance_2020_2026": "Modern High-Performance Premium",
        # legacy aliases
        "villa_heritage":                   "NZ Villa Heritage Premium",
        "leaky_era_90s":                    "Leaky-Building Stigma Discount",
        "modern_2020":                      "Modern High-Performance Premium",
    }

    # Attempt live read from JSON
    try:
        matrix = data["decade_era_value_multiplier_matrix"]
        _json_keys = {
            "villa_heritage_1900_1920":         ("nz_villa_heritage_1900_1920",       "special_character_area_premium_pct"),
            "villa_heritage":                   ("nz_villa_heritage_1900_1920",       "special_character_area_premium_pct"),
            "leaky_era_1990_2004":              ("nz_au_leaky_building_era_1990_2004", "general_market_stigma_discount_pct"),
            "leaky_era_90s":                    ("nz_au_leaky_building_era_1990_2004", "general_market_stigma_discount_pct"),
            "modern_high_performance_2020_2026": ("modern_high_performance_2020_2026",  "new_build_premium_over_existing_pct"),
            "modern_2020":                      ("modern_high_performance_2020_2026",  "new_build_premium_over_existing_pct"),
        }
        if era in _json_keys:
            json_section, pct_key = _json_keys[era]
            raw_pct = float(matrix[json_section][pct_key])
            multiplier = 1.0 + (raw_pct / 100.0)
            display = _era_display.get(era, era)
            sign = "+" if raw_pct >= 0 else ""
            return multiplier, f"{display}: {sign}{raw_pct}%"
    except (KeyError, TypeError, ValueError):
        pass

    # Fall back to rules.py
    multiplier = rules.era_multipliers.get(era, 1.0)
    pct = round((multiplier - 1.0) * 100, 2)
    sign = "+" if pct >= 0 else ""
    display = _era_display.get(era, era)
    return multiplier, f"{display}: {sign}{pct}% (rules.py fallback)"


def _resolve_cladding(data: dict, cladding: str) -> tuple[float, str]:
    """
    Return (multiplier, reasoning_string) for the given cladding key.

    Reads premium/penalty percentages from data_v1.json cladding_roofing_performance,
    then normalises relative to the fibre_cement_weatherboard benchmark.
    Falls back to rules.py cladding_multipliers.
    """
    rules = load_rules()

    _display: dict[str, str] = {
        "brick_and_tile":            "Brick & Tile Material Premium",
        "vertical_cedar":            "Vertical Cedar Aesthetic Premium",
        "aac_panels_hebel":          "AAC/Hebel Panel Premium",
        "fibre_cement_weatherboard": "Fibre Cement (Benchmark)",
        "monolithic_plaster":        "Monolithic Plaster Risk Discount",
    }

    try:
        perf = data["cladding_roofing_performance"]

        def _midpoint(v: dict | float | int) -> float:
            if isinstance(v, dict):
                return (v.get("low", 0) + v.get("high", 0)) / 2.0
            return float(v)

        _pct_map: dict[str, float] = {
            "brick_and_tile":            float(perf["brick_and_tile"]["premium_over_weatherboard_pct"]),
            "vertical_cedar":            _midpoint(perf["vertical_cedar"]["aesthetic_premium_pct"]),
            "aac_panels_hebel":          _midpoint(perf["aac_panels_hebel"]["premium_over_fibre_cement_pct"]),
            "fibre_cement_weatherboard": 0.0,
            "monolithic_plaster":        _midpoint(perf["fibre_cement_weatherboard"]["resale_underperformance_vs_brick_pct"]),
        }
        raw_pct = _pct_map.get(cladding, 0.0)
        multiplier = 1.0 + (raw_pct / 100.0)
        display = _display.get(cladding, cladding)
        sign = "+" if raw_pct >= 0 else ""
        return multiplier, f"{display}: {sign}{round(raw_pct, 1)}%"
    except (KeyError, TypeError, ValueError):
        pass

    multiplier = rules.cladding_multipliers.get(cladding, 1.0)
    pct = round((multiplier - 1.0) * 100, 2)
    sign = "+" if pct >= 0 else ""
    display = _display.get(cladding, cladding)
    return multiplier, f"{display}: {sign}{pct}% (rules.py fallback)"


def _resolve_topo(topo_grade: TopoGrade, rules: ValuationRules) -> tuple[float, str]:
    """Return (multiplier, reasoning_string) for topographic slope grade."""
    penalty_pct = rules.topography_penalties.get(topo_grade, 0.0) * 100
    multiplier  = 1.0 + (penalty_pct / 100.0)
    if penalty_pct == 0.0:
        return multiplier, "Topography (Flat): no penalty"
    return multiplier, f"Topography ({topo_grade.title()} Slope): {penalty_pct:.0f}%"


def _resolve_sunlight(solar_hours: float, city: str, rules: ValuationRules) -> tuple[float, str]:
    """Return (multiplier, reasoning_string) for solar exposure."""
    city_avg = rules.city_avg_sunlight_hours.get(city.lower(), 5.0)
    bonus_pct = sunlight_bonus(solar_hours, city, rules)
    multiplier = 1.0 + (bonus_pct / 100.0)
    excess = round(solar_hours - city_avg, 1)
    if bonus_pct == 0.0:
        return multiplier, f"Solar Exposure ({solar_hours}h/day, avg {city_avg}h): no bonus"
    return (
        multiplier,
        f"Solar Exposure ({solar_hours}h/day, +{excess}h above {city_avg}h avg): +{bonus_pct}%",
    )


# ─── Confidence Scorer ────────────────────────────────────────────────────────

def _confidence(
    topo_ok: bool,
    solar_ok: bool,
    era_from_json: bool,
    cladding_from_json: bool,
    base_from_json: bool,
) -> int:
    """
    Return a 0–100 confidence score based on data-source availability.

    Scoring:
        Base JSON present     +20
        Era from JSON         +20
        Cladding from JSON    +20
        LiDAR topo available  +20
        Solar data available  +20
    """
    score = 0
    if base_from_json:     score += 20
    if era_from_json:      score += 20
    if cladding_from_json: score += 20
    if topo_ok:            score += 20
    if solar_ok:           score += 20
    return score


# ─── Main Async Engine ────────────────────────────────────────────────────────

async def calculate_dna_value(
    address:          str,
    city:             str,
    tier:             str,
    area_sqm:         float,
    era:              str,
    cladding:         str,
    # --- optional geo/risk -------------------------------------------------
    risk:             Optional[str]       = None,
    flood_risk:       Optional[str]       = None,   # "floodplain" | "overland_flow"
    # --- optional property attributes --------------------------------------
    land_area_sqm:    Optional[float]     = None,
    bedrooms:         Optional[int]       = None,
    bathrooms:        Optional[int]       = None,
    assets:           Optional[list[str]] = None,   # "pool" | "minor_dwelling" | "solar_array"
    # --- optional lifestyle / zone / overrides ----------------------------
    lifestyle:        Optional[list[str]] = None,
    is_in_prime_zone: bool                = False,
    rules_overrides:  Optional[dict]      = None,
) -> dict[str, Any]:
    """
    Fully async TerraAI DNA valuation engine.

    Concurrently fetches LiDAR topography and solar-exposure data, then
    applies the full multiplier chain sourced from data_v1.json and rules.py.

    Args:
        address:          Full property address string (used for geo lookups).
        city:             Lowercase city name (e.g., "auckland", "sydney").
        tier:             "standard" | "premium" | "ultra_luxury".
        area_sqm:         Floor area in m².
        era:              Era key from rules.era_multipliers.
        cladding:         Cladding key from rules.cladding_multipliers.
        risk:             Optional geospatial risk key from rules.risk_discounts.
        lifestyle:        Optional list of lifestyle asset keys.
        is_in_prime_zone: If True, applies a +15% School Zone Premium reflecting
                          proximity to a decile-9/10 or Band A/B school catchment.
        rules_overrides:  Optional partial dict to layer over TERRA_RULES.

    Returns:
        dict with keys:
            final_valuation  — float, DNA-adjusted total value
            confidence_score — int 0–100
            dna_breakdown    — list[dict] with factor / impact_pct / reasoning_string
            metadata         — dict with data sources and disclaimer
    """
    rules = load_rules(rules_overrides)
    data  = _load_json()

    # ── 1. Concurrent external data fetch ────────────────────────────────────
    topo_grade: TopoGrade
    solar_hours: float
    topo_ok  = True
    solar_ok = True

    try:
        topo_grade, solar_hours = await asyncio.gather(
            get_lidar_data(address),
            get_solar_exposure(address),
        )
    except Exception as exc:
        logger.warning("External service gather failed: %s — defaulting to neutral", exc)
        topo_grade  = "flat"
        solar_hours = rules.city_avg_sunlight_hours.get(city.lower(), 5.0)
        topo_ok  = False
        solar_ok = False

    # ── 2. Resolve all factors ────────────────────────────────────────────────
    breakdown: list[dict[str, Any]] = []

    # Base cost
    base_cost_per_sqm, base_source = _resolve_base_cost(data, city, tier)
    base_from_json = "data_v1.json" in base_source

    # Era
    try:
        era_mult, era_reason = _resolve_era(data, era)
        era_from_json = "fallback" not in era_reason
    except Exception as exc:
        logger.warning("Era resolution failed: %s", exc)
        era_mult, era_reason = 1.0, f"Era factor: 0% (resolution error)"
        era_from_json = False

    era_pct = round((era_mult - 1.0) * 100, 2)
    breakdown.append({"factor": "era", "impact_pct": era_pct, "reasoning_string": era_reason})

    # Cladding
    try:
        cladding_mult, cladding_reason = _resolve_cladding(data, cladding)
        cladding_from_json = "fallback" not in cladding_reason
    except Exception as exc:
        logger.warning("Cladding resolution failed: %s", exc)
        cladding_mult, cladding_reason = 1.0, f"Cladding factor: 0% (resolution error)"
        cladding_from_json = False

    cladding_pct = round((cladding_mult - 1.0) * 100, 2)
    breakdown.append({"factor": "cladding", "impact_pct": cladding_pct, "reasoning_string": cladding_reason})

    # Geospatial risk
    risk_mult = 1.0
    if risk:
        risk_mult = rules.risk_discounts.get(risk, 1.0)
        risk_pct  = round((risk_mult - 1.0) * 100, 2)
        _risk_labels = {
            "flood_plain_100y":   "Flood Plain (1-in-100yr) Discount",
            "flood_plain_500y":   "Flood Plain (1-in-500yr) Discount",
            "overland_flow_path": "Overland Flow Path Discount",
            "coastal_erosion":    "Coastal Erosion Zone Discount",
        }
        label = _risk_labels.get(risk, f"Risk Discount ({risk})")
        breakdown.append({"factor": "risk", "impact_pct": risk_pct, "reasoning_string": f"{label}: {risk_pct}%"})

    # Lifestyle assets
    lifestyle_mult = 1.0
    for asset in (lifestyle or []):
        asset_mult = rules.lifestyle_assets.get(asset, 1.0)
        lifestyle_mult *= asset_mult
        asset_pct = round((asset_mult - 1.0) * 100, 2)
        _asset_labels = {
            "pool":             "In-Ground Pool Premium",
            "premium_deck":     "Premium Deck Premium",
            "high_kerb_appeal": "High Kerb Appeal Premium",
            "ensuite_addition": "Ensuite Addition Premium",
            "double_glazing":   "Double Glazing Premium",
        }
        label = _asset_labels.get(asset, f"Lifestyle: {asset}")
        breakdown.append({"factor": f"lifestyle_{asset}", "impact_pct": asset_pct, "reasoning_string": f"{label}: +{asset_pct}%"})

    # Topography (LiDAR)
    try:
        topo_mult, topo_reason = _resolve_topo(topo_grade, rules)
    except Exception as exc:
        logger.warning("Topo resolution failed: %s", exc)
        topo_mult, topo_reason = 1.0, "Topography: 0% (resolution error)"
        topo_ok = False

    topo_pct = round((topo_mult - 1.0) * 100, 2)
    breakdown.append({"factor": "topography", "impact_pct": topo_pct, "reasoning_string": topo_reason})

    # Solar exposure (2.4% rule)
    try:
        solar_mult, solar_reason = _resolve_sunlight(solar_hours, city, rules)
    except Exception as exc:
        logger.warning("Solar resolution failed: %s", exc)
        solar_mult, solar_reason = 1.0, "Solar exposure: 0% (resolution error)"
        solar_ok = False

    solar_pct = round((solar_mult - 1.0) * 100, 4)
    breakdown.append({"factor": "solar_exposure", "impact_pct": solar_pct, "reasoning_string": solar_reason})

    # School Zone Premium
    _SCHOOL_ZONE_PREMIUM = 0.15  # +15%
    school_zone_mult = 1.0 + _SCHOOL_ZONE_PREMIUM if is_in_prime_zone else 1.0
    if is_in_prime_zone:
        breakdown.append({
            "factor": "school_zone",
            "impact_pct": round(_SCHOOL_ZONE_PREMIUM * 100, 2),
            "reasoning_string": "School Zone Premium: +15.0% (prime school catchment)",
        })

    # ── Flood / Hazard Risk ───────────────────────────────────────────────────
    flood_mult = 1.0
    if flood_risk and flood_risk != "none":
        penalty    = _FLOOD_MULTIPLIERS.get(flood_risk, 0.0)
        flood_mult = 1.0 + penalty
        flood_pct  = round(penalty * 100, 2)
        _flood_labels = {
            "floodplain":    "Floodplain (1-in-100yr) Insurance Discount",
            "overland_flow": "Overland Flow Path Insurance Discount",
        }
        label = _flood_labels.get(flood_risk, f"Flood / Hazard Discount ({flood_risk})")
        breakdown.append({
            "factor":           "flood_risk",
            "impact_pct":       flood_pct,
            "reasoning_string": (
                f"{label}: {flood_pct:.1f}%  "
                "(2026 insurance-market reality — banks apply LVR restrictions "
                "and insurers load premiums on flood-mapped properties)"
            ),
        })

    # ── Utility Density ───────────────────────────────────────────────────────
    utility_friction_mult   = 1.0
    utility_flat_additions: list[tuple[str, float, str]] = []

    if bedrooms is not None and bathrooms is not None:
        if bathrooms >= 2:
            utility_flat_additions.append((
                "utility_ensuite",
                _ENSUITE_BONUS,
                (
                    f"Ensuite Addition Premium: +${_ENSUITE_BONUS:,.0f}  "
                    "(2nd bathroom raises buyer utility score and reduces negotiation friction)"
                ),
            ))
        elif bedrooms >= 4 and bathrooms == 1:
            utility_friction_mult = 1.0 - _FRICTION_PENALTY
            breakdown.append({
                "factor":           "utility_density",
                "impact_pct":       round(-_FRICTION_PENALTY * 100, 2),
                "reasoning_string": (
                    f"Utility Friction Penalty: -{_FRICTION_PENALTY * 100:.0f}%  "
                    f"({bedrooms} bedrooms, only {bathrooms} bathroom — "
                    "buyers discount heavily for under-serviced floor plans)"
                ),
            })

    # ── Flat-Rate Asset Add-Ons ───────────────────────────────────────────────
    flat_asset_additions: list[tuple[str, float, str]] = []
    _asset_labels_map = {
        "pool":           "In-Ground Pool",
        "minor_dwelling": "Minor Dwelling (Granny Flat / Income Unit)",
        "solar_array":    "Solar Array",
    }
    for asset in (assets or []):
        flat = _ASSET_FLAT_VALUES.get(asset, 0.0)
        if flat > 0:
            label = _asset_labels_map.get(asset, f"Asset: {asset}")
            flat_asset_additions.append((
                f"asset_{asset}",
                flat,
                f"{label}: +${flat:,.0f}  (flat-rate market premium, 2026 comparable sales)",
            ))

    # ── 3. Compose final value ────────────────────────────────────────────────
    combined_multiplier = (
        era_mult
        * cladding_mult
        * risk_mult
        * lifestyle_mult
        * topo_mult
        * solar_mult
        * school_zone_mult
        * flood_mult
        * utility_friction_mult
    )

    base_structure_value = base_cost_per_sqm * area_sqm
    structure_value      = base_structure_value * combined_multiplier

    # Land value — calculated separately from floor-area structure
    land_value = 0.0
    land_rate  = 0.0
    if land_area_sqm and land_area_sqm > 0:
        land_rate  = _LAND_RATE_DEFAULT.get(city.lower(), 1_200.0)
        land_value = land_area_sqm * land_rate
        land_pct   = round(land_value / base_structure_value * 100, 2) if base_structure_value else 0.0
        breakdown.insert(0, {
            "factor":           "land_value",
            "impact_pct":       land_pct,
            "reasoning_string": (
                f"Land Value: +${land_value:,.0f}  "
                f"({land_area_sqm:,.0f} m2 @ ${land_rate:,.0f}/m2 "
                f"{city.title()} land rate)"
            ),
        })

    # Flat additions (land already counted above)
    flat_total = land_value
    for factor, amount, reason in utility_flat_additions:
        flat_pct = round(amount / base_structure_value * 100, 2) if base_structure_value else 0.0
        breakdown.append({"factor": factor, "impact_pct": flat_pct, "reasoning_string": reason})
        flat_total += amount

    for factor, amount, reason in flat_asset_additions:
        flat_pct = round(amount / base_structure_value * 100, 2) if base_structure_value else 0.0
        breakdown.append({"factor": factor, "impact_pct": flat_pct, "reasoning_string": reason})
        flat_total += amount

    final_value = round(structure_value + flat_total, 2)

    # ── 4. Confidence score ───────────────────────────────────────────────────
    confidence = _confidence(
        topo_ok            = topo_ok,
        solar_ok           = solar_ok,
        era_from_json      = era_from_json,
        cladding_from_json = cladding_from_json,
        base_from_json     = base_from_json,
    )

    # ── 5. Assemble output ────────────────────────────────────────────────────
    return {
        "final_valuation": final_value,
        "confidence_score": confidence,
        "dna_breakdown": breakdown,
        "metadata": {
            "address":             address,
            "city":                city,
            "tier":                tier,
            "area_sqm":            area_sqm,
            "land_area_sqm":       land_area_sqm,
            "land_rate_per_sqm":   land_rate or None,
            "land_value":          round(land_value, 2) if land_value else None,
            "bedrooms":            bedrooms,
            "bathrooms":           bathrooms,
            "base_cost_per_sqm":   base_cost_per_sqm,
            "combined_multiplier": round(combined_multiplier, 4),
            "structure_value":     round(structure_value, 2),
            "topo_grade":          topo_grade,
            "solar_hours_daily":   solar_hours,
            "is_in_prime_zone":    is_in_prime_zone,
            "flood_risk":          flood_risk,
            "base_source":         base_source,
            "engine_version":      "0.4.0-async",
            "disclaimer": (
                "INDICATIVE ONLY. TerraAI is NOT a Registered Valuation, "
                "Geotechnical Assessment, or Legal Advice. "
                "All outputs are model estimates from public data. "
                "Verify with a licensed professional before any financial transaction. "
                "See LAWYER_SHIELD.md for the full legal framework."
            ),
        },
    }


# Backward-compatible alias — satisfies callers that expect this name
# (e.g. the legacy backend/test_valuation.py import path)
calculate_dna_value_async = calculate_dna_value
