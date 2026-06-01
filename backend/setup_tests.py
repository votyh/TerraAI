"""
TerraAI — Test Environment Setup Script
========================================
Run this once from the repo root to scaffold the full test infrastructure:

    python setup_tests.py

Creates:
    backend/app/engine/     — (already exists, verified)
    backend/tests/          — pytest test suite
    backend/data/           — raw data artefacts
    backend/pytest.ini      — pytest configuration
    backend/tests/conftest.py       — sys.path wiring so imports resolve
    backend/tests/test_valuation.py — complete async test suite

After running this script, execute tests with:

    cd backend
    python -m pytest -v
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).parent
BACKEND = ROOT / "backend"


# ─── Folder structure ─────────────────────────────────────────────────────────

DIRS = [
    BACKEND / "app" / "engine",
    BACKEND / "tests",
    BACKEND / "data",
]

for d in DIRS:
    d.mkdir(parents=True, exist_ok=True)
    init = d / "__init__.py"
    if not init.exists():
        init.touch()
    print(f"  [ok] {d.relative_to(ROOT)}")


# ─── pytest.ini ───────────────────────────────────────────────────────────────

PYTEST_INI = textwrap.dedent("""\
    [pytest]
    asyncio_mode = auto
    testpaths = tests
    python_files = test_*.py
    python_classes = Test*
    python_functions = test_*
""")

(BACKEND / "pytest.ini").write_text(PYTEST_INI, encoding="utf-8")
print(f"  [ok] backend/pytest.ini")


# ─── conftest.py ──────────────────────────────────────────────────────────────

CONFTEST = textwrap.dedent("""\
    \"\"\"
    conftest.py — adds backend/app/engine to sys.path so tests can
    import async_engine and rules directly without package-prefix gymnastics.
    \"\"\"
    import sys
    from pathlib import Path

    # Insert the engine directory at the front of sys.path so that
    #   from async_engine import calculate_dna_value
    # resolves to backend/app/engine/async_engine.py
    ENGINE_DIR = Path(__file__).parent.parent / "app" / "engine"
    if str(ENGINE_DIR) not in sys.path:
        sys.path.insert(0, str(ENGINE_DIR))
""")

(BACKEND / "tests" / "conftest.py").write_text(CONFTEST, encoding="utf-8")
print(f"  [ok] backend/tests/conftest.py")


# ─── test_valuation.py ────────────────────────────────────────────────────────

TEST_FILE = textwrap.dedent('''\
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
            assert "factor"           in item, f"Missing \'factor\' in {item}"
            assert "impact_pct"       in item, f"Missing \'impact_pct\' in {item}"
            assert "reasoning_string" in item, f"Missing \'reasoning_string\' in {item}"


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
        ), f"Expected {expected}, got {in_zone[\'final_valuation\']}"


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
''')

dest = BACKEND / "tests" / "test_valuation.py"
dest.write_text(TEST_FILE, encoding="utf-8")
print(f"  [ok] backend/tests/test_valuation.py  ({len(TEST_FILE.splitlines())} lines)")


# ─── Final instructions ───────────────────────────────────────────────────────

print()
print("=" * 62)
print("  Setup complete. Install test dependencies if needed:")
print()
print("    pip install pytest pytest-asyncio")
print()
print("  Then run the test suite from backend/:")
print()
print("    cd backend")
print("    python -m pytest -v")
print("=" * 62)
