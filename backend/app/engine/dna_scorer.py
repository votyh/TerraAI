"""
TerraAI Property DNA Scorer — engine/dna_scorer.py
====================================================
Loads data_v1.json and calculates a 'DNA Score' (1–100) for a property
based on three weighted pillars:

    Pillar A — Material Risk       (weight: 40 pts)
    Pillar B — Era                 (weight: 35 pts)
    Pillar C — Energy Efficiency   (weight: 25 pts)

The DNA Score is then converted into a multiplier and applied to a
base_cost_per_sqm to produce a DNA-adjusted cost per m².

ZERO HALLUCINATION POLICY (LAWYER_SHIELD.md §4):
    All scores are indicative model outputs derived from public research data.
    Output is NOT a Registered Valuation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

from rules import load_rules, ValuationRules


# ─── Constants ────────────────────────────────────────────────────────────────

_DATA_PATH = Path(__file__).parent / "data_v1.json"

# Pillar weights must sum to 100
_WEIGHT_MATERIAL_RISK     = 40
_WEIGHT_ERA               = 35
_WEIGHT_ENERGY_EFFICIENCY = 25

# DNA Score → cost multiplier mapping
# Score 50 (neutral) maps to 1.00; each point above/below shifts ±0.005
# Range: score 1 → ~0.75×  |  score 100 → ~1.25×
_NEUTRAL_SCORE      = 50
_MULTIPLIER_NEUTRAL = 1.00
_MULTIPLIER_STEP    = 0.005   # 0.5 % per DNA point


# ─── Input Model ──────────────────────────────────────────────────────────────

CladdingKey = Literal[
    "brick_and_tile",
    "vertical_cedar",
    "aac_panels_hebel",
    "fibre_cement_weatherboard",
    "monolithic_plaster",  # legacy rules.py key — treated as fibre_cement for JSON lookup
]

EraKey = Literal[
    "villa_heritage_1900_1920",
    "post_war_solid_1950_1960",
    "leaky_era_1990_2004",
    "modern_high_performance_2020_2026",
]

EnergyRatingKey = Literal[
    "no_rating",        # baseline, no green certification
    "homestar_4",       # NZ Homestar 4-star
    "homestar_6",       # NZ Homestar 6-star
    "nathers_5",        # AU NatHERS 5-star
    "nathers_7",        # AU NatHERS 7-star (above average)
    "nathers_9",        # AU NatHERS 9-star (high performance)
    "solar_pv",         # solar PV only (no formal star rating)
    "double_glazed",    # retrofit double glazing only
]


@dataclass
class DNAInput:
    """Property attributes required to compute a DNA Score."""

    city:                 str              # e.g., "auckland", "sydney"
    tier:                 str              # "standard" | "premium" | "ultra_luxury"
    floor_area_sqm:       float
    cladding:             CladdingKey
    era:                  EraKey
    energy_rating:        EnergyRatingKey
    # Optional enhancements
    has_solar_pv:         bool = False
    sunlight_hours_daily: Optional[float] = None   # direct sun hours/day; None = unknown
    lifestyle_assets:     list[str] | None = None  # e.g., ["pool", "premium_deck"]


@dataclass
class DNAResult:
    """Full DNA scoring result including factor breakdown and adjusted cost."""

    # ── Score pillars ──────────────────────────────────────────────────────
    material_risk_score:     float   # 0–40
    era_score:               float   # 0–35
    energy_efficiency_score: float   # 0–25
    dna_score:               float   # 1–100 (sum of above, clamped)

    # ── Adjustments ────────────────────────────────────────────────────────
    sunlight_bonus_pct:      float   # e.g., 4.8 means +4.8 %
    lifestyle_multiplier:    float   # product of lifestyle asset multipliers

    # ── Cost output ────────────────────────────────────────────────────────
    base_cost_per_sqm:       float
    dna_multiplier:          float
    adjusted_cost_per_sqm:   float
    total_adjusted_value:    float

    # ── Metadata ───────────────────────────────────────────────────────────
    data_source: str
    disclaimer:  str


# ─── Data Loader ──────────────────────────────────────────────────────────────

def _load_json() -> dict:
    """Load and return the raw data_v1.json dictionary."""
    with _DATA_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


# ─── Pillar A: Material Risk (0 – 40 pts) ────────────────────────────────────

def _score_material_risk(cladding: CladdingKey, data: dict) -> float:
    """
    Score based on cladding system performance from data_v1.json
    'cladding_roofing_performance'.

    Scoring logic (indicative, all values from data_v1.json research):
        brick_and_tile            → +20% over benchmark → 40 pts (best)
        vertical_cedar            → +8.5% avg premium   → 34 pts
        aac_panels_hebel          → +4% avg premium     → 30 pts
        fibre_cement_weatherboard → 0% (benchmark)      → 24 pts
        monolithic_plaster        → -11.5% avg penalty  → 10 pts (worst)
    """
    perf = data.get("cladding_roofing_performance", {})

    mapping: dict[str, float] = {
        "brick_and_tile":           perf.get("brick_and_tile", {}).get("premium_over_weatherboard_pct", 20),
        "vertical_cedar":           _avg(perf.get("vertical_cedar", {}).get("aesthetic_premium_pct", {"low": 5, "high": 12})),
        "aac_panels_hebel":         _avg(perf.get("aac_panels_hebel", {}).get("premium_over_fibre_cement_pct", {"low": 3, "high": 5})),
        "fibre_cement_weatherboard": 0.0,
        "monolithic_plaster":       _avg(perf.get("fibre_cement_weatherboard", {}).get("resale_underperformance_vs_brick_pct", {"low": -8, "high": -15})),
    }

    # Premium % → 0–40 scale: benchmark=0% → 24 pts; +20% → 40 pts; -15% → 8 pts
    raw_pct = mapping.get(cladding, 0.0)
    # Linear interpolation: -20% → 0 pts, +20% → 40 pts
    score = ((raw_pct + 20.0) / 40.0) * 40.0
    return max(0.0, min(40.0, score))


# ─── Pillar B: Era (0 – 35 pts) ──────────────────────────────────────────────

def _score_era(era: EraKey, data: dict) -> float:
    """
    Score based on decade_era_value_multiplier_matrix from data_v1.json.

    Scoring logic:
        modern_high_performance_2020_2026  → +6% new-build premium → 35 pts
        post_war_solid_1950_1960           → +5% implicit premium  → 30 pts
        villa_heritage_1900_1920           → net ~+4.3% char, -9.6% heritage → 20 pts
        leaky_era_1990_2004                → -11% stigma discount  → 5 pts
    """
    era_matrix = data.get("decade_era_value_multiplier_matrix", {})

    score_map: dict[str, float] = {
        "modern_high_performance_2020_2026": 35.0,
        "post_war_solid_1950_1960":          30.0,
        "villa_heritage_1900_1920":          20.0,
        "leaky_era_1990_2004":                5.0,
    }

    # Cross-check modern premium against live JSON value if available
    modern = era_matrix.get("modern_high_performance_2020_2026", {})
    if modern:
        modern_premium = modern.get("new_build_premium_over_existing_pct", 6)
        # Re-anchor: 6% → 35 pts
        score_map["modern_high_performance_2020_2026"] = min(35.0, (modern_premium / 6.0) * 35.0)

    leaky = era_matrix.get("nz_au_leaky_building_era_1990_2004", {})
    if leaky:
        stigma = abs(leaky.get("general_market_stigma_discount_pct", 11))
        # -11% → 5 pts; worse stigma → fewer pts
        score_map["leaky_era_1990_2004"] = max(0.0, 16.0 - stigma)

    return score_map.get(era, 17.5)   # 17.5 = neutral midpoint for unknown eras


# ─── Pillar C: Energy Efficiency (0 – 25 pts) ────────────────────────────────

def _score_energy(energy_rating: EnergyRatingKey, has_solar_pv: bool, data: dict) -> float:
    """
    Score based on energy_insulation_premium from data_v1.json.

    NatHERS / Homestar research → 1.3% per star (AU) / 4–6% avg (NZ).
    25 pts = best-in-class (NatHERS 9-star or Homestar 6-star).
     0 pts = no rating.
    """
    energy_data = data.get("energy_insulation_premium", {})
    au = energy_data.get("australia_nathers", {})
    nz = energy_data.get("new_zealand_homestar", {})

    per_star_pct = au.get("value_add_per_star_pct", 1.3)
    solar_pv_pct = au.get("solar_pv_system_premium_pct", 2.7)
    nz_premium   = _avg(nz.get("resale_premium_estimate_pct", {"low": 4, "high": 6}))

    base_scores: dict[str, float] = {
        "no_rating":    0.0,
        "double_glazed": (2.0 + 4.0) / 2.0 * (25.0 / nz_premium),  # ~3% → ~13 pts
        "solar_pv":     solar_pv_pct * (25.0 / nz_premium),
        "nathers_5":    5 * per_star_pct * (25.0 / (9 * per_star_pct)),
        "nathers_7":    7 * per_star_pct * (25.0 / (9 * per_star_pct)),
        "nathers_9":    25.0,
        "homestar_4":   (4.0 / 6.0) * 25.0 * (nz_premium / 6.0),
        "homestar_6":   25.0,
    }

    score = base_scores.get(energy_rating, 0.0)

    # Solar PV additive bonus if flagged separately (and not already a NatHERS/star rating)
    if has_solar_pv and energy_rating in ("no_rating", "double_glazed"):
        score = min(25.0, score + solar_pv_pct * (25.0 / (9 * per_star_pct)))

    return max(0.0, min(25.0, score))


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _avg(value: dict | float | int) -> float:
    """Return the midpoint of a {"low": x, "high": y} dict, or the value itself."""
    if isinstance(value, dict):
        return (value.get("low", 0) + value.get("high", 0)) / 2.0
    return float(value)


def _dna_to_multiplier(score: float) -> float:
    """
    Convert a 1–100 DNA Score to a cost multiplier.

    Score 50 → 1.00 (neutral)
    Score 75 → 1.125 (+12.5 %)
    Score 25 → 0.875 (-12.5 %)
    """
    delta = (score - _NEUTRAL_SCORE) * _MULTIPLIER_STEP
    return round(_MULTIPLIER_NEUTRAL + delta, 4)


# ─── Public API ───────────────────────────────────────────────────────────────

def calculate_dna_score(inp: DNAInput) -> DNAResult:
    """
    Main entry point.  Loads data_v1.json, scores the three pillars,
    aggregates the DNA Score, then applies it as a multiplier to the
    base_cost_per_sqm read from rules.py.

    Returns a DNAResult with full factor transparency.
    """
    raw_data = _load_json()
    rules: ValuationRules = load_rules()

    # ── 1. Base cost from rules.py ────────────────────────────────────────
    city_costs = rules.base_costs.get(inp.city.lower(), {})
    base_cost_per_sqm = float(city_costs.get(inp.tier, list(city_costs.values())[0] if city_costs else 4000))

    # ── 2. Score the three pillars ────────────────────────────────────────
    mat_score = _score_material_risk(inp.cladding, raw_data)
    era_score = _score_era(inp.era, raw_data)
    nrg_score = _score_energy(inp.energy_rating, inp.has_solar_pv, raw_data)

    raw_dna = mat_score + era_score + nrg_score
    dna_score = max(1.0, min(100.0, round(raw_dna, 2)))

    # ── 3. Sunlight bonus ─────────────────────────────────────────────────
    #  +2.4 % per hour of direct sunlight above the city average of 5 hrs
    sunlight_bonus_pct = 0.0
    if inp.sunlight_hours_daily is not None:
        excess_hours = max(0.0, inp.sunlight_hours_daily - 5.0)
        sunlight_bonus_pct = round(excess_hours * 2.4, 4)

    # ── 4. Lifestyle assets ───────────────────────────────────────────────
    lifestyle_multiplier = 1.0
    for asset in (inp.lifestyle_assets or []):
        lifestyle_multiplier *= rules.lifestyle_assets.get(asset, 1.0)
    lifestyle_multiplier = round(lifestyle_multiplier, 4)

    # ── 5. Compose final multiplier ───────────────────────────────────────
    dna_multiplier    = _dna_to_multiplier(dna_score)
    sunlight_factor   = 1.0 + (sunlight_bonus_pct / 100.0)
    combined_mult     = round(dna_multiplier * sunlight_factor * lifestyle_multiplier, 4)

    # ── 6. Compute adjusted costs ─────────────────────────────────────────
    adjusted_cost_per_sqm = round(base_cost_per_sqm * combined_mult, 2)
    total_adjusted_value  = round(adjusted_cost_per_sqm * inp.floor_area_sqm, 2)

    return DNAResult(
        material_risk_score     = round(mat_score, 2),
        era_score               = round(era_score, 2),
        energy_efficiency_score = round(nrg_score, 2),
        dna_score               = dna_score,
        sunlight_bonus_pct      = sunlight_bonus_pct,
        lifestyle_multiplier    = lifestyle_multiplier,
        base_cost_per_sqm       = base_cost_per_sqm,
        dna_multiplier          = combined_mult,
        adjusted_cost_per_sqm   = adjusted_cost_per_sqm,
        total_adjusted_value    = total_adjusted_value,
        data_source             = raw_data.get("metadata", {}).get("report_title", "data_v1.json"),
        disclaimer=(
            "INDICATIVE ONLY. TerraAI DNA Score is NOT a Registered Valuation. "
            "All factors are model estimates derived from public research data. "
            "Verify with a licensed professional prior to any financial transaction. "
            "See LAWYER_SHIELD.md for the full legal framework."
        ),
    )
