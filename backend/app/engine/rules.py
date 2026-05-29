"""
TerraAI Valuation Rules — engine/rules.py
==========================================
Single source of truth for all market multipliers and base costs.

Design principle: logic never hard-codes numbers.
    - All market figures live in the TERRA_RULES constant below.
    - All functions receive a ValuationRules instance (default: TERRA_RULES).
    - When market numbers change, update TERRA_RULES only — zero logic edits needed.

To swap in a different rules set (e.g., for A/B testing or regional overrides),
call load_rules(overrides={...}) and pass the returned object to any function.

DISCLAIMER: All values are indicative model inputs from public research data.
See LAWYER_SHIELD.md for the full legal framework.
"""

from __future__ import annotations

from typing import Dict, Optional
from pydantic import BaseModel


# ─── Schema ───────────────────────────────────────────────────────────────────

class ValuationRules(BaseModel):
    # Indicative build/replacement cost per m² by city and tier
    # Source: QV CostBuilder / Rawlinsons / AS Estimation 2026 (see data_v1.json)
    base_costs: Dict[str, Dict[str, int]]

    # Multipliers (1.0 = neutral, 1.05 = +5%, 0.90 = -10%)
    era_multipliers:     Dict[str, float]
    cladding_multipliers: Dict[str, float]
    risk_discounts:       Dict[str, float]

    # Lifestyle asset multipliers — applied on top of the DNA multiplier
    lifestyle_assets: Dict[str, float]

    # City average daily direct sunlight hours — used by sunlight_bonus()
    city_avg_sunlight_hours: Dict[str, float]

    # Topography engineering-cost penalties
    # Source: QV CostBuilder slope-penalty guidance; structural engineer interviews
    topography_penalties: Dict[str, float]


# ─── Market Data (2026) ───────────────────────────────────────────────────────

TERRA_RULES = ValuationRules(
    base_costs={
        # NZ — QV CostBuilder / JRA Construction Guide 2026 (data_v1.json midpoints)
        "auckland":     {"standard": 4000, "premium": 5500, "ultra_luxury": 8000},
        "wellington":   {"standard": 3500, "premium": 4600},
        "christchurch": {"standard": 3200, "premium": 4400},
        # AU — Rawlinsons / AS Estimation 2026 (data_v1.json midpoints)
        "sydney":       {"standard": 2950, "premium": 4000, "ultra_luxury": 6000},
        "melbourne":    {"standard": 3050, "premium": 4500},
        "brisbane":     {"standard": 2950, "premium": 4000},
    },

    era_multipliers={
        # Source: decade_era_value_multiplier_matrix in data_v1.json
        "villa_heritage_1900_1920":         1.043,   # +4.3% special character premium
        "post_war_solid_1950_1960":         1.05,    # +3–7% implicit premium (midpoint)
        "leaky_era_1990_2004":              0.89,    # -11% market stigma discount
        "modern_high_performance_2020_2026": 1.06,   # +6% new-build premium
        # Legacy keys preserved for backward compat
        "villa_heritage":                   1.043,
        "leaky_era_90s":                    0.89,
        "modern_2020":                      1.06,
    },

    cladding_multipliers={
        # Source: cladding_roofing_performance in data_v1.json
        "brick_and_tile":            1.20,   # +20% over benchmark
        "vertical_cedar":            1.085,  # +5–12% avg: 8.5%
        "aac_panels_hebel":          1.04,   # +3–5% avg: 4%
        "fibre_cement_weatherboard": 1.00,   # benchmark
        "monolithic_plaster":        0.885,  # -8 to -15% avg: -11.5%
    },

    risk_discounts={
        # Source: geospatial_zoning_risk_discounts in data_v1.json
        "flood_plain_100y":   0.892,   # -10.8% (AU UTS research)
        "flood_plain_500y":   0.956,   # -4.4%
        "overland_flow_path": 0.925,   # -7.5% NZ Auckland midpoint
        "coastal_erosion":    0.825,   # -17.5% combined NZ/AU midpoint
    },

    # ── Lifestyle Assets ──────────────────────────────────────────────────────
    # Applied as multiplicative premiums on top of the DNA-adjusted base cost.
    # Sources: RE agent interviews, PGH Bricks & Pavers data (data_v1.json).
    lifestyle_assets={
        "pool":                1.11,   # +11 % — in-ground pool premium
        "premium_deck":        1.05,   # +5  % — high-spec outdoor entertaining deck
        "high_kerb_appeal":    1.07,   # +7  % — landscape_street_appeal premium (data_v1.json)
        "ensuite_addition":    1.05,   # +5  % — ensuite_addition value_add (data_v1.json)
        "double_glazing":      1.03,   # +3  % — retrofit_double_glazing midpoint
    },

    # ── Topography Penalties ─────────────────────────────────────────────────────
    # Applied when LiDAR/slope data is available.  Reflects higher engineering,
    # foundation, and access costs on non-flat sites.
    topography_penalties={
        "flat":     0.00,    # no penalty
        "moderate": -0.07,   # -7%  — retaining walls, extra foundation prep
        "steep":    -0.20,   # -20% — significant structural engineering required
    },

    # ── City Average Daily Sunlight Hours ─────────────────────────────────────
    # Used as the baseline for sunlight_bonus().  Values are annual daily averages
    # of peak direct sun hours; sourced from NIWA / BOM public data.
    city_avg_sunlight_hours={
        "auckland":     5.0,
        "wellington":   4.8,
        "christchurch": 5.3,
        "sydney":       6.1,
        "melbourne":    4.9,
        "brisbane":     7.2,
    },
)


