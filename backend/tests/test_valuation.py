"""
TerraAI — Async DNA Engine Test Suite
======================================
Run from backend/:

    python -m pytest -v

Requires: pytest, pytest-asyncio
    pip install pytest pytest-asyncio
"""

import math
import pytest
from async_engine import calculate_dna_value


# ─── Fixtures ─────────────────────────────────────────────────────────────

BASE_KWARGS = dict(
    address="123 Example Street, Auckland",
    city="auckland",
    tier="standard",
    area_sqm=150,
    era="leaky_era_90s",
    cladding="monolithic_plaster",
)


# ─── Basic Smoke Tests ────────────────────────────────────────────────────

async def test_returns_expected_keys():
    """Result dict must contain all three top-level keys."""
    result = await calculate_dna_value(**BASE_KWARGS)
    assert "final_valuation"  in result
    assert "confidence_score" in result
    assert "dna_breakdown"    in result
    assert "metadata"         in result


async def test_final_valuation_is_positive():
    """Even a high-risk property must produce a positive value."""
    result = await calculate_dna_value(**BASE_KWARGS, risk="flood_plain_100y")
    assert result["final_valuation"] > 0


async def test_confidence_score_in_range():
    """Confidence must be an int in [0, 100]."""
    result = await calculate_dna_value(**BASE_KWARGS)
    score = result["confidence_score"]
    assert isinstance(score, int)
    assert 0 <= score <= 100


async def test_dna_breakdown_item_shape():
    """Every breakdown entry must have the three required fields."""
    result = await calculate_dna_value(**BASE_KWARGS)
    for item in result["dna_breakdown"]:
        assert "factor"           in item, f"Missing 'factor' in {item}"
        assert "impact_pct"       in item, f"Missing 'impact_pct' in {item}"
        assert "reasoning_string" in item, f"Missing 'reasoning_string' in {item}"


# ─── Multiplier Logic Tests ───────────────────────────────────────────────

async def test_leaky_era_lower_than_modern():
    """A 1990s leaky-era property should value lower than a modern equivalent."""
    leaky  = await calculate_dna_value(**{**BASE_KWARGS, "era": "leaky_era_90s"})
    modern = await calculate_dna_value(**{**BASE_KWARGS, "era": "modern_high_performance_2020_2026"})
    assert leaky["final_valuation"] < modern["final_valuation"]


async def test_flood_risk_lowers_value():
    """Adding flood risk must reduce the valuation."""
    no_risk = await calculate_dna_value(**BASE_KWARGS)
    flooded = await calculate_dna_value(**BASE_KWARGS, risk="flood_plain_100y")
    assert flooded["final_valuation"] < no_risk["final_valuation"]


async def test_pool_lifestyle_raises_value():
    """Adding a pool must increase the valuation."""
    base      = await calculate_dna_value(**BASE_KWARGS)
    with_pool = await calculate_dna_value(**BASE_KWARGS, lifestyle=["pool"])
    assert with_pool["final_valuation"] > base["final_valuation"]


# ─── School Zone Premium ─────────────────────────────────────────────────

async def test_school_zone_raises_value():
    """is_in_prime_zone=True must produce a higher valuation than False."""
    no_zone  = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=False)
    in_zone  = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=True)
    assert in_zone["final_valuation"] > no_zone["final_valuation"]


async def test_school_zone_premium_is_15_percent():
    """School zone premium must be exactly +15% of the non-zone valuation."""
    no_zone = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=False)
    in_zone = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=True)

    expected = round(no_zone["final_valuation"] * 1.15, 2)
    assert math.isclose(
        in_zone["final_valuation"], expected, rel_tol=1e-6
    ), f"Expected {expected}, got {in_zone['final_valuation']}"


async def test_school_zone_breakdown_entry_present():
    """When in prime zone, dna_breakdown must contain a school_zone entry."""
    result = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=True)
    factors = [item["factor"] for item in result["dna_breakdown"]]
    assert "school_zone" in factors


