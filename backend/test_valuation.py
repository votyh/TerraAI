"""
Quick standalone test for the TerraAI async engine.

Run from backend/:
    python test_valuation.py

For the full pytest suite run:
    python -m pytest -v          (from backend/)
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "app" / "engine"))

from async_engine import calculate_dna_value_async  # noqa: E402


async def test_valuation_logic() -> None:
    # Test Case: Auckland home, 150 m2, 1995 Monolithic, no risk, no school zone
    test_address = "123 Example Street, Auckland"

    result = await calculate_dna_value_async(
        address          = test_address,
        city             = "auckland",
        tier             = "standard",
        area_sqm         = 150,
        era              = "leaky_era_90s",
        cladding         = "monolithic_plaster",
        is_in_prime_zone = False,
    )

    print("\n--- TerraAI DNA Test Run ---")
    print(f"Address:     {result['metadata']['address']}")
    print(f"Final Value: ${result['final_valuation']:,.2f} NZD")
    print(f"Confidence:  {result['confidence_score']}/100")
    print("\nBreakdown:")
    for item in result["dna_breakdown"]:
        sign = "+" if item["impact_pct"] >= 0 else ""
        print(f"  {item['factor']:<22} {sign}{item['impact_pct']:.2f}%   {item['reasoning_string']}")

    # Basic assertions
    assert result["final_valuation"] > 0, "final_valuation must be positive"
    assert 0 <= result["confidence_score"] <= 100, "confidence must be 0-100"
    assert isinstance(result["dna_breakdown"], list), "dna_breakdown must be a list"
    for item in result["dna_breakdown"]:
        assert "factor"           in item
        assert "impact_pct"       in item
        assert "reasoning_string" in item

    print("\nAll assertions passed.")


if __name__ == "__main__":
    asyncio.run(test_valuation_logic())