---
name: geo-tdd
description: 'Enforces a strict Red-Green-Refactor TDD loop for TerraAI spatial and geometry calculations. Use before writing any formula, GIS intersection, area calculation, setback offset, or zoning constraint engine. Generates mock GeoJSON payloads and exact numeric assertions first — no implementation code is written until the test harness is solid. Trigger phrases: geo tdd, geometry test, spatial test, test first, red green refactor, write the tests first, mock parcel, assert area, test the math, TDD, test driven.'
argument-hint: 'Describe the calculation to be tested (e.g. "HIRB recession plane for MHU zone")'
---

# /geo-tdd — Math & Geometry Guardrail

## Purpose
Prevent hallucinated geometry math, incorrect unit conversions, and untestable spatial functions by enforcing a strict test-first discipline. No core calculation logic is written until there are mock inputs and exact expected outputs to run it against.

## When to Use
- Before implementing any area, distance, or intersection calculation
- Before adding a new AUP zoning formula (HIRB, setback, coverage, density)
- Before writing a new LINZ or AKL GIS data parser
- When a spatial bug has been found and needs a regression test
- When a formula exists in prose (district plan text) and needs to be expressed in code

## Procedure

### Phase 1 — Define the Contract (Red)

Before writing any implementation, answer these questions in writing:

1. **What is the function's name and signature?**
   - Exact input types (GeoJSON geometry, coordinate pairs, numeric scalars)
   - Exact output type and units (m², metres, degrees, NZD, boolean)
   - CRS the function expects inputs in (EPSG:4326 vs EPSG:2193)

2. **What are the known-good test cases?**
   
   For each case, define a complete mock payload:

   ```typescript
   // Test case N — <description>
   const input: <InputType> = { /* full mock object — no undefined fields */ };
   const expected: <OutputType> = <exact value>;
   // Tolerance (for floating point): ±<value> <unit>
   ```

   Required test cases for TerraAI spatial functions:

   | Case | Must cover |
   |------|-----------|
   | Flat rectangular parcel | Baseline — easiest shape to verify by hand |
   | Irregular polygon | Non-axis-aligned boundary, at least one non-right-angle vertex |
   | MultiPolygon parcel | Two non-contiguous parts; clarify which part the function should operate on |
   | Parcel with hole | Interior exclusion (e.g. a right-of-way reserve inside the boundary) |
   | Minimum viable parcel | Smallest parcel the zone permits (e.g. 200 m² for MHU) |
   | Maximum slope | Slope at the topographical penalty threshold and just over it |
   | Zero-area edge | Degenerate input — should return an error, not NaN or 0 |

3. **What real-world values can anchor the test?**
   
   Find a real Auckland parcel on the LINZ map viewer or koordinates.com. Record:
   - `calc_area_m2` from LINZ (ground truth for area)
   - Suburb and AUP zone
   - Expected setback distances and coverage limits from the AUP chapter

   Use these values as the canonical assertions. If a calculated value disagrees with the LINZ ground truth by more than 1%, the implementation is wrong.

### Phase 2 — Write the Test Harness (Still Red)

Write the test file before any implementation code exists. The test should fail (or fail to compile) at this stage — that is the correct state.

```typescript
// geo-tdd pattern for TerraAI
import { describe, it, expect } from 'vitest';
// Import the function under test — it does not exist yet
import { <functionName> } from '../engine/<file>';

describe('<functionName>', () => {
  it('<test case description>', () => {
    const input = { /* mock payload from Phase 1 */ };
    expect(<functionName>(input)).toBeCloseTo(<expected>, <decimal places>);
  });
  
  it('returns error for degenerate input', () => {
    expect(() => <functionName>({ /* zero-area or null geometry */ }))
      .toThrow('<expected error message>');
  });
});
```

For Python (backend Shapely/GeoPandas functions):

```python
# geo-tdd pattern for TerraAI backend
import pytest
from backend.engine.<module> import <function_name>
from shapely.geometry import shape

MOCK_PARCEL = shape({ "type": "Polygon", "coordinates": [[...]] })

def test_<function_name>_rectangular_parcel():
    result = <function_name>(MOCK_PARCEL, zone="MHU")
    assert abs(result.net_area_m2 - <expected>) < 1.0  # ±1 m² tolerance

def test_<function_name>_raises_on_empty_geometry():
    with pytest.raises(ValueError, match="<expected message>"):
        <function_name>(None, zone="MHU")
```

### Phase 3 — Implement to Pass (Green)

Only now write the implementation. Rules:
- The implementation must make **all** tests from Phase 2 pass
- Do not modify the tests to match the implementation — if they disagree, the implementation is wrong
- Flag any test that required loosening a tolerance: `// TOLERANCE RELAXED — document why`
- If a new edge case is discovered during implementation, add a failing test for it **before** fixing it

### Phase 4 — Refactor (Refactor)

Once all tests are green:
- Remove duplication in the implementation
- Verify no test broke
- Add JSDoc / docstring referencing the AUP chapter, LINZ layer, or formula source
- Run the full test suite to confirm no regressions

### Geometry Mock Library

Reusable mock payloads for TerraAI tests. Reference these instead of inventing new coordinates.

```typescript
// Flat rectangular parcel — Auckland CBD-adjacent, ~700 m²
export const MOCK_RECTANGULAR_PARCEL = {
  type: "Polygon" as const,
  // ~28 m × 25 m rectangle near Ponsonby
  coordinates: [[
    [174.7480, -36.8590],
    [174.7483, -36.8590],
    [174.7483, -36.8592],
    [174.7480, -36.8592],
    [174.7480, -36.8590],
  ]],
};

// Irregular polygon — non-right-angle corners, ~550 m²
export const MOCK_IRREGULAR_PARCEL = {
  type: "Polygon" as const,
  coordinates: [[
    [174.7610, -36.8520],
    [174.7614, -36.8519],
    [174.7615, -36.8522],
    [174.7612, -36.8524],
    [174.7609, -36.8523],
    [174.7610, -36.8520],
  ]],
};

// MultiPolygon — two non-contiguous parts
export const MOCK_MULTI_POLYGON_PARCEL = {
  type: "MultiPolygon" as const,
  coordinates: [
    [[[174.7480, -36.8590], [174.7483, -36.8590], [174.7483, -36.8592], [174.7480, -36.8592], [174.7480, -36.8590]]],
    [[[174.7490, -36.8590], [174.7493, -36.8590], [174.7493, -36.8592], [174.7490, -36.8592], [174.7490, -36.8590]]],
  ],
};
```

> **Note:** These coordinates are illustrative approximations. Before using in a test that asserts exact area values, verify the expected `calc_area_m2` via the LINZ map viewer and record it in the test comment.

## Failure Modes to Catch

| Mistake | What it looks like | How the test catches it |
|---|---|---|
| Area computed in degrees² | `area = 0.000004` instead of `~700` | Assertion uses m², fails immediately |
| Axis-swap (lat/lng vs lng/lat) | Parcel appears in the wrong hemisphere | NZ bounds check in `validateNZCoordinate` fails |
| Hole treated as additional area | Area larger than LINZ `calc_area_m2` | Ground-truth assertion from LINZ |
| Slope penalty applied twice | RLV lower than expected | Known-input RLV assertion fails |
| MultiPolygon area sums all parts | Area of 2 × 700 m² returned for a 700 m² site | Assertion on selected part only |
| HIRB plane not projected to metric | Recession plane computed in degrees | Assertion on setback distance in metres fails |