async def test_school_zone_breakdown_absent_when_false():
    """When NOT in prime zone, school_zone must NOT appear in dna_breakdown."""
    result = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=False)
    factors = [item["factor"] for item in result["dna_breakdown"]]
    assert "school_zone" not in factors


async def test_school_zone_impact_pct_value():
    """The school_zone breakdown entry must report exactly 15.0 impact_pct."""
    result = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=True)
    zone_entry = next(i for i in result["dna_breakdown"] if i["factor"] == "school_zone")
    assert math.isclose(zone_entry["impact_pct"], 15.0, rel_tol=1e-9)


async def test_school_zone_metadata_flag():
    """metadata must reflect the is_in_prime_zone flag correctly."""
    result_true  = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=True)
    result_false = await calculate_dna_value(**BASE_KWARGS, is_in_prime_zone=False)
    assert result_true["metadata"]["is_in_prime_zone"]  is True
    assert result_false["metadata"]["is_in_prime_zone"] is False


# ─── Edge Cases ───────────────────────────────────────────────────────────

async def test_all_flags_combined():
    """Full-feature call — pool, flood risk, school zone — must not crash."""
    result = await calculate_dna_value(
        address="99 Remuera Road, Auckland",
        city="auckland",
        tier="premium",
        area_sqm=220,
        era="villa_heritage_1900_1920",
        cladding="brick_and_tile",
        risk="flood_plain_500y",
        lifestyle=["pool", "premium_deck"],
        is_in_prime_zone=True,
    )
    assert result["final_valuation"] > 0
    factors = [i["factor"] for i in result["dna_breakdown"]]
    assert "school_zone"      in factors
    assert "lifestyle_pool"   in factors
    assert "risk"             in factors


async def test_unknown_era_defaults_neutral():
    """An unrecognised era key must not crash — falls back to 1.0 multiplier."""
    result = await calculate_dna_value(
        **{**BASE_KWARGS, "era": "nonexistent_era_key"}
    )
    assert result["final_valuation"] > 0


async def test_unknown_cladding_defaults_neutral():
    """An unrecognised cladding key must not crash — falls back to 1.0."""
    result = await calculate_dna_value(
        **{**BASE_KWARGS, "cladding": "mystery_cladding"}
    )
    assert result["final_valuation"] > 0


# ─── Phase 1 Intelligence Tests ───────────────────────────────────────────────
# These tests verify the Hazard, Utility Density, Land, and Asset logic
# added in engine v0.4.0-async.

async def test_hazard_floodplain_penalty():
    """flood_risk='floodplain' must reduce final_valuation by exactly 12.5%."""
    base    = await calculate_dna_value(**BASE_KWARGS)
    flooded = await calculate_dna_value(**BASE_KWARGS, flood_risk="floodplain")
    expected = round(base["final_valuation"] * (1 - 0.125), 2)
    assert math.isclose(flooded["final_valuation"], expected, rel_tol=1e-6), (
        f"Expected {expected}, got {flooded['final_valuation']}"
    )


async def test_hazard_overland_flow_penalty():
    """flood_risk='overland_flow' must reduce final_valuation by exactly 4%."""
    base    = await calculate_dna_value(**BASE_KWARGS)
    flooded = await calculate_dna_value(**BASE_KWARGS, flood_risk="overland_flow")
    expected = round(base["final_valuation"] * (1 - 0.04), 2)
    assert math.isclose(flooded["final_valuation"], expected, rel_tol=1e-6), (
        f"Expected {expected}, got {flooded['final_valuation']}"
    )


async def test_hazard_breakdown_entry_and_pct():
    """Floodplain must add a 'flood_risk' breakdown entry with -12.5 impact_pct."""
    result  = await calculate_dna_value(**BASE_KWARGS, flood_risk="floodplain")
    factors = [i["factor"] for i in result["dna_breakdown"]]
    assert "flood_risk" in factors
    entry = next(i for i in result["dna_breakdown"] if i["factor"] == "flood_risk")
    assert math.isclose(entry["impact_pct"], -12.5, rel_tol=1e-9)