# ─── Loader ───────────────────────────────────────────────────────────────────

def load_rules(overrides: Optional[dict] = None) -> ValuationRules:
    """
    Return the active ValuationRules instance.

    Pass ``overrides`` to layer city-specific or A/B-test values on top of
    the defaults without mutating TERRA_RULES.

    Example::

        test_rules = load_rules({"base_costs": {"auckland": {"standard": 4200}}})

    Args:
        overrides: Partial dict matching ValuationRules fields.  Only the
                   provided keys are replaced; everything else inherits from
                   TERRA_RULES.

    Returns:
        A validated ValuationRules instance.
    """
    if not overrides:
        return TERRA_RULES

    base = TERRA_RULES.model_dump()
    for key, value in overrides.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value

    return ValuationRules(**base)


# ─── Sunlight Bonus ───────────────────────────────────────────────────────────

def sunlight_bonus(
    sunlight_hours_daily: float,
    city: str = "auckland",
    rules: Optional[ValuationRules] = None,
) -> float:
    """
    Calculate the percentage premium added for above-average daily sunlight.

    Formula:
        bonus_pct = max(0, hours - city_avg) × 2.4

    Args:
        sunlight_hours_daily: Measured or estimated direct sun hours per day.
        city:                 Lowercase city name used to look up city_avg.
        rules:                ValuationRules to use; defaults to TERRA_RULES.

    Returns:
        Premium as a plain percentage (e.g., 4.8 means +4.8 %).
        Returns 0.0 if sunlight_hours_daily is at or below the city average.

    Example:
        >>> sunlight_bonus(7.0, "auckland")   # avg is 5.0 → 2 excess hours
        4.8
    """
    active_rules = rules or TERRA_RULES
    city_avg = active_rules.city_avg_sunlight_hours.get(city.lower(), 5.0)
    excess_hours = max(0.0, sunlight_hours_daily - city_avg)
    return round(excess_hours * 2.4, 4)


def sunlight_multiplier(
    sunlight_hours_daily: float,
    city: str = "auckland",
    rules: Optional[ValuationRules] = None,
) -> float:
    """
    Return sunlight_bonus() as a ready-to-multiply factor (e.g., 1.048).

    Example:
        >>> sunlight_multiplier(7.0, "auckland")
        1.048
    """
    return round(1.0 + sunlight_bonus(sunlight_hours_daily, city, rules) / 100.0, 6)


# ─── Core Logic Engine (backward-compatible) ──────────────────────────────────

def calculate_dna_value(
    base_sqm: int,
    area_sqm: int,
    era: str,
    cladding: str,
    risk: Optional[str] = None,
    lifestyle: Optional[list[str]] = None,
    sunlight_hours: Optional[float] = None,
    city: str = "auckland",
    rules: Optional[ValuationRules] = None,
) -> float:
    """
    Core TerraAI valuation formula.

    Formula:
        value = (area_sqm × base_sqm)
                × era_multiplier
                × cladding_multiplier
                × risk_discount          (optional)
                × lifestyle_multiplier   (optional, product of all assets)
                × sunlight_factor        (optional, 2.4% per hr above avg)

    All market numbers are read from ``rules`` (default: TERRA_RULES), so
    updating figures never requires touching this function.

    Args:
        base_sqm:        Base cost per m² (can be overridden per-request).
        area_sqm:        Floor area in m².
        era:             Key in rules.era_multipliers.
        cladding:        Key in rules.cladding_multipliers.
        risk:            Optional key in rules.risk_discounts.
        lifestyle:       Optional list of keys in rules.lifestyle_assets.
        sunlight_hours:  Optional direct sun hours/day for the property.
        city:            City name for sunlight average lookup.
        rules:           ValuationRules instance; defaults to TERRA_RULES.

    Returns:
        Final estimated value rounded to 2 decimal places.
    """
    active_rules = rules or TERRA_RULES

    initial_value = base_sqm * area_sqm

    multiplier = (
        active_rules.era_multipliers.get(era, 1.0)
        * active_rules.cladding_multipliers.get(cladding, 1.0)
    )

    if risk:
        multiplier *= active_rules.risk_discounts.get(risk, 1.0)

    for asset in (lifestyle or []):
        multiplier *= active_rules.lifestyle_assets.get(asset, 1.0)

    if sunlight_hours is not None:
        multiplier *= sunlight_multiplier(sunlight_hours, city, active_rules)

    return round(initial_value * multiplier, 2)