async def test_density_friction_penalty():
    """4 bedrooms + 1 bathroom must apply a -3% utility friction penalty."""
    base     = await calculate_dna_value(**BASE_KWARGS)
    high_den = await calculate_dna_value(**BASE_KWARGS, bedrooms=4, bathrooms=1)
    expected = round(base["final_valuation"] * (1 - 0.03), 2)
    assert math.isclose(high_den["final_valuation"], expected, rel_tol=1e-6), (
        f"Expected {expected}, got {high_den['final_valuation']}"
    )


async def test_density_friction_breakdown_entry():
    """4-bed/1-bath must add 'utility_density' entry with -3.0 impact_pct."""
    result  = await calculate_dna_value(**BASE_KWARGS, bedrooms=4, bathrooms=1)
    factors = [i["factor"] for i in result["dna_breakdown"]]
    assert "utility_density" in factors
    entry = next(i for i in result["dna_breakdown"] if i["factor"] == "utility_density")
    assert math.isclose(entry["impact_pct"], -3.0, rel_tol=1e-9)


async def test_ensuite_adds_flat_35k():
    """2 bathrooms must add exactly $35,000 flat to final_valuation."""
    base    = await calculate_dna_value(**BASE_KWARGS)
    ensuite = await calculate_dna_value(**BASE_KWARGS, bedrooms=3, bathrooms=2)
    diff    = round(ensuite["final_valuation"] - base["final_valuation"], 2)
    assert math.isclose(diff, 35_000.0, rel_tol=1e-6), (
        f"Expected +35000, got {diff}"
    )


async def test_land_value_adds_correctly():
    """land_area_sqm=400 must add exactly 400 * 1200 = $480,000 (Auckland rate)."""
    base      = await calculate_dna_value(**BASE_KWARGS)
    with_land = await calculate_dna_value(**BASE_KWARGS, land_area_sqm=400)
    expected_land = 400 * 1_200.0
    diff = round(with_land["final_valuation"] - base["final_valuation"], 2)
    assert math.isclose(diff, expected_land, rel_tol=1e-6), (
        f"Expected +{expected_land}, got {diff}"
    )


async def test_asset_pool_adds_65k():
    """assets=['pool'] must add exactly $65,000 flat."""
    base      = await calculate_dna_value(**BASE_KWARGS)
    with_pool = await calculate_dna_value(**BASE_KWARGS, assets=["pool"])
    diff = round(with_pool["final_valuation"] - base["final_valuation"], 2)
    assert math.isclose(diff, 65_000.0, rel_tol=1e-6), (
        f"Expected +65000, got {diff}"
    )


async def test_asset_minor_dwelling_adds_150k():
    """assets=['minor_dwelling'] must add exactly $150,000 flat."""
    base    = await calculate_dna_value(**BASE_KWARGS)
    with_md = await calculate_dna_value(**BASE_KWARGS, assets=["minor_dwelling"])
    diff = round(with_md["final_valuation"] - base["final_valuation"], 2)
    assert math.isclose(diff, 150_000.0, rel_tol=1e-6), (
        f"Expected +150000, got {diff}"
    )


async def test_combined_intelligence_full():
    """Full Phase-1 call with all new params must not crash and be self-consistent."""
    result = await calculate_dna_value(
        address          = "15 Domain Drive, Auckland",
        city             = "auckland",
        tier             = "standard",
        area_sqm         = 200,
        era              = "modern_high_performance_2020_2026",
        cladding         = "brick_and_tile",
        flood_risk       = "overland_flow",
        land_area_sqm    = 600,
        bedrooms         = 4,
        bathrooms        = 2,
        assets           = ["pool", "minor_dwelling"],
        is_in_prime_zone = True,
    )
    assert result["final_valuation"] > 0
    factors = [i["factor"] for i in result["dna_breakdown"]]
    assert "land_value"       in factors
    assert "flood_risk"       in factors
    assert "utility_ensuite"  in factors
    assert "asset_pool"       in factors
    assert "asset_minor_dwelling" in factors
    assert "school_zone"      in factors
    # 4 bed + 2 bath → ensuite bonus, NOT friction penalty
    assert "utility_density"  not in factors